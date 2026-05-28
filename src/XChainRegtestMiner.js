/*********************************************************************
 * 
 * Copyright © 2025 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC – https://dankest.llc
 *
 * Licensed under the Dankest Community License (Apache License 2.0 + Additional Terms).
 * You may not use this file except in compliance with that License.
 * 
 * A copy of the License is available at:
 *     https://dankest.llc/license
 *
 * This software is provided “AS IS”, without warranties or conditions of any kind.
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

const CHECK_BLOCK_DELAY_MS = 1000 //1 second to continously ask for new block when all has been parsed
const SATOSHI_UNIT = 100000000.0

const DEFAULT_MAX_TIME_TO_MINE_TXS = 30000 //max 30 seconds to mine a block after the first tx is found in the mempool
const DEFAULT_ADDED_TIME_TO_MINE_TXS = 5000 //5 seconds extra before mining a block every time a new tx appears in the mempool

const MAX_MINING_TIME = 3600000 //1 hour max for mining timers
const MIN_MINING_TIME = 1000 //1 second minimum for mining timers
const MAX_FILL_MEMPOOL_QUANTITY = 50000 //max number of transactions to fill the mempool with
const MAX_SEND_RETRIES = 50 //max retries for sending funds in fillMempool


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
      this.connector = new BlockchainConnector(nodeUrl, nodePort, nodeUser, nodePassword)
      this.walletNameParam = "xchain_regtest_wallet"
      this.keepMining = false
      this.maxTimeToMineTxs = DEFAULT_MAX_TIME_TO_MINE_TXS
      this.addedTimeToMineTxs = DEFAULT_ADDED_TIME_TO_MINE_TXS
      this.fillMempoolRunning = false
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
                return {error: "fillMempool is already running"}
            }

            if (!Number.isInteger(txQuantity) || txQuantity < 1) {
                try { console.log("INVALID txQuantity: "+txQuantity+". Must be a positive integer.") } catch(e) { console.log("INVALID txQuantity (non-printable value). Must be a positive integer.") }
                return
            }

            if (txQuantity > MAX_FILL_MEMPOOL_QUANTITY) {
                console.log("txQuantity "+txQuantity+" exceeds maximum of "+MAX_FILL_MEMPOOL_QUANTITY)
                return {error: "txQuantity exceeds maximum of "+MAX_FILL_MEMPOOL_QUANTITY}
            }

            this.keepMining = false //Stop the mining so the txs stay in mempool
            this.fillMempoolRunning = true
            try {
            console.log("Filling mempool with "+txQuantity+" transactions")
            //let AMOUNT_FOR_EACH_ADDRESS = 0.000001
            //let FEE = 0.00001
            
            let OUTPUTS_QUANTITY_PER_TX = 2500
            let AMOUNT_FOR_EACH_ADDRESS = 1000
            let FEE = 1000
            
            
            //Create a seed
            var network = bitcoin.networks.regtest
            var mnemonic = bip39.generateMnemonic()
            var seed = bip39.mnemonicToSeedSync(mnemonic)
            var root = bip32.fromSeed(seed, )
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
                        console.log("Error sending funds: "+detail+" — retrying (attempt "+sendRetries+"/"+MAX_SEND_RETRIES+")")
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
                    sequence: transaction.outs[utxoIndex].sequence,
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
            let outputIndex = 0
            for (let nextAddressIndex in addresses){
                let nextAddress = addresses[nextAddressIndex]
                let psbt = new bitcoin.Psbt({ network: bitcoin.networks.regtest})
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
                
                outputIndex++
            }

            } finally {
                this.fillMempoolRunning = false
                this.keepMining = true
            }
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

        // Probe with getNewAddress: succeeds whenever ANY wallet is usable —
        // modern Bitcoin Core 0.17+ with an already-loaded named wallet, or
        // legacy single-wallet chains (Dogecoin v1.14.x, older Litecoin)
        // that auto-load a default wallet and don't implement createwallet /
        // loadwallet / listwallets at all.
        //
        // Retry the probe for a few seconds because legacy daemons accept
        // RPC requests before their wallet has finished loading. Dogecoin
        // v1.14 in particular reliably loses this race on the first start
        // after a fresh `xchain-node reset` — the miner crashes because
        // `createWallet` (the fallback) isn't supported on DOGE. A handful
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
                    throw new Error(`Could not create wallet '${this.walletNameParam}' on regtest node (chain may not support createwallet RPC — e.g. Dogecoin v1.14.x): ${err.message}`)
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
            // Probe succeeded — wallet is already usable, use that address
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
    }
    
    async generateBlocks(numberOfBlocks){
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

        // Graceful shutdown on SIGTERM — allow current loop iteration to complete
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
                        } catch (err){
                            consecutiveErrors++
                            let backoff = Math.min(CHECK_BLOCK_DELAY_MS * Math.pow(2, consecutiveErrors), MAX_BACKOFF_MS)
                            console.log("There were problems generating a new block: "+(err && err.message ? err.message : err)+" — retrying in "+backoff+"ms.")
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
                } catch (error){
                    consecutiveErrors++
                    let backoff = Math.min(CHECK_BLOCK_DELAY_MS * Math.pow(2, consecutiveErrors), MAX_BACKOFF_MS)
                    console.log("There were problems getting the mempool: "+(error && error.message ? error.message : error)+" — retrying in "+backoff+"ms.")
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
                } else {
                    initialStartToMine = 0
                    extendedStartToMine = 0
                    lastRawMempoolLength = 0
                }
            }
            await this.sleep(CHECK_BLOCK_DELAY_MS)
        }
    }
}

module.exports = XChainRegtestMiner