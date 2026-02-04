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

var MAX_TIME_TO_MINE_TXS = 30000 //max 30 seconds to mine a block after the first tx is found in the mempool
var ADDED_TIME_TO_MINE_TXS = 5000 //5 seconds extra before mining a block every time a new tx appears in the mempool


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
    }
    
    async sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    
    async setMiningTime(maxTime, txAddedTime){
        if (Number.isInteger(maxTime) && Number.isInteger(txAddedTime)){
            MAX_TIME_TO_MINE_TXS = maxTime
            ADDED_TIME_TO_MINE_TXS = txAddedTime
            console.log("New mining times: (Max Time)=>"+maxTime+"ms (Tx Added Time)=>"+txAddedTime+"ms")
        } else {
            console.log("INVALID mining times: (Max Time)=>"+maxTime+"ms (Tx Added Time)=>"+txAddedTime+"ms")
        }
    }
    
    async setDefaultMiningTime(){
        MAX_TIME_TO_MINE_TXS = 30000
        ADDED_TIME_TO_MINE_TXS = 5000
        console.log("The mining times were set to the default: (Max Time)=>"+MAX_TIME_TO_MINE_TXS+"ms (Tx Added Time)=>"+ADDED_TIME_TO_MINE_TXS+"ms")
    }
    
    async fillMempool(txQuantity){
        return new Promise(async (resolve, reject) => {
            this.keepMining = false //Stop the mining so the txs stay in mempool
            
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
                while(!sent){
                    try {
                        txid = await this.sendFundsToAddress(mainAddress, totalAmount/SATOSHI_UNIT)
                        sent = true
                    } catch(err){
                        console.log(err)
                        console.log("Error sending funds, trying again...")
                        await this.sleep(1000)
                    }
                }
                chunksTxids.push(txid)
                processedChunkCount++
                
                if (processedChunkCount>=20){
                    await this.generateBlocks(1)
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
                while (rawTransaction == null){
                    rawTransaction = await this.connector.getRawTransaction(nextChunkTxid)
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
            
            resolve(true)
        })
    }
    
    async continueMining(){
        this.keepMining = true
    }
    
    async sendFundsToAddress(address, amount){
        return new Promise(async (resolve, reject) => {
            try{
                let txid = await this.connector.sendToAddress(address, amount)
                
                resolve(txid)
            } catch(err){
                reject(err)
            }
        })
    }
    
    async createWallet(walletName){
        return new Promise(async (resolve, reject) => {
            try{
                await this.connector.createWallet(walletName)
                
                resolve(true)
            } catch(err){
                console.log(err)
                reject(false)
            }
        })
    }
    
    async prepareWallet(){
        console.log("Checking if there is a wallet already loaded")
        let walletInfo = null
        let walletLoaded = false
        try {
            walletInfo = await this.connector.getWalletInfo()
        } catch(err){
            //There's no wallet loaded
        }
        
        if (walletInfo == null){ //There is no wallet
            try {
                await this.connector.loadWallet(this.walletNameParam)
                walletLoaded = true
            } catch(err){
                //The wallet couldn't be loaded
            }
            
            if (!walletLoaded){
                console.log("Wallet not found. Creating a new wallet")
                try{
                    await this.createWallet(this.walletNameParam)
                } catch(err){
                    console.log(err)
                    throw Error("Error when trying to create the wallet in the regtest node")
                }
            }
        }
    
        //Get from the database the last address from the wallet
        console.log("Getting a new address to receive blocks reward")
        this.walletAddress = await this.connector.getNewAddress()
        
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
        await this.connector.generateToAddress(numberOfBlocks, this.walletAddress)
        
        if (numberOfBlocks > 1){
            console.log(numberOfBlocks+" new blocks have been generated")
        } else if (numberOfBlocks > 0){
            console.log("A new block has been generated")
        }
    }
    
    async start(){
        //Prepare the wallet
        await this.prepareWallet()
        
        //Loop to check if there are transactions in the mempool, if there are, then
        //Wait some time for new txs, if there is a new tx in that time, then extended the waiting time again
        //If there are no new tx in that time, then mine a block
        console.log("Ready. Checking for new txs")
        
        let lastRawMempoolLength = 0
        let initialStartToMine = 0
        let extendedStartToMine = 0
        this.keepMining = true
        
        while (true){
            if (this.keepMining){
                if ((initialStartToMine > 0) && (extendedStartToMine > 0)){
                    let timeNow = Date.now()
                    let initialTimePassed = timeNow-initialStartToMine
                    let extendedStartTime = timeNow-extendedStartToMine
                    
                    if ((initialTimePassed >= MAX_TIME_TO_MINE_TXS) || (extendedStartTime >= ADDED_TIME_TO_MINE_TXS)){
                        try {
                            await this.generateBlocks(1)
                        } catch (err){
                            console.log("There were problems generating a new block. Trying again later.")
                            await this.sleep(CHECK_BLOCK_DELAY_MS)
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
                } catch (error){
                    console.log("There were problems getting the mempool, trying again later.")
                    await this.sleep(CHECK_BLOCK_DELAY_MS)
                    continue
                }
                
                if (rawMempool.length > 0){
                    if (rawMempool.length > lastRawMempoolLength){
                        //there are new txs in the mempool
                        if (initialStartToMine == 0){
                            initialStartToMine = Date.now()
                            extendedStartToMine = initialStartToMine
                        } else {
                            extendedStartToMine = Date.now()
                        }
                    }
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