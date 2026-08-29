/*********************************************************************
 *
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC – https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 *
 **********************************************************************
 *
 * XChain Regtest Miner - Miner Class
 * 
 * This file handles starting the regtest miner and mining blocks
 * 
 ********************************************************************/

const BlockchainConnector = require('./BlockchainConnector.js')
const CryptoNetworks = require('./CryptoNetworks.js')

// CHECK_BLOCK_DELAY_MS controls how often the loop wakes to poll the mempool and
// check timers. It is intentionally much shorter than MIN_MINING_TIME (1000ms) so
// that the loop fires close to the timer deadline rather than up to 1× late. A 100ms
// poll adds only ~100ms worst-case overshoot instead of the previous 1000ms (100%).
const CHECK_BLOCK_DELAY_MS = 100
// Upper bound on how stale status.wallet_balance may be. The auto-mine loop wakes
// every CHECK_BLOCK_DELAY_MS, so this interval guard is load-bearing: without it
// the refresh would issue 10 getbalance RPCs a second per miner.
const WALLET_BALANCE_REFRESH_MS = 5000
const SATOSHI_UNIT = 100000000.0

const DEFAULT_MAX_TIME_TO_MINE_TXS = 30000 //max 30 seconds to mine a block after the first tx is found in the mempool
const DEFAULT_ADDED_TIME_TO_MINE_TXS = 5000 //5 seconds extra before mining a block every time a new tx appears in the mempool

const MAX_MINING_TIME = 3600000 //1 hour max for mining timers
const MIN_MINING_TIME = 1000 //1 second minimum for mining timers
const MAX_FILL_MEMPOOL_QUANTITY = 50000 //max number of transactions to fill the mempool with
const MAX_SEND_RETRIES = 50 //max retries for sending funds in fillMempool
const MAX_GENERATE_BLOCKS = 10000 //max blocks a single generateBlocks call may mine (see cap note below)

// Idle mine-empty heartbeat, OFF by default (0). The auto-mine loop only ever
// mines when the mempool is non-empty, so a quiet chain never advances a block.
// Anything gated on HEIGHT rather than on transactions therefore stalls forever
// with nothing in flight to unstick it: capability-stake activation
// (ACTIVATION_DELAY_BLOCKS), confirmation depth, time-locked expiries. Drills hit
// this and had to drop to raw node `generatetoaddress`.
// With this set, the loop mines ONE empty block whenever the mempool has been
// empty for this long, so height advances on its own. Default stays 0 so no
// existing venue changes behavior: an empty block is still a real block that a
// reorg/depth test may be counting.
const DEFAULT_IDLE_MINE_INTERVAL_MS = 0


//This is useful only for filling the mempool
const { BIP32Factory } = require('bip32')
const ecc = require('tiny-secp256k1')
const bip32 = BIP32Factory(ecc)
const bip39 = require('bip39')
const bitcoin = require('bitcoinjs-lib');
const {ECPairFactory} = require('ecpair')
const ECPair = ECPairFactory(ecc)

class XChainRegtestMiner {
    constructor(network, nodeUrl, nodePort, nodeUser, nodePassword) {
      this.network = network
      this.connector = new BlockchainConnector(nodeUrl, nodePort, nodeUser, nodePassword)
      this.walletNameParam = "xchain_regtest_wallet"
      this.keepMining = false
      // Separates "never started" from "operator-paused". keepMining is false in both
      // states, so mining_paused alone cannot tell a wedged prepareWallet apart from a
      // deliberate pause_mining, and a health probe that treats a pause as healthy
      // then certifies a miner that never mined a block. start() sets
      // this true at the same point it sets keepMining, after prepareWallet resolves.
      this.miningStarted = false
      this.maxTimeToMineTxs = DEFAULT_MAX_TIME_TO_MINE_TXS
      this.addedTimeToMineTxs = DEFAULT_ADDED_TIME_TO_MINE_TXS
      this.idleMineIntervalMs = DEFAULT_IDLE_MINE_INTERVAL_MS
      this.fillMempoolRunning = false
      // Bumped by EVERY keepMining mutation, so a caller that paused can tell its
      // own pause from a later one. reconsiderBlock restores the prior mining
      // state in a finally, and without this a pause_mining landing inside its
      // awaited window was told "ok" and then silently overridden, resuming the
      // auto-mine loop under an operator who believed the miner was paused. A new
      // mutation site MUST bump this or it reopens that override.
      this._miningStateGeneration = 0
      // Ownership of the reorg pause reconsiderBlock restores from. The guard
      // above cannot be "any generation change since my snapshot": reconsiderBlock
      // is itself a keepMining writer and a generation bumper, so a SECOND
      // reconsider_block (api.js exposes it with no queue) bumps past the first's
      // snapshot and both then decline to restore, leaving the miner silently
      // stalled with nobody left to call continueMining().
      //
      // So the reorg pause is refcounted and shared instead. Concurrent
      // reconsiders inherit one record of "was auto-mining live before the reorg
      // started" plus the generation the LAST reorg pause claimed; only a
      // generation the reorg pause did not claim (an operator pause_mining /
      // continue_mining, fillMempool, the loop starting) counts as a foreign
      // mutation that cancels the restore. The last reconsider out is the one that
      // restores.
      this._reorgPauseDepth = 0
      this._reorgPauseWasMining = false
      this._reorgPauseGeneration = 0
      this._generateQueue = Promise.resolve()
      // Mine-vs-reorg exclusion. _generateQueue serializes MINES against each
      // other, and pauseMining()/the bare "await this._generateQueue" only DRAIN
      // it: the queue is settled the instant that await resolves, so a
      // generate_blocks RPC (api.js exposes it with no keepMining gate) arriving
      // while invalidateBlock/reconsiderBlock was parked on its node call ran a
      // generatetoaddress straight into the node's chain re-evaluation. Each reorg
      // primitive now raises a hold here instead, keyed by id because api.js
      // exposes both reorg verbs unqueued so several can be in flight at once.
      //
      // The ordering rule, which is what keeps this from deadlocking: a reorg
      // captures the mine queue tail AFTER raising its hold, so it waits only for
      // mines appended BEFORE it, and generateBlocks snapshots the holds active at
      // APPEND time, so a mine waits only for reorgs raised before it. Every
      // mine/reorg pair therefore has exactly one waiter. Gating a mine on a reorg
      // that is itself draining that same mine is the deadlock this avoids.
      this._reorgMineHoldSeq = 0
      this._reorgMineHolds = new Map()
      this.walletReady = false
      // Last observed spendable balance, exported by status as wallet_balance.
      // null means "never read, or the last read failed" and is deliberately
      // distinct from an observed 0, so neither reads as funded.
      this.balance = null
      // Epoch ms of the last balance READ ATTEMPT (not the last successful one),
      // exported as wallet_balance_at so a drill can tell a fresh reading from a
      // never-refreshed one. null until prepareWallet has read a balance.
      this._balanceReadAt = null
      this._mempoolSize = 0
      this._blocksMined = 0
      this._lastMineAt = null
      this._consecutiveErrors = 0
    }
    
    async sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    
    // Throws (rather than returning a sentinel {error} object) on invalid input,
    // matching the sibling validators sendFundsToAddress/invalidateBlock/
    // reconsiderBlock. A returned sentinel here previously let the api.js
    // controller's try/catch never fire, so the RPC reported "ok" on rejected
    // input (uuid:24c35056).
    async setMiningTime(maxTime, txAddedTime){
        if (!Number.isInteger(maxTime) || !Number.isInteger(txAddedTime) || maxTime <= 0 || txAddedTime <= 0){
            try { console.log("INVALID mining times: (Max Time)=>"+maxTime+"ms (Tx Added Time)=>"+txAddedTime+"ms") } catch(e) { console.log("INVALID mining times (non-printable values)") }
            throw new Error("Invalid mining times. Both values must be positive integers.")
        }
        if (maxTime < MIN_MINING_TIME || txAddedTime < MIN_MINING_TIME){
            console.log("Mining times too small: minimum is "+MIN_MINING_TIME+"ms")
            throw new Error("Mining times too small. Minimum is "+MIN_MINING_TIME+"ms.")
        }
        if (maxTime > MAX_MINING_TIME || txAddedTime > MAX_MINING_TIME){
            console.log("Mining times too large: maximum is "+MAX_MINING_TIME+"ms")
            throw new Error("Mining times too large. Maximum is "+MAX_MINING_TIME+"ms.")
        }
        this.maxTimeToMineTxs = maxTime
        this.addedTimeToMineTxs = txAddedTime
        console.log("New mining times: (Max Time)=>"+maxTime+"ms (Tx Added Time)=>"+txAddedTime+"ms")
    }

    // Turn the mine-empty heartbeat on (ms) or off (0). Throws on invalid input,
    // matching setMiningTime: a returned sentinel would let the api.js controller
    // report "ok" for a rejected value.
    //
    // Deliberately a SEPARATE knob from setMiningTime: those two govern how long
    // to wait for MORE transactions before mining what is already in the mempool,
    // and folding an empty-chain heartbeat into them would make every existing
    // venue start producing empty blocks.
    async setIdleMineInterval(intervalMs){
        if (!Number.isInteger(intervalMs) || intervalMs < 0){
            try { console.log("INVALID idle mine interval: "+intervalMs) } catch(e) { console.log("INVALID idle mine interval (non-printable value)") }
            throw new Error("Invalid idle mine interval. Must be a non-negative integer (0 disables).")
        }
        if (intervalMs !== 0 && intervalMs < MIN_MINING_TIME){
            throw new Error("Idle mine interval too small. Minimum is "+MIN_MINING_TIME+"ms (0 disables).")
        }
        if (intervalMs > MAX_MINING_TIME){
            throw new Error("Idle mine interval too large. Maximum is "+MAX_MINING_TIME+"ms.")
        }
        this.idleMineIntervalMs = intervalMs
        console.log(intervalMs === 0
            ? "Idle mine-empty disabled; the loop mines only when the mempool is non-empty"
            : "Idle mine-empty every "+intervalMs+"ms while the mempool stays empty")
    }

    // Whether an empty block is due: enabled, mempool empty, and nothing mined
    // for at least the interval. `now` is injected so the loop and the tests
    // read the same clock. A miner that has never mined (lastMineAt null) is
    // measured from `since`, the moment the loop started watching, so enabling
    // the heartbeat does not fire a block instantly on boot.
    _idleMineDue(now, since){
        if (!this.idleMineIntervalMs) return false
        if (this._mempoolSize > 0) return false
        let last = this._lastMineAt != null ? this._lastMineAt : since
        if (last == null) return false
        return (now - last) >= this.idleMineIntervalMs
    }

    async setDefaultMiningTime(){
        this.maxTimeToMineTxs = DEFAULT_MAX_TIME_TO_MINE_TXS
        this.addedTimeToMineTxs = DEFAULT_ADDED_TIME_TO_MINE_TXS
        console.log("The mining times were set to the default: (Max Time)=>"+this.maxTimeToMineTxs+"ms (Tx Added Time)=>"+this.addedTimeToMineTxs+"ms")
    }
    
    async fillMempool(txQuantity){
            if (this.fillMempoolRunning) {
                console.log("fillMempool is already running, rejecting concurrent call")
                throw new Error("fillMempool is already running")
            }

            if (!Number.isInteger(txQuantity) || txQuantity < 1) {
                try { console.log("INVALID txQuantity: "+txQuantity+". Must be a positive integer.") } catch(e) { console.log("INVALID txQuantity (non-printable value). Must be a positive integer.") }
                throw new Error("txQuantity must be a positive integer")
            }

            if (txQuantity > MAX_FILL_MEMPOOL_QUANTITY) {
                console.log("txQuantity "+txQuantity+" exceeds maximum of "+MAX_FILL_MEMPOOL_QUANTITY)
                throw new Error("txQuantity exceeds maximum of "+MAX_FILL_MEMPOOL_QUANTITY)
            }

            // Claim the mutex synchronously, before the first await below. The
            // fillMempoolRunning guard at the top of this method and this assignment
            // must not straddle an await, or the guard is a no-op under real
            // concurrency: two fill_mempool RPCs arriving in the same tick would both
            // pass the guard (flag still false) while parked on the _generateQueue
            // barrier, then both run the stress body at once.
            this.fillMempoolRunning = true
            this.keepMining = false //Stop the mining so the txs stay in mempool
            this._miningStateGeneration++
            try {
            // Mirror pauseMining's barrier: wait for any in-flight generateBlocks(1)
            // to settle before proceeding, so a mine that started just before the
            // flag flip can't land a new block while fillMempool is running.
            await this._generateQueue
            console.log("Filling mempool with "+txQuantity+" transactions")

            let OUTPUTS_QUANTITY_PER_TX = 2500

            // Resolve coin-specific bitcoinjs params (P2PKH version byte, WIF,
            // bip32) from the coin-network identifier so DOGE/LTC addresses and
            // PSBTs encode correctly, not just Bitcoin. Falls back to Bitcoin
            // regtest when only a bare network ("regtest") was supplied.
            var network = CryptoNetworks.getBitcoinJsNetwork(this.network) || bitcoin.networks.regtest
            if (!CryptoNetworks.getBitcoinJsNetwork(this.network)) {
                console.log("WARNING: NETWORK='"+this.network+"' did not resolve to a coin-specific network; falling back to bitcoin.networks.regtest for fillMempool. Set NETWORK to a coin-network form (e.g. dogecoin-regtest) for correct coin params.")
            }

            // Scale amounts to the coin's dust threshold so DOGE/LTC regtest
            // nodes (which have much higher minimum relay fees than Bitcoin)
            // don't reject the stress txs. The 1000-sat default applies only on the
            // FALLBACK path above (a bare NETWORK='regtest', which resolves to the
            // bitcoinjs-lib built-in and carries no dustThreshold). The resolved coin
            // form 'bitcoin-regtest' DOES define one (546), so this is 1000 there only
            // because 546 < 1000.
            const coinDust = (network && network.dustThreshold) ? network.dustThreshold : 1000
            let AMOUNT_FOR_EACH_ADDRESS = Math.max(coinDust, 1000)
            let FEE = Math.max(coinDust, 1000)
            // Per-output miner fee left on the intermediate 2500-output splitting tx.
            // Must also scale to the coin: a flat 50 sat/output is ~1.5 sat/byte on a
            // full split tx, below dogecoin-regtest's ~100 koinu/byte relay floor
            // (dustThreshold 100000), so the node rejects the split tx with
            // 'insufficient fee' and fill_mempool never runs on DOGE. Scale from the
            // coin's real dust threshold when present, which keeps ample margin on every
            // coin. The 50-sat floor is reached only on the bare-'regtest' FALLBACK path
            // (no dustThreshold); under the resolved 'bitcoin-regtest' form this is
            // max(50, 546) = 546, so real Bitcoin runs fund 2546/output, not 2050.
            const rawDust = (network && network.dustThreshold) ? network.dustThreshold : 50
            let SPLIT_TX_FEE_PER_OUTPUT = Math.max(50, rawDust)
            var mnemonic = bip39.generateMnemonic()
            var seed = bip39.mnemonicToSeedSync(mnemonic)
            var root = bip32.fromSeed(seed, network)
            var account = root.derivePath("m/44'/0'/0'/0")
            var address = account.derive(0).derive(0)
            var mainAddress = bitcoin.payments.p2pkh({ pubkey: address.publicKey, network }).address
            console.log("Main address to fill the mempool: "+mainAddress)

            
            console.log("Creating "+txQuantity+" addresses")
            let addresses = []
            for (let i=0;i<txQuantity;i++){
                let nextAddress = account.derive(i+1).derive(0)
                addresses.push(nextAddress)
            }

            console.log("Sending funds to the main address")
            let txsChunksCount = Math.ceil((txQuantity / OUTPUTS_QUANTITY_PER_TX))
            let chunksTxids = []
            let processedChunkCount = 0
            for (let i=0;i<txsChunksCount;i++){
                let txRemainder = OUTPUTS_QUANTITY_PER_TX
                if (i == txsChunksCount-1){
                    let remainder = txQuantity % OUTPUTS_QUANTITY_PER_TX
                    
                    if (remainder > 0){
                        txRemainder = remainder
                    }
                }
                let totalAmount =
                    AMOUNT_FOR_EACH_ADDRESS*txRemainder +
                    FEE*txRemainder +
                    SPLIT_TX_FEE_PER_OUTPUT*txRemainder
                
                console.log("Sending "+totalAmount/SATOSHI_UNIT+" ("+i+") to "+mainAddress)
                
                let sent = false
                let txid = null
                let sendRetries = 0
                while(!sent){
                    try {
                        txid = await this.sendFundsToAddress(mainAddress, totalAmount/SATOSHI_UNIT)
                        sent = true
                    } catch(err){
                        sendRetries++
                        let detail = (err && err.message ? err.message : err)
                        if (sendRetries >= MAX_SEND_RETRIES) {
                            throw new Error('Failed to send funds after ' + MAX_SEND_RETRIES + ' retries: ' + detail)
                        }
                        console.log("Error sending funds: "+detail+"; retrying (attempt "+sendRetries+"/"+MAX_SEND_RETRIES+")")
                        await this.sleep(1000)
                    }
                }
                chunksTxids.push(txid)
                processedChunkCount++
                
                if (processedChunkCount>=20){
                    await this.generateBlocks(1)
                    processedChunkCount = 0
                }
            }
            await this.generateBlocks(1)

            let utxos = []
            for (let nextChunkIndex in chunksTxids){
                let nextChunkTxid = chunksTxids[nextChunkIndex]
                let rawTransaction = null
                let getRawTxRetries = 0
                const MAX_GET_RAW_TX_RETRIES = 50
                while (rawTransaction == null){
                    rawTransaction = await this.connector.getRawTransaction(nextChunkTxid)
                    if (rawTransaction == null) {
                        getRawTxRetries++
                        if (getRawTxRetries >= MAX_GET_RAW_TX_RETRIES) {
                            throw new Error('Failed to get raw transaction after ' + MAX_GET_RAW_TX_RETRIES + ' retries for txid: ' + nextChunkTxid)
                        }
                        await this.sleep(1000)
                    }
                }
                let transaction = bitcoin.Transaction.fromHex(rawTransaction)
                let utxoIndex = 0
            
                for (let nextOutputIndex in transaction.outs){
                    let nextOutput = transaction.outs[nextOutputIndex]
                    let addressFromScript = bitcoin.address.fromOutputScript(nextOutput.script, network)
            
                    if (addressFromScript == mainAddress){
                        utxos.push({txid:nextChunkTxid, utxoIndex: utxoIndex, rawTransaction:rawTransaction})
                        break
                    } else {
                        utxoIndex++
                    }
                }
                
                
            }
            
            console.log("Creating the transactions to send funds to those addresses")
            
            for (let nextUtxoIndex in utxos){
                let nextUtxo = utxos[nextUtxoIndex]
                let utxoIndex = nextUtxo["utxoIndex"]
                let txid = nextUtxo["txid"]
                let rawTransaction = nextUtxo["rawTransaction"]
                let transaction = bitcoin.Transaction.fromHex(rawTransaction)
                
                let psbt = new bitcoin.Psbt({ network: network})
            
            
                psbt.addInput({
                    hash: txid,
                    index: utxoIndex,
                    // transaction.outs[n].sequence doesn't exist (.sequence is an
                    // input field, not an output field); reading it always yields
                    // undefined, which bitcoinjs-lib coerces to 0 (disabling RBF
                    // signalling but also rejecting some nodes). Use the standard
                    // final-sequence value instead.
                    sequence: 0xffffffff,
                    nonWitnessUtxo: Buffer.from(rawTransaction, 'hex')
                })
            
            
                let total = 0
            
                for (let nextAddressIndex=nextUtxoIndex*OUTPUTS_QUANTITY_PER_TX
                     ;nextAddressIndex<((parseInt(nextUtxoIndex) +1)*OUTPUTS_QUANTITY_PER_TX) && (nextAddressIndex<addresses.length)
                     ;nextAddressIndex++)
                {
                    let nextAddress = addresses[nextAddressIndex]
                    let nextAddressPayment = bitcoin.payments.p2pkh({ pubkey: nextAddress.publicKey, network }).address
                    let paymentAmount = AMOUNT_FOR_EACH_ADDRESS + FEE
                
                    total = total + paymentAmount
                    
                    psbt.addOutput({
                        address: nextAddressPayment,
                        value: paymentAmount
                    })
                }
            
                let keyToSign = ECPair.fromPrivateKey(address.privateKey, { network })

                for (let nextInputIndex=0;nextInputIndex < psbt.data.inputs.length;nextInputIndex++){
                    psbt.signInput(parseInt(nextInputIndex), keyToSign)
                }
            
                psbt.finalizeAllInputs()
                let extractedTransaction = psbt.extractTransaction()
                let txHex = extractedTransaction.toHex()
                
                nextUtxo["txHex"] = txHex
                nextUtxo["txIdSource"] = await this.connector.sendRawTransaction(txHex)
            }
            
            
            
            await this.generateBlocks(1)

            for (let nextAddressIndex in addresses){
                let nextAddress = addresses[nextAddressIndex]
                let psbt = new bitcoin.Psbt({ network: network })
                let paymentAmount = AMOUNT_FOR_EACH_ADDRESS
                
                let utxoIndex = Math.floor(nextAddressIndex/OUTPUTS_QUANTITY_PER_TX)
                
                let txIdSource = utxos[utxoIndex]["txIdSource"]
                let txHex = utxos[utxoIndex]["txHex"]
                let outputIndex = nextAddressIndex % OUTPUTS_QUANTITY_PER_TX
                
                psbt.addInput({
                    hash: txIdSource,
                    index: outputIndex,
                    sequence: 0xffffffff,
                    nonWitnessUtxo: Buffer.from(txHex, 'hex')
                })
                
                psbt.addOutput({
                    address: mainAddress,
                    value: paymentAmount
                })
                
                console.log("Stressing the mempool with the transaction number "+nextAddressIndex)
                
                let keyToSign = ECPair.fromPrivateKey(nextAddress.privateKey, { network })
                psbt.signInput(0, keyToSign)
                psbt.finalizeAllInputs()
                let outputTxHex = psbt.extractTransaction().toHex()
                
                
                await this.connector.sendRawTransaction(outputTxHex)
            }

            } finally {
                this.fillMempoolRunning = false
            }
    }

    // Re-reads the spendable balance so a reorg that disconnected the matured
    // coinbase, or a fill_mempool / send_funds run that drained the wallet,
    // becomes observable through status instead of silently outliving the flag
    // set at startup. Never throws: at the reorg termini it runs AFTER the reorg
    // RPC has already succeeded, so a failed balance read must not turn a
    // completed invalidate/reconsider into a rejected call, and in the auto-mine
    // loop a throw would kill mining outright. Deliberately does NOT
    // touch walletReady, which is a startup-completion flag; see the note where
    // prepareWallet sets it.
    //
    // Stamps _balanceReadAt on BOTH paths: it records the last read ATTEMPT, which
    // is what bounds staleness and what paces the loop's cadence guard. Stamping
    // only on success would let a node that keeps failing getbalance re-issue the
    // RPC on every 100ms loop tick.
    async refreshWalletFunds() {
        try {
            const observed = await this.connector.getBalance()
            this.balance = typeof observed === 'number' ? observed : null
        } catch (err) {
            console.log("Could not re-read the wallet balance: "+(err && err.message ? err.message : err))
            this.balance = null
        }
        this._balanceReadAt = Date.now()
        return this.balance
    }

    // True when the auto-mine loop owes a balance refresh. Split out as a
    // predicate (same shape as _idleMineDue) because the interval guard is the
    // load-bearing part: the loop wakes every CHECK_BLOCK_DELAY_MS, so a guard
    // that mis-answers turns one RPC per 5s into ten per second.
    _walletRefreshDue(now) {
        if (this._balanceReadAt == null) return true
        return (now - this._balanceReadAt) >= WALLET_BALANCE_REFRESH_MS
    }

    // Invalidates a block by hash, triggering a node-side rollback to the fork
    // point. Auto-mining is paused beforehand so the miner does not race ahead
    // with new blocks while the reorg is being constructed; callers must call
    // continueMining() when done.
    async invalidateBlock(blockHash) {
        if (typeof blockHash !== 'string' || blockHash.length === 0) {
            throw new Error('invalidateBlock: blockHash must be a non-empty string')
        }
        // Raised before the pause barrier, not after it: a mine appended while
        // pauseMining() is draining would otherwise run the instant the drain
        // resolves, overlapping the invalidate below.
        const mineHold = this._enterReorgMineHold()
        let result
        try {
            await this.pauseMining()
            result = await this.connector.invalidateBlock(blockHash)
        } finally {
            this._exitReorgMineHold(mineHold)
        }
        // A deep invalidate is exactly the case that can strand the wallet at 0.
        await this.refreshWalletFunds()
        return result
    }

    // Re-enables consideration of a previously invalidated block, letting the
    // node resolve which chain is longest. Should be called after the competing
    // branch is mined and before continueMining().
    async reconsiderBlock(blockHash) {
        if (typeof blockHash !== 'string' || blockHash.length === 0) {
            throw new Error('reconsiderBlock: blockHash must be a non-empty string')
        }
        // Take the same mine-barrier invalidateBlock takes, so the node never
        // re-evaluates the chain while a generateToAddress is in flight. Under the
        // documented invalidate -> mine branch -> reconsider flow mining is already
        // paused and this is a no-op; it is a standalone reconsider (or one issued
        // after continue_mining) that could otherwise race a mine into the node's
        // reorg. Prior auto-mining state is restored afterwards: unlike invalidate,
        // reconsider is the END of the reorg sequence, so leaving the miner paused
        // here would silently stall a caller that never calls continueMining().
        //
        // The restore is conditional on no OPERATOR pause having landed meanwhile.
        // A pause_mining RPC landing inside the awaited body below sets the flag
        // false and answers "ok"; an unconditional restore then flipped it back
        // and put the auto-mine loop live inside the height-deterministic section
        // that operator had just been told was serialized. Scoping that condition
        // to "nothing bumped the generation" instead was worse: a second
        // reconsider_block bumps it too, and then NEITHER call restored and the
        // miner stalled for good. _enterReorgPause/_exitReorgPause share one
        // refcounted pause between concurrent reconsiders so only a foreign
        // mutation cancels the restore.
        this._enterReorgPause()
        // Raised synchronously alongside the pause, so a mine appended while the
        // barrier below drains cannot run against the node's re-evaluation.
        const mineHold = this._enterReorgMineHold()
        // Dropped as soon as the node call returns rather than in the finally, so
        // the balance re-read below does not keep mines waiting; the finally still
        // covers every early exit. _exitReorgMineHold is a no-op on a second call.
        const dropMineHold = () => this._exitReorgMineHold(mineHold)
        try {
            // Same barrier pauseMining takes, drained inside the try so a rejected
            // in-flight mine still releases the reorg pause.
            await this._generateQueue
            const result = await this.connector.reconsiderBlock(blockHash)
            dropMineHold()
            // The reorg terminus, so this is where a restored balance shows up.
            await this.refreshWalletFunds()
            return result
        } finally {
            dropMineHold()
            this._exitReorgPause()
        }
    }

    // Raise a mine-vs-reorg hold and return its id. Called SYNCHRONOUSLY at the top
    // of a reorg primitive, before its first await, so no mine can be appended
    // between the decision to reorg and the hold becoming visible.
    _enterReorgMineHold(){
        const id = ++this._reorgMineHoldSeq
        let release
        const held = new Promise((resolve) => { release = resolve })
        this._reorgMineHolds.set(id, { held, release })
        return id
    }

    // Drop one hold, releasing the mines that snapshotted it. Always called from a
    // finally, so a rejected reorg RPC never leaves the miner unable to mine.
    _exitReorgMineHold(id){
        const hold = this._reorgMineHolds.get(id)
        if (!hold) return
        this._reorgMineHolds.delete(id)
        hold.release()
    }

    // Wait out the reorgs that were already in flight when this mine was queued,
    // then mine. `heldBy` is the append-time snapshot, never a live read: a reorg
    // raised after the append is itself waiting on this mine, so waiting on it back
    // would deadlock. After the last await there is no yield before _generateBlocks,
    // whose first statement dispatches generatetoaddress synchronously, so a reorg
    // raised meanwhile cannot slip its own RPC in ahead of this one.
    async _mineWhenReorgIdle(count, heldBy){
        for (const held of heldBy) await held
        return this._generateBlocks(count)
    }

    // Synchronous half of pauseMining: clear the flag and claim the generation
    // with no await between them, so no other writer can slot in and be mistaken
    // for this pause.
    _claimPause(){
        this.keepMining = false
        return ++this._miningStateGeneration
    }

    // Claim, or join, the shared reorg pause. The first reconsider in flight
    // records whether auto-mining was live; a concurrent one inherits that record
    // rather than snapshotting the paused state the first one just installed
    // (snapshotting it is what stalled the miner). Inheritance is dropped when a
    // foreign writer moved the generation since the last reorg pause: whatever
    // the operator did most recently is then the state to honour.
    _enterReorgPause(){
        const inherit = this._reorgPauseDepth > 0
            && this._miningStateGeneration === this._reorgPauseGeneration
        if (!inherit) this._reorgPauseWasMining = this.keepMining
        this._reorgPauseDepth++
        this._reorgPauseGeneration = this._claimPause()
    }

    // Release one hold on the reorg pause. Only the last one out restores, so a
    // nested reconsider never hands the chain back to the auto-mine loop while an
    // outer one is still mid-reorg. Returns whether it restored.
    _exitReorgPause(){
        if (this._reorgPauseDepth > 0) this._reorgPauseDepth--
        if (this._reorgPauseDepth > 0) return false
        const restore = this._reorgPauseWasMining
            && this._miningStateGeneration === this._reorgPauseGeneration
        this._reorgPauseWasMining = false
        if (restore){
            this.keepMining = true
            this._miningStateGeneration++
        }
        return restore
    }

    // Pin the node clock to `timestamp` (unix seconds) so the NEXT mined block
    // carries that block time; pass 0 to release the mock clock. This is a
    // regtest/testnet-only orchestration aid (setmocktime is meaningless on
    // mainnet and the parity harness that uses it only ever runs on regtest), so
    // refuse it on mainnet rather than forward a harmful RPC to a real node.
    // `this.network` is the coin-network form (e.g. bitcoin-regtest); guard on
    // its network half so 'bitcoin-mainnet' and a bare 'mainnet' both trip.
    async setMockTime(timestamp) {
        if (!Number.isFinite(Number(timestamp)) || Number(timestamp) < 0) {
            throw new Error('setMockTime: timestamp must be a non-negative unix time (0 releases the mock clock)')
        }
        if (String(this.network || '').split('-').pop() === 'mainnet') {
            throw new Error('setMockTime is refused on mainnet')
        }
        return await this.connector.setMockTime(Number(timestamp))
    }

    // Returns the mining-state generation this pause claimed, so a caller that
    // restores the previous state later can check no other pause/continue
    // intervened. The claim is taken synchronously with the flag write, before the
    // barrier below, because the barrier is itself an await another RPC can land
    // inside. Every current caller ignores the value; reconsiderBlock does its own
    // claim through _enterReorgPause because a plain generation snapshot cannot
    // tell a second reconsider apart from an operator pause.
    async pauseMining(){
        const generation = this._claimPause()
        // Barrier: a pause that lands between the loop's keepMining check and its
        // generateBlocks(1) would let one more block settle after pause() resolves,
        // breaking a height-deterministic generateBlocks section. Await the in-flight
        // mine so callers get a true barrier.
        await this._generateQueue
        return generation
    }

    async continueMining(){
        this.keepMining = true
        this._miningStateGeneration++
    }
    
    /**
     * Loads the named wallet, creating it if the node has never seen it, and
     * pins the connector to it.
     *
     * Split out of the startup path so `sendFundsToAddress` can re-run it. The
     * daemon that reaches here supports named wallets (Bitcoin Core 0.17+);
     * pinning via /wallet/<name>/ URI routing keeps subsequent wallet RPCs
     * (sendtoaddress, getbalance) working even if extra wallets get loaded on
     * the same node later. Legacy single-wallet chains (Dogecoin v1.14.x) never
     * take this path - their probe succeeds on the base URL.
     */
    async ensureWalletLoaded(){
        let walletLoaded = false
        try {
            await this.connector.loadWallet(this.walletNameParam)
            walletLoaded = true
        } catch(err){
            //The named wallet couldn't be loaded (may not exist, or RPC unsupported)
        }

        if (!walletLoaded){
            console.log("Wallet not found. Creating a new wallet")
            try{
                await this.createWallet(this.walletNameParam)
            } catch(err){
                throw new Error(`Could not create wallet '${this.walletNameParam}' on regtest node (chain may not support createwallet RPC, e.g. Dogecoin v1.14.x): ${err.message}`)
            }
        }
        this.connector.setWalletName(this.walletNameParam)
    }

    async sendFundsToAddress(address, amount){
        if (typeof address !== 'string' || address.length === 0) {
            throw new Error('Invalid address: must be a non-empty string')
        }
        if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
            throw new Error('Invalid amount: must be a positive finite number')
        }
        try {
            return await this.connector.sendToAddress(address, amount)
        } catch (err) {
            // A node RESTARTED under a long-running miner comes back with no
            // wallet loaded, and the wallet is bootstrapped exactly once, at
            // miner startup. Every funding call then fails forever while
            // mining keeps working, because generatetoaddress reuses the
            // address cached before the restart - so the venue looks alive and
            // is unusable. Measured 2026-08-11: BTC regtest sat like this for
            // 30 hours and read, from the outside, as an unexplained
            // "Error sending funds to address".
            if (!err || !err.walletMissing) throw err
            console.log('Wallet is no longer loaded on the node (restarted?); reloading and retrying once')
            await this.ensureWalletLoaded()
            return await this.connector.sendToAddress(address, amount)
        }
    }

    
    async createWallet(walletName){
        try {
            await this.connector.createWallet(walletName)
            return true
        } catch(err){
            throw new Error('Error creating wallet: ' + (err && err.message ? err.message : err))
        }
    }
    
    async prepareWallet(){
        console.log("Checking wallet availability")

        // Probe with getNewAddress: succeeds whenever ANY wallet is usable,
        // including modern Bitcoin Core 0.17+ with an already-loaded named
        // wallet, or legacy single-wallet chains (Dogecoin v1.14.x, older
        // Litecoin) that auto-load a default wallet and don't implement
        // createwallet / loadwallet / listwallets at all.
        //
        // Retry the probe for a few seconds because legacy daemons accept
        // RPC requests before their wallet has finished loading. Dogecoin
        // v1.14 in particular reliably loses this race on the first start
        // after a fresh `xchain-node reset` (the miner crashes because
        // `createWallet` as the fallback isn't supported on DOGE). A handful
        // of 1-second retries covers wallet load in practice.
        let probeAddress = null
        const PROBE_MAX_ATTEMPTS = 10
        const PROBE_INTERVAL_MS  = 1000
        for (let attempt = 1; attempt <= PROBE_MAX_ATTEMPTS; attempt++) {
            try {
                probeAddress = await this.connector.getNewAddress()
                break
            } catch(err){
                if (attempt < PROBE_MAX_ATTEMPTS) {
                    await this.sleep(PROBE_INTERVAL_MS)
                }
                // After the last attempt, fall through to the load/create path.
            }
        }

        if (probeAddress == null){
            await this.ensureWalletLoaded()
            console.log("Getting a new address to receive blocks reward")
            this.walletAddress = await this.connector.getNewAddress()
        } else {
            // Probe succeeded; wallet is already usable, use that address
            this.walletAddress = probeAddress
        }
        
        console.log("Checking wallet balance")
        this.balance = await this.connector.getBalance()
        
        if (this.balance <= 0){
            console.log("Mining blocks to get balance in the wallet")
            // Always mine to coinbase-maturity depth regardless of current chain
            // height: fewer blocks (e.g. a single one on an aged chain) would only
            // add an immature coinbase (spendable after 100 confirmations), leaving
            // the balance at 0 while walletReady is about to be set true. The
            // bounded balance re-poll below is the real readiness guard.
            await this.generateBlocks(101)

            // Re-poll the balance in a bounded loop instead of trusting the
            // mining call: ping/status export walletReady as the readiness
            // oracle, so it must reflect an observed spendable balance, not
            // just that a mining RPC was issued.
            const BALANCE_POLL_MAX_ATTEMPTS = 10
            const BALANCE_POLL_INTERVAL_MS = 1000
            for (let attempt = 1; attempt <= BALANCE_POLL_MAX_ATTEMPTS; attempt++) {
                this.balance = await this.connector.getBalance()
                if (this.balance > 0){
                    break
                }
                if (attempt < BALANCE_POLL_MAX_ATTEMPTS) {
                    await this.sleep(BALANCE_POLL_INTERVAL_MS)
                }
            }

            if (this.balance <= 0){
                throw new Error("Wallet balance still 0 after mining to maturity; cannot mark wallet ready")
            }
        }

        // Stamp the startup read so the auto-mine loop's cadence starts one full
        // interval from here rather than firing a redundant getbalance on its very
        // first tick, which would also null the balance just measured on any venue
        // whose connector answers that call less reliably than this one just did.
        this._balanceReadAt = Date.now()

        // Pin a fixed, low wallet fee rate so funding sends (sendtoaddress) never
        // consult estimatesmartfee, which inflates on a matured regtest chain and
        // trips the daemon's -maxtxfee ceiling (RPC error -6), silently breaking
        // funded-address tests late in a long e2e run. 0.001 coins/kB is well above
        // every supported chain's relayfee floor (BTC/LTC 0.00001, DOGE 0.001) so
        // txs still relay, and valueless on regtest. Best-effort: a daemon that
        // rejects settxfee just falls back to the estimate path.
        const feePinned = await this.connector.setTxFee(0.001)
        console.log(feePinned
            ? 'Pinned wallet fee rate to 0.001/kB (regtest estimatesmartfee bypass)'
            : 'settxfee not honored by this daemon; funding sends use the fee estimate')

        // Wallet is fully prepared (address assigned, coinbase matured): wallet-dependent
        // RPCs (generateToAddress) are now safe. Callers gate on this via ping/status,
        // closing the cold-start race where ping returned success before walletAddress was set.
        //
        // Startup-completion only, and never re-evaluated afterwards: a simulated reorg deep
        // enough to disconnect the matured coinbase leaves this true while the wallet can no
        // longer fund a send, so a reorg drill must read wallet_funded / wallet_balance from
        // status rather than wallet_ready. Whether this flag should instead become
        // a live fund-capability oracle is an open call, because the container health probe
        // reads it as startup-completion and would report the miner degraded for
        // the duration of every deliberate reorg drill. The published contract says
        // startup-completion as well (xchain-documentation, components/regtest-miner/
        // operations.md, the wallet_ready row of the status field table), so redefining this
        // flag is a docs change in a separate repo rather than a local one.
        this.walletReady = true
    }

    // Throws on invalid count (uuid:24c35056 sibling fix): the previous
    // sentinel-return `[]` let generate_blocks({count:0|-1|'abc'}) silently
    // answer {count: 0, hashes: []} through the controller with no error.
    async generateBlocks(count) {
        if (!Number.isInteger(count) || count <= 0) {
            throw new Error("count must be a positive integer")
        }
        // Cap the per-call block count. generatetoaddress mines synchronously on the
        // node, so an unbounded count (e.g. from the unauthenticated-by-default
        // generate_blocks RPC) blocks the node for minutes-to-forever; and because
        // every mining caller serializes behind _generateQueue, that one call also
        // wedges the auto-mine loop and every pause/fillMempool barrier queued behind
        // it. fillMempool is already capped the same way (MAX_FILL_MEMPOOL_QUANTITY);
        // this closes the sibling gap on the block-generation path.
        if (count > MAX_GENERATE_BLOCKS) {
            throw new Error("count exceeds maximum of " + MAX_GENERATE_BLOCKS)
        }
        // Serialize all callers (auto-mine loop + generate_blocks RPC) behind a
        // single promise chain so concurrent calls never issue overlapping
        // generateToAddress requests against the node. The chain itself is kept
        // on a rejection-swallowing tail (`.catch`) so that one failed mining
        // attempt does not poison the queue: the next caller still runs, while
        // this caller still receives its own success/failure via `run`.
        // Snapshot the reorgs in flight at APPEND time. A reorg raised later
        // captured the queue tail this append is joining, so it already waits for
        // this mine; making this mine wait for it too is the deadlock.
        const heldBy = [...this._reorgMineHolds.values()].map((hold) => hold.held)
        const run = this._generateQueue.then(() => this._mineWhenReorgIdle(count, heldBy))
        this._generateQueue = run.catch(() => {})
        return run
    }

    async _generateBlocks(numberOfBlocks){
        let hashes = await this.connector.generateToAddress(numberOfBlocks, this.walletAddress)

        // Count every mine that flows through this serialized chokepoint (auto-mine
        // loop, generate_blocks RPC, fillMempool, prepareWallet warmup). blocks_mined
        // is a monotonic count of blocks this service generated (mining work
        // performed), not chain height: it intentionally does NOT decrement after an
        // invalidate_block rollback.
        this._blocksMined += numberOfBlocks
        this._lastMineAt = Date.now()

        if (numberOfBlocks > 1){
            console.log(numberOfBlocks+" new blocks have been generated")
        } else if (numberOfBlocks > 0){
            console.log("A new block has been generated")
        }
        return hashes
    }
    
    async start(){
        await this.prepareWallet()

        console.log("Ready. Checking for new txs")

        // Graceful shutdown on SIGTERM/SIGINT: stop the mining loop, close the API
        // server, then exit. Merely flipping this._shutdown is not enough: registering
        // a signal listener suppresses Node's default terminate, and the listening
        // Express server keeps the event loop alive, so the process would hang until
        // docker's stop-grace SIGKILL. Close the server (thread in via api.js) and exit.
        this._sigTermHandler = (signal) => {
            console.log("Received " + (signal || "SIGTERM") + ", shutting down gracefully...")
            this._shutdown = true
            const done = () => process.exit(0)
            if (this.apiServer && typeof this.apiServer.close === "function") {
                this.apiServer.close(done)
                // Failsafe: force exit if lingering keep-alive sockets stall close().
                setTimeout(done, 2000).unref()
            } else {
                done()
            }
        }
        process.on('SIGTERM', () => this._sigTermHandler('SIGTERM'))
        process.on('SIGINT',  () => this._sigTermHandler('SIGINT'))

        let lastRawMempoolLength = 0
        let initialStartToMine = 0
        let extendedStartToMine = 0
        let consecutiveErrors = 0
        const MAX_BACKOFF_MS = 30000
        // Baseline for the mine-empty heartbeat on a miner that has not mined yet,
        // so enabling it never fires a block the instant the loop starts.
        const watchingSince = Date.now()
        this.keepMining = true
        this._miningStateGeneration++
        // Reached only after prepareWallet() resolved, so from here a keepMining=false
        // is an operator pause rather than startup. Never reset: pauseMining() only
        // clears keepMining, and a paused loop has still started.
        this.miningStarted = true

        while (!this._shutdown){
            // Bound wallet_balance staleness at WALLET_BALANCE_REFRESH_MS whatever
            // moved the wallet: send_funds, fill_mempool, coinbase maturity, a
            // node-side change. Deliberately ABOVE the keepMining gate, because
            // fill_mempool and pause_mining hold that flag false for exactly the
            // windows in which the wallet drains, and a refresh that only ran while
            // mining would go quiet at the moment it is needed. refreshWalletFunds()
            // never throws, so this cannot break the loop; and both mine sites below
            // re-read keepMining immediately before generateBlocks, so this await
            // cannot reopen the pause barrier window those guards close.
            if (this._walletRefreshDue(Date.now())) {
                await this.refreshWalletFunds()
            }
            if (this.keepMining){
                if ((initialStartToMine > 0) && (extendedStartToMine > 0)){
                    let timeNow = Date.now()
                    let initialTimePassed = timeNow-initialStartToMine
                    let extendedStartTime = timeNow-extendedStartToMine

                    if ((initialTimePassed >= this.maxTimeToMineTxs) || (extendedStartTime >= this.addedTimeToMineTxs)){
                        // Re-read keepMining immediately before mining, with NO await
                        // between the check and the call. generateBlocks appends to
                        // _generateQueue synchronously, so a pause that lands after this
                        // check is already behind the barrier pauseMining()/fillMempool()
                        // await, and one that lands before it stops the mine outright.
                        // Nothing awaits between the loop's own keepMining check above and
                        // here today, so this guard changes no behavior at this site; it
                        // pins the invariant so inserting an await above cannot silently
                        // reopen the window the idle-mine site below actually had.
                        if (!this.keepMining) { await this.sleep(CHECK_BLOCK_DELAY_MS); continue }
                        try {
                            await this.generateBlocks(1)
                            consecutiveErrors = 0
                            this._consecutiveErrors = 0
                            // blocks_mined / last_mine_at are updated in _generateBlocks
                            // (the chokepoint all mining paths flow through).
                        } catch (err){
                            consecutiveErrors++
                            this._consecutiveErrors = consecutiveErrors
                            let backoff = Math.min(CHECK_BLOCK_DELAY_MS * Math.pow(2, consecutiveErrors), MAX_BACKOFF_MS)
                            console.log("There were problems generating a new block: "+(err && err.message ? err.message : err)+"; retrying in "+backoff+"ms.")
                            await this.sleep(backoff)
                            continue
                        }

                        initialStartToMine = 0
                        extendedStartToMine = 0
                        lastRawMempoolLength = 0
                    }
                }

                let rawMempool = null
                try {
                    rawMempool = await this.connector.getRawMempool()
                    consecutiveErrors = 0
                    this._consecutiveErrors = 0
                } catch (error){
                    consecutiveErrors++
                    this._consecutiveErrors = consecutiveErrors
                    let backoff = Math.min(CHECK_BLOCK_DELAY_MS * Math.pow(2, consecutiveErrors), MAX_BACKOFF_MS)
                    console.log("There were problems getting the mempool: "+(error && error.message ? error.message : error)+"; retrying in "+backoff+"ms.")
                    await this.sleep(backoff)
                    continue
                }

                if (rawMempool != null && rawMempool.length > 0){
                    if (rawMempool.length > lastRawMempoolLength){
                        if (initialStartToMine == 0){
                            initialStartToMine = Date.now()
                            extendedStartToMine = initialStartToMine
                        } else {
                            extendedStartToMine = Date.now()
                        }
                    }
                    lastRawMempoolLength = rawMempool.length
                    this._mempoolSize = rawMempool.length
                } else {
                    initialStartToMine = 0
                    extendedStartToMine = 0
                    lastRawMempoolLength = 0
                    this._mempoolSize = 0

                    // Mine-empty heartbeat (off unless IDLE_MINE_INTERVAL_MS /
                    // set_idle_mine_interval turned it on). Only on the empty-mempool
                    // branch: a pending transaction has its own timer above, and
                    // racing it would mine the block early.
                    if (this._idleMineDue(Date.now(), watchingSince)){
                        // The real window this guard closes. The loop's keepMining check
                        // sits above the `await this.connector.getRawMempool()` a few lines
                        // back, so a pauseMining()/fillMempool() that flipped the flag
                        // during that RPC had already cleared its _generateQueue barrier
                        // and returned by the time control reached here: the heartbeat then
                        // landed a block INSIDE a section the caller had been told was
                        // serialized, corrupting exactly the height-deterministic reorg and
                        // mempool drills the barrier exists for.
                        if (!this.keepMining) { await this.sleep(CHECK_BLOCK_DELAY_MS); continue }
                        try {
                            await this.generateBlocks(1)
                            consecutiveErrors = 0
                            this._consecutiveErrors = 0
                        } catch (err){
                            consecutiveErrors++
                            this._consecutiveErrors = consecutiveErrors
                            let backoff = Math.min(CHECK_BLOCK_DELAY_MS * Math.pow(2, consecutiveErrors), MAX_BACKOFF_MS)
                            console.log("There were problems mining an idle block: "+(err && err.message ? err.message : err)+"; retrying in "+backoff+"ms.")
                            await this.sleep(backoff)
                            continue
                        }
                    }
                }
            }
            await this.sleep(CHECK_BLOCK_DELAY_MS)
        }
    }

    getStatus(){
        return {
            wallet_ready: this.walletReady,
            // Fund-capability, read at startup, at both reorg termini, and by the
            // auto-mine loop at most WALLET_BALANCE_REFRESH_MS apart, so the value is
            // never staler than that interval whatever drained the wallet.
            // wallet_ready is a startup-completion flag and stays true across a reorg
            // by design, so a drill that needs to know whether the wallet can still
            // fund a send reads these instead. wallet_balance is null when the last
            // read failed or none has happened, which is not funded either: a transient
            // getbalance failure therefore flips wallet_funded false for one interval,
            // and that direction is deliberate, because a false unfunded is safe where
            // a false funded is not. wallet_balance_at is the epoch-ms timestamp of the
            // last read ATTEMPT (null if none), so a drill can tell a fresh reading
            // from a wedged one rather than inferring liveness from the number alone.
            wallet_balance: this.balance,
            wallet_funded: typeof this.balance === 'number' && this.balance > 0,
            wallet_balance_at: this._balanceReadAt,
            mempool_size: this._mempoolSize,
            // 0 = mempool-driven mining only (the default). Non-zero = the loop
            // also mines one empty block per interval while the mempool is empty,
            // so height-gated states (stake activation, confirmation depth) advance
            // on an idle chain without dropping to raw node RPC.
            idle_mine_interval_ms: this.idleMineIntervalMs,
            blocks_mined: this._blocksMined,
            last_mine_at: this._lastMineAt,
            consecutive_errors: this._consecutiveErrors,
            // Surface the paused state so a fill_mempool / invalidate_block that was never
            // paired with continue_mining is observable as a deliberate pause rather than
            // reading as a node hang (the loop holds keepMining=false until resumed).
            mining_paused: !this.keepMining,
            // Distinguishes the identical keepMining=false of a miner still preparing
            // its wallet from that of a paused one, so a probe can call the first a
            // stall and the second healthy.
            mining_started: this.miningStarted
        }
    }
}

module.exports = XChainRegtestMiner