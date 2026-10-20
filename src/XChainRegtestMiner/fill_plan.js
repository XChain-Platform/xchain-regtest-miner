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
 * XChain Regtest Miner - Fill Plan
 *
 * The first half of fill_mempool: derives the key tree and amounts for the
 * stress transactions, funds the main address and locates the funding outputs.
 *
 ********************************************************************/

'use strict';

const CryptoNetworks = require('../networks/crypto_networks.js')
const bip39 = require('bip39')
const bitcoin = require('bitcoinjs-lib');
const {
    SATOSHI_UNIT,
    MAX_SEND_RETRIES,
    bip32,
    logger
} = require('./constants.js')

// Stress-tx output and fee floors (base units) where mining is stricter than relay: Dogecoin
// 1.14 mines at 0.01 DOGE/kB with a 0.01 DOGE soft dust limit, so a 0.001 DOGE fee on the
// ~192-byte tx drained one per block. 0.005 DOGE is ~0.026/kB, under bitcoinjs' fee cap.
const STRESS_TX_POLICY_FLOOR_BY_COIN = { dogecoin: { amount: 1000000, fee: 500000 } }

// The per-output amount, the per-tx fee and the split-tx fee for the resolved coin
// network. `networkName` is the miner's NETWORK string, which picks the mining floor.
function fillAmounts(network, networkName){
    // Scale amounts to the coin's dust threshold so DOGE/LTC regtest
    // nodes (which have much higher minimum relay fees than Bitcoin)
    // don't reject the stress txs. The 1000-sat default applies only on the
    // FALLBACK path in deriveFillKeys (a bare NETWORK='regtest', which resolves to the
    // bitcoinjs-lib built-in and carries no dustThreshold). The resolved coin
    // form 'bitcoin-regtest' DOES define one (546), so this is 1000 there only
    // because 546 < 1000.
    const coinDust = (network && network.dustThreshold) ? network.dustThreshold : 1000
    // Also clear the mining floor, or continue_mining never drains the stress txs.
    const floor = STRESS_TX_POLICY_FLOOR_BY_COIN[String(networkName || '').split('-')[0].toLowerCase()] || {}
    let AMOUNT_FOR_EACH_ADDRESS = Math.max(coinDust, 1000, floor.amount || 0)
    let FEE = Math.max(coinDust, 1000, floor.fee || 0)
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
    return { AMOUNT_FOR_EACH_ADDRESS, FEE, SPLIT_TX_FEE_PER_OUTPUT }
}

// Resolves the coin network, the per-output amounts and a fresh HD key tree: the
// main address that collects the funding plus one derived key per stress tx.
function deriveFillKeys(txQuantity){
    const OUTPUTS_QUANTITY_PER_TX = 2500

    // Resolve coin-specific bitcoinjs params (P2PKH version byte, WIF,
    // bip32) from the coin-network identifier so DOGE/LTC addresses and
    // PSBTs encode correctly, not just Bitcoin. Falls back to Bitcoin
    // regtest when only a bare network ("regtest") was supplied.
    var network = CryptoNetworks.getBitcoinJsNetwork(this.network) || bitcoin.networks.regtest
    if (!CryptoNetworks.getBitcoinJsNetwork(this.network)) {
        logger.info("WARNING: NETWORK='"+this.network+"' did not resolve to a coin-specific network; falling back to bitcoin.networks.regtest for fillMempool. Set NETWORK to a coin-network form (e.g. dogecoin-regtest) for correct coin params.")
    }

    const { AMOUNT_FOR_EACH_ADDRESS, FEE, SPLIT_TX_FEE_PER_OUTPUT } = fillAmounts(network, this.network)
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

// Sends `amount` to `address`, retrying a failed send once a second until
// MAX_SEND_RETRIES attempts have failed. Resolves the txid.
async function sendFundsWithRetry(address, amount){
    let sent = false
    let txid = null
    let sendRetries = 0
    while(!sent){
        try {
            txid = await this.sendFundsToAddress(address, amount)
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
    return txid
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

        const txid = await sendFundsWithRetry.call(this, mainAddress, totalAmount/SATOSHI_UNIT)
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

module.exports = { deriveFillKeys, fundMainAddress, findFundingUtxos }
