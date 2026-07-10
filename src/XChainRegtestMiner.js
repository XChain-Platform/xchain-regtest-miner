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

// Load required libraries
const BlockchainConnector = require('./BlockchainConnector.js')
const CryptoNetworks = require('./CryptoNetworks.js')

// CHECK_BLOCK_DELAY_MS controls how often the loop wakes to poll the mempool and
// check timers. It is intentionally much shorter than MIN_MINING_TIME (1000ms) so
// that the loop fires close to the timer deadline rather than up to 1× late. A 100ms
// poll adds only ~100ms worst-case overshoot instead of the previous 1000ms (100%).
const CHECK_BLOCK_DELAY_MS = 100 //100ms poll interval; decoupled from MIN_MINING_TIME
const SATOSHI_UNIT = 100000000.0

const DEFAULT_MAX_TIME_TO_MINE_TXS = 30000 //max 30 seconds to mine a block after the first tx is found in the mempool
const DEFAULT_ADDED_TIME_TO_MINE_TXS = 5000 //5 seconds extra before mining a block every time a new tx appears in the mempool

const MAX_MINING_TIME = 3600000 //1 hour max for mining timers
const MIN_MINING_TIME = 1000 //1 second minimum for mining timers
const MAX_FILL_MEMPOOL_QUANTITY = 50000 //max number of transactions to fill the mempool with
const MAX_SEND_RETRIES = 50 //max retries for sending funds in fillMempool
const MAX_GENERATE_BLOCKS = 10000 //max blocks a single generateBlocks call may mine (see cap note below)


//This is useful only for filling the mempool
const { BIP32Factory } = require('bip32')
const ecc = require('tiny-secp256k1')
const bip32 = BIP32Factory(ecc)
const bip39 = require('bip39')
const bitcoin = require('bitcoinjs-lib');
const psbtutils = require('bitcoinjs-lib/src/psbt/psbtutils');
const {ECPairFactory} = require('ecpair')

class XChainRegtestMiner {
    constructor(network, nodeUrl, nodePort, nodeUser, nodePassword) {
      this.network = network
      this.connector = new BlockchainConnector(nodeUrl, nodePort, nodeUser, nodePassword)
      this.walletNameParam = "xchain_regtest_wallet"
      this.keepMining = false
      this.maxTimeToMineTxs = DEFAULT_MAX_TIME_TO_MINE_TXS
      this.addedTimeToMineTxs = DEFAULT_ADDED_TIME_TO_MINE_TXS
      this.fillMempoolRunning = false
      this._generateQueue = Promise.resolve()
      this.walletReady = false
      this._mempoolSize = 0
      this._blocksMined = 0
      this._lastMineAt = null
      this._consecutiveErrors = 0
    }
    
    async sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    
    async setMiningTime(maxTime, txAddedTime){
        if (!Number.isInteger(maxTime) || !Number.isInteger(txAddedTime) || maxTime <= 0 || txAddedTime <= 0){
            try { console.log("INVALID mining times: (Max Time)=>"+maxTime+"ms (Tx Added Time)=>"+txAddedTime+"ms") } catch(e) { console.log("INVALID mining times (non-printable values)") }
            return {error: "Invalid mining times. Both values must be positive integers."}
        }
        if (maxTime < MIN_MINING_TIME || txAddedTime < MIN_MINING_TIME){
            console.log("Mining times too small: minimum is "+MIN_MINING_TIME+"ms")
            return {error: "Mining times too small. Minimum is "+MIN_MINING_TIME+"ms."}
        }
        if (maxTime > MAX_MINING_TIME || txAddedTime > MAX_MINING_TIME){
            console.log("Mining times too large: maximum is "+MAX_MINING_TIME+"ms")
            return {error: "Mining times too large. Maximum is "+MAX_MINING_TIME+"ms."}
        }
        this.maxTimeToMineTxs = maxTime
        this.addedTimeToMineTxs = txAddedTime
        console.log("New mining times: (Max Time)=>"+maxTime+"ms (Tx Added Time)=>"+txAddedTime+"ms")
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
            try {
            // Mirror pauseMining's barrier: wait for any in-flight generateBlocks(1)
            // to settle before proceeding, so a mine that started just before the
            // flag flip can't land a new block while fillMempool is running.
            await this._generateQueue
            console.log("Filling mempool with "+txQuantity+" transactions")
            //let AMOUNT_FOR_EACH_ADDRESS = 0.000001
            //let FEE = 0.00001
            
            let OUTPUTS_QUANTITY_PER_TX = 2500

            //Create a seed
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
            // don't reject the stress txs. Bitcoin regtest has no dustThreshold
            // field, so we default to 1000 sat (same as before).
            const coinDust = (network && network.dustThreshold) ? network.dustThreshold : 1000
            let AMOUNT_FOR_EACH_ADDRESS = Math.max(coinDust, 1000)
            let FEE = Math.max(coinDust, 1000)
            var mnemonic = bip39.generateMnemonic()
            var seed = bip39.mnemonicToSeedSync(mnemonic)
            var root = bip32.fromSeed(seed, network)
            var account = root.derivePath("m/44'/0'/0'/0")
            var address = account.derive(0).derive(0)
            var mainAddress = bitcoin.payments.p2pkh({ pubkey: address.publicKey, network }).address
            console.log("Main address to fill the mempool: "+mainAddress)

            
            console.log("Creating "+txQuantity+" addresses")
            //Create txQuantity different addresses
            let addresses = []
            for (let i=0;i<txQuantity;i++){
                let nextAddress = account.derive(i+1).derive(0)
                addresses.push(nextAddress)
            }

            console.log("Sending funds to the main address")
            //Ask for bitcoins
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
                    AMOUNT_FOR_EACH_ADDRESS*txRemainder + //Amount for every address
                    FEE*txRemainder + //Fee that every address must pay to send the amount
                    50*txRemainder
                
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
                //await this.generateBlocks(1)
                //let rawTransaction = await this.connector.getRawTransaction(txid)
            }
            await this.generateBlocks(1)
            
            /*let totalAmount = 
                AMOUNT_FOR_EACH_ADDRESS*txQuantity + //Amount for every address
                FEE*txQuantity + //Fee that every address must pay to send the amount
                50*txQuantity //Estimated fee to send the first tx with txQuantity outputs
            let txid = await this.sendFundsToAddress(mainAddress, totalAmount/SATOSHI_UNIT)
            await this.generateBlocks(1)
            let rawTransaction = await this.connector.getRawTransaction(txid)*/
            
            
            //Find the utxos
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
                
                //Create a single transaction with txQuantity outputs
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
            
                var ECPair = ECPairFactory(ecc)
                let keyToSign = ECPair.fromPrivateKey(address.privateKey, { network })

                for (let nextInputIndex=0;nextInputIndex < psbt.data.inputs.length;nextInputIndex++){
                    psbt.signInput(parseInt(nextInputIndex), keyToSign)
                }
            
                psbt.finalizeAllInputs()
                let extractedTransaction = psbt.extractTransaction()
                let txVirtualSize = extractedTransaction.virtualSize()
                let txHex = extractedTransaction.toHex()
                
                nextUtxo["txHex"] = txHex
                nextUtxo["txIdSource"] = await this.connector.sendRawTransaction(txHex)
            }
            
            
            
            //Mine a block
            await this.generateBlocks(1)
            
            //Create txQuantity transactions to stress the mempool
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

    // Invalidates a block by hash, triggering a node-side rollback to the fork
    // point. Auto-mining is paused beforehand so the miner does not race ahead
    // with new blocks while the reorg is being constructed; callers must call
    // continueMining() when done.
    async invalidateBlock(blockHash) {
        if (typeof blockHash !== 'string' || blockHash.length === 0) {
            throw new Error('invalidateBlock: blockHash must be a non-empty string')
        }
        await this.pauseMining()
        return await this.connector.invalidateBlock(blockHash)
    }

    // Re-enables consideration of a previously invalidated block, letting the
    // node resolve which chain is longest. Should be called after the competing
    // branch is mined and before continueMining().
    async reconsiderBlock(blockHash) {
        if (typeof blockHash !== 'string' || blockHash.length === 0) {
            throw new Error('reconsiderBlock: blockHash must be a non-empty string')
        }
        return await this.connector.reconsiderBlock(blockHash)
    }

    async pauseMining(){
        this.keepMining = false
        // Barrier: a pause that lands between the loop's keepMining check and its
        // generateBlocks(1) would let one more block settle after pause() resolves,
        // breaking a height-deterministic generateBlocks section. Await the in-flight
        // mine so callers get a true barrier.
        await this._generateQueue
    }

    async continueMining(){
        this.keepMining = true
    }
    
    async sendFundsToAddress(address, amount){
        if (typeof address !== 'string' || address.length === 0) {
            throw new Error('Invalid address: must be a non-empty string')
        }
        if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
            throw new Error('Invalid amount: must be a positive finite number')
        }
        return await this.connector.sendToAddress(address, amount)
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
            // We took the load-or-create path, which means the daemon
            // supports named wallets (Bitcoin Core 0.17+). Pin the
            // connector to THIS wallet via /wallet/<name>/ URI routing so
            // subsequent wallet RPCs (sendtoaddress, getbalance, etc.)
            // continue to work even if extra wallets get loaded on the
            // same node later. The probe-succeeded path (else branch) is
            // either legacy (Dogecoin v1.14.x) or single-wallet modern,
            // both of which work fine on the base URL.
            this.connector.setWalletName(this.walletNameParam)
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
            let blockchainInfo = await this.connector.getBlockchainInfo()
            if (blockchainInfo["blocks"] <= 100){
                await this.generateBlocks(101)
            } else {
                await this.generateBlocks(1)
            }
        }

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
        this.walletReady = true
    }

    generateBlocks(count) {
        if (!Number.isInteger(count) || count <= 0) return [];
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
        const run = this._generateQueue.then(() => this._generateBlocks(count))
        this._generateQueue = run.catch(() => {})
        return run
    }

    async _generateBlocks(numberOfBlocks){
        let hashes = await this.connector.generateToAddress(numberOfBlocks, this.walletAddress)

        if (numberOfBlocks > 1){
            console.log(numberOfBlocks+" new blocks have been generated")
        } else if (numberOfBlocks > 0){
            console.log("A new block has been generated")
        }
        return hashes
    }
    
    async start(){
        //Prepare the wallet
        await this.prepareWallet()

        //Loop to check if there are transactions in the mempool, if there are, then
        //Wait some time for new txs, if there is a new tx in that time, then extended the waiting time again
        //If there are no new tx in that time, then mine a block
        console.log("Ready. Checking for new txs")

        // Graceful shutdown on SIGTERM: allow current loop iteration to complete
        this._sigTermHandler = () => {
            console.log("Received SIGTERM, shutting down gracefully...")
            this._shutdown = true
        }
        process.on('SIGTERM', this._sigTermHandler)

        let lastRawMempoolLength = 0
        let initialStartToMine = 0
        let extendedStartToMine = 0
        let consecutiveErrors = 0
        const MAX_BACKOFF_MS = 30000
        this.keepMining = true

        while (!this._shutdown){
            if (this.keepMining){
                if ((initialStartToMine > 0) && (extendedStartToMine > 0)){
                    let timeNow = Date.now()
                    let initialTimePassed = timeNow-initialStartToMine
                    let extendedStartTime = timeNow-extendedStartToMine

                    if ((initialTimePassed >= this.maxTimeToMineTxs) || (extendedStartTime >= this.addedTimeToMineTxs)){
                        try {
                            await this.generateBlocks(1)
                            consecutiveErrors = 0
                            this._consecutiveErrors = 0
                            this._blocksMined++
                            this._lastMineAt = Date.now()
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
                        //there are new txs in the mempool
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
                }
            }
            await this.sleep(CHECK_BLOCK_DELAY_MS)
        }
    }

    getStatus(){
        return {
            wallet_ready: this.walletReady,
            mempool_size: this._mempoolSize,
            blocks_mined: this._blocksMined,
            last_mine_at: this._lastMineAt,
            consecutive_errors: this._consecutiveErrors,
            // Surface the paused state so a fill_mempool / invalidate_block that was never
            // paired with continue_mining is observable as a deliberate pause rather than
            // reading as a node hang (the loop holds keepMining=false until resumed).
            mining_paused: !this.keepMining
        }
    }
}

module.exports = XChainRegtestMiner