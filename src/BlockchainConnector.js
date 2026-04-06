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
 * XChain Regtest Miner - Blockchain Connector Class
 * 
 * This file handles pulling blockchain data from a coin daemon
 * 
 ********************************************************************/

// Load required libraries
const axios = require('axios');
axios.defaults.timeout = 60000 //a minute
axios.defaults.keepAlive = true

class BlockchainConnector {
    constructor(url, port, rpcUser, rpcPassword) {
        this.url = "http://"+url+":"+port
        this.port = port
        this.rpcUser = rpcUser
        this.rpcPassword = rpcPassword
    }

    async sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async getNetworkInfo(){
        const data = {
            jsonrpc: '2.0',
            method: 'getnetworkinfo',
            id: 1
        }
        
        // Make the request to the node
        const response = await axios.post(this.url, data, {
            auth: {
                username: this.rpcUser,
                password: this.rpcPassword,
            }
        })

        // Verify if there is a result and return it
        if (response.data.result) {
            return response.data.result;
        } else {
            throw new Error('Error getting network info');
        }
    }
    
    async getBlockchainInfo(){
        const data = {
            jsonrpc: '2.0',
            method: 'getblockchaininfo',
            id: 1
        }
        
        // Make the request to the node
        const response = await axios.post(this.url, data, {
            auth: {
                username: this.rpcUser,
                password: this.rpcPassword,
            }
        })

        // Verify if there is a result and return it
        if (response.data.result) {
            return response.data.result;
        } else {
            throw new Error('Error getting blockchain info');
        }
    }

    async getBlockHash(blockindex) {
        try {
            const data = {
                jsonrpc: '2.0',
                method: 'getblockhash',
                params: [blockindex],
                id: 1,
            }

            // Make the request to the node
            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

            // Verify if there is a result and return it
            if (response.data.result) {
                return response.data.result;
            } else {
                throw new Error('Error getting block hash');
            }
        } catch (error) {
            console.error('Error:', error.message);
            throw error;
        }
    }

    async getBlock(blockhash, hexFormat=true) {
        try {
            const data = {
                jsonrpc: '2.0',
                method: 'getblock',
                params: [blockhash, (hexFormat?0:1)],
                id: 1,
            }

            // Make the request to the node
            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

            // Verify if there is a result and return it
            if (response.data.result) {
                return response.data.result;
            } else {
                throw new Error('Error getting block hex');
            }
        } catch (error) {
            console.error('Error:', error.message);
            throw error;
        }
    }
    
    async getRawMempool(){
        try {
            const data = {
                jsonrpc: '2.0',
                method: 'getrawmempool',
                id: 1
            }
            
            // Make the request to the node
            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

            // Verify if there is a result and return it
            if (response.data.result) {
                return response.data.result;
            } else {
                throw new Error('Error getting raw mempool info');
            }
        } catch (error){
            console.error('Error:', error.message);
            throw error;
        }
    }
    
    async getMempoolEntry(txid){
        try {
            const data = {
                jsonrpc: '2.0',
                method: 'getmempoolentry',
                params: [txid],
                id: 1
            }
            
            // Make the request to the node
            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

            // Verify if there is a result and return it
            if (response.data.result) {
                return response.data.result;
            } else {
                throw new Error('Error getting mempool entry');
            }
        } catch (error){
            console.error('Error:', error.message);
            throw error;
        }
    }
    
    async getRawTransaction(txid){
        try {
            const data = {
                jsonrpc: '2.0',
                method: 'getrawtransaction',
                params: [txid],
                id: 1
            }
            
            // Make the request to the node
            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

            // Verify if there is a result and return it
            if (response.data.result) {
                return response.data.result;
            } else {
                throw new Error('Error getting raw transaction');
            }
        } catch (error){
            return null
            //console.error('Error:', error.message);
            //throw error;
        }
    }
    
    async createWallet(walletName, tries = 10) {
        try {
            const data = {
                jsonrpc: '2.0',
                method: 'createwallet',
                params: [walletName],
                id: 1,
            }

            while (tries > 0){
                
                try{
                    // Make the request to the node
                    const response = await axios.post(this.url, data, {
                        auth: {
                            username: this.rpcUser,
                            password: this.rpcPassword,
                        }
                    })

                    // Verify if there is a result and return it
                    if (response.data.result) {
                        return response.data.result;
                    } else {
                        tries--
                    }
                } catch (err){
                    tries--
                }
                
                await this.sleep(1000)
            }
            
            throw new Error('Error creating wallet');
        } catch (error) {
            console.error('Error:', error.message);
            throw error;
        }
    }
    
    async getWalletInfo(maxRetries = 50){
        const data = {
            jsonrpc: '2.0',
            method: 'getwalletinfo',
            params: [],
            id: 1,
        }

        let response = null
        let attempts = 0
        while (attempts < maxRetries){
            attempts++
            try {
                // Make the request to the node
                response = await axios.post(this.url, data, {
                    auth: {
                        username: this.rpcUser,
                        password: this.rpcPassword,
                    }
                })

                break
            } catch (error) {
                console.error("There was an error while getting the wallet info from the node. Trying again...");
                await this.sleep(1000)
            }
        }

        if (response === null) {
            throw new Error('Error getting wallet info: max retries exceeded');
        }
        
        // Verify if there is a result and return it
        if (response.data.result) {
            return response.data.result;
        } else {
            throw new Error('Error getting wallet info');
        }
    }
    
    async loadWallet(walletName){
        try {
            const data = {
                jsonrpc: '2.0',
                method: 'loadwallet',
                params: [walletName],
                id: 1,
            }

            // Make the request to the node
            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

            // Verify if there is a result and return it
            if (response.data.result) {
                return response.data.result;
            } else {
                throw new Error('Error loading wallet');
            }
        } catch (error) {
            console.error('Error:', error.message);
            throw error;
        }
    }
    
    async getNewAddress(){
        try {
            const data = {
                jsonrpc: '2.0',
                method: 'getnewaddress',
                params: [],
                id: 1,
            }

            // Make the request to the node
            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

            // Verify if there is a result and return it
            if (response.data.result) {
                return response.data.result;
            } else {
                throw new Error('Error getting new address');
            }
        } catch (error) {
            console.error('Error:', error.message);
            throw error;
        }   
    }
    
    async generateToAddress(count, address){
        try {
            const data = {
                jsonrpc: '2.0',
                method: 'generatetoaddress',
                params: [count, address],
                id: 1,
            }

            // Make the request to the node
            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                },
                timeout:60000 //Normally, with count=100 this will take less than 10 seconds, but let's give it a minute
            })

            // Verify if there is a result and return it
            if (response.data.result) {
                return response.data.result;
            } else {
                throw new Error('Error generating to address');
            }
        } catch (error) {
            console.error('Error:', error.message);
            throw error;
        }   
    }
    
    async getBalance(){
        try {
            const data = {
                jsonrpc: '2.0',
                method: 'getbalance',
                params: [],
                id: 1,
            }

            // Make the request to the node
            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

            // Verify if there is a result and return it
            if (response.data.result !== null && response.data.result !== undefined && !isNaN(response.data.result)){
                return response.data.result;
            } else {
                throw new Error('Error asking wallet balance');
            }
        } catch (error) {
            console.error('Error:', error.message);
            throw error;
        }   
    }
    
    async sendToAddress(address, amount){
        try {
            const data = {
                jsonrpc: '2.0',
                method: 'sendtoaddress',
                //params: [address, amount],
                params: {
                    "address":address, 
                    "amount":amount,
                    "verbose":true
                },
                id: 1,
            }

            // Make the request to the node
            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

            // Verify if there is a result and return it
            if (response.data.result){
                return response.data.result["txid"];
            } else {
                throw new Error('Error sending funds to address');
            }
        } catch (error) {
            throw new Error('Error sending funds to address');
        }
    }
    
    async sendRawTransaction(txHex){
        try {
            const data = {
                jsonrpc: '2.0',
                method: 'sendrawtransaction',
                params: [txHex],
                id: 1,
            }

            // Make the request to the node
            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

            // Verify if there is a result and return it
            if (response.data.result){
                return response.data.result
            } else {
                throw new Error('Error sending raw transaction')
            }
        } catch (error) {
            throw new Error('Error sending raw transaction');
        }
    }
}

module.exports = BlockchainConnector