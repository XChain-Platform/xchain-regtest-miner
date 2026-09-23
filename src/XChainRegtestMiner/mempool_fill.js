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
 * XChain Regtest Miner - Mempool Fill
 *
 * Fills the mempool with funded stress transactions and refreshes the
 * observed wallet balance, installed onto the XChainRegtestMiner prototype.
 *
 ********************************************************************/

'use strict';

const CryptoNetworks = require('../networks/crypto_networks.js')
const bip39 = require('bip39')
const bitcoin = require('bitcoinjs-lib');
const {
    WALLET_BALANCE_REFRESH_MS,
    SATOSHI_UNIT,
    MAX_FILL_MEMPOOL_QUANTITY,
    MAX_SEND_RETRIES,
    bip32,
    logger,
    ECPair
} = require('./constants.js')

// Resolves the coin network, the per-output amounts and a fresh HD key tree: the
// main address that collects the funding plus one derived key per stress tx.
function deriveFillKeys(txQuantity){
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
        logger.info("WARNING: NETWORK='"+this.network+"' did not resolve to a coin-specific network; falling back to bitcoin.networks.regtest for fillMempool. Set NETWORK to a coin-network form (e.g. dogecoin-regtest) for correct coin params.")
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
    logger.info("Main address to fill the mempool: "+mainAddress)

    logger.info("Creating "+txQuantity+" addresses")
    //Create txQuantity different addresses
    let addresses = []
    for (let i=0;i<txQuantity;i++){
        let nextAddress = account.derive(i+1).derive(0)
        addresses.push(nextAddress)
    }
    return { OUTPUTS_QUANTITY_PER_TX, AMOUNT_FOR_EACH_ADDRESS, FEE, SPLIT_TX_FEE_PER_OUTPUT, network, address, mainAddress, addresses }
}

// Sends the wallet funds to the main address in chunks of OUTPUTS_QUANTITY_PER_TX
// outputs and confirms them. Resolves the chunk txids in send order.
async function fundMainAddress(txQuantity, { OUTPUTS_QUANTITY_PER_TX, AMOUNT_FOR_EACH_ADDRESS, FEE, SPLIT_TX_FEE_PER_OUTPUT, mainAddress }){
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
            SPLIT_TX_FEE_PER_OUTPUT*txRemainder //Miner fee left on the split tx (coin-scaled)

        logger.info("Sending "+totalAmount/SATOSHI_UNIT+" ("+i+") to "+mainAddress)

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
                logger.info("Error sending funds: "+detail+"; retrying (attempt "+sendRetries+"/"+MAX_SEND_RETRIES+")")
                await this.sleep(1000)
            }
        }
        chunksTxids.push(txid)
        processedChunkCount++

        if (processedChunkCount>=20){
            // Fill's OWN funding mine: takes the private entry point, because the
            // public entry point is refusing mines for the duration of this
            // fill and would otherwise reject the fill's own work.
            await this.generateBlocksQueued(1)
            processedChunkCount = 0
        }
    }
    await this.generateBlocksQueued(1)
    return chunksTxids
}

// Finds the output paying the main address in each confirmed chunk transaction.
async function findFundingUtxos(chunksTxids, { network, mainAddress }){
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
    return utxos
}

// Spends each funding utxo into one output per derived address, recording the
// signed tx and its txid on the utxo entry for the stress loop to spend.
async function splitFundingUtxos(utxos, { OUTPUTS_QUANTITY_PER_TX, AMOUNT_FOR_EACH_ADDRESS, FEE, network, address, addresses }){
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
}

async function stressMempool(utxos, { OUTPUTS_QUANTITY_PER_TX, AMOUNT_FOR_EACH_ADDRESS, network, mainAddress, addresses }){
    // Creates txQuantity transactions to stress the mempool.
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

        logger.info("Stressing the mempool with the transaction number "+nextAddressIndex)

        let keyToSign = ECPair.fromPrivateKey(nextAddress.privateKey, { network })
        psbt.signInput(0, keyToSign)
        psbt.finalizeAllInputs()
        let outputTxHex = psbt.extractTransaction().toHex()


        await this.connector.sendRawTransaction(outputTxHex)
    }
}

module.exports = {
    async fillMempool(txQuantity){
            if (this.fillMempoolRunning) {
                logger.info("fillMempool is already running, rejecting concurrent call")
                throw new Error("fillMempool is already running")
            }

            if (!Number.isInteger(txQuantity) || txQuantity < 1) {
                try { logger.info("INVALID txQuantity: "+txQuantity+". Must be a positive integer.") } catch(e) { logger.info("INVALID txQuantity (non-printable value). Must be a positive integer.") }
                throw new Error("txQuantity must be a positive integer")
            }

            if (txQuantity > MAX_FILL_MEMPOOL_QUANTITY) {
                logger.info("txQuantity "+txQuantity+" exceeds maximum of "+MAX_FILL_MEMPOOL_QUANTITY)
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
            logger.info("Filling mempool with "+txQuantity+" transactions")
            const plan = deriveFillKeys.call(this, txQuantity)

            logger.info("Sending funds to the main address")
            const chunksTxids = await fundMainAddress.call(this, txQuantity, plan)
            const utxos = await findFundingUtxos.call(this, chunksTxids, plan)

            logger.info("Creating the transactions to send funds to those addresses")
            await splitFundingUtxos.call(this, utxos, plan)
            await this.generateBlocksQueued(1)

            await stressMempool.call(this, utxos, plan)

            } finally {
                this.fillMempoolRunning = false
            }
    },

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
            logger.info("Could not re-read the wallet balance: "+(err && err.message ? err.message : err))
            this.balance = null
        }
        this._balanceReadAt = Date.now()
        return this.balance
    },

    // True when the auto-mine loop owes a balance refresh. Split out as a
    // predicate (same shape as idleMineDue) because the interval guard is the
    // load-bearing part: the loop wakes every CHECK_BLOCK_DELAY_MS, so a guard
    // that mis-answers turns one RPC per 5s into ten per second.
    walletRefreshDue(now) {
        if (this._balanceReadAt == null) return true
        return (now - this._balanceReadAt) >= WALLET_BALANCE_REFRESH_MS
    }
}
