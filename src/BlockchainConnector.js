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
axios.defaults.timeout = parseInt(process.env.NODE_RPC_TIMEOUT ?? '60000', 10)
axios.defaults.keepAlive = true

class BlockchainConnector {
    constructor(url, port, rpcUser, rpcPassword) {
        this.url = "http://"+url+":"+port
        this.port = port
        this.rpcUser = rpcUser
        this.rpcPassword = rpcPassword
        // walletName + walletUrl stay null until the miner confirms the
        // daemon supports named wallets (Bitcoin Core 0.17+ /wallet/<name>/
        // URI). With it set, wallet-context RPCs (sendtoaddress, getbalance,
        // getnewaddress, getwalletinfo) target THIS wallet specifically —
        // necessary when multiple wallets are loaded on the same node,
        // because bare RPC calls fail with -19 "Wallet file not specified".
        // Left null on legacy daemons (Dogecoin v1.14 etc.) that don't
        // implement /wallet/ URI routing — RPCs fall back to base URL.
        this.walletName = null
        this.walletUrl  = null
    }

    setWalletName(walletName) {
        this.walletName = walletName
        this.walletUrl  = walletName ? (this.url + "/wallet/" + walletName) : null
    }

    // URL for wallet-context RPCs. Falls back to base URL on legacy daemons.
    _walletEndpoint() {
        return this.walletUrl || this.url
    }

    async sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async getNetworkInfo(){
        try {
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
        } catch (error) {
            throw new Error('Error getting network info');
        }
    }
    
    async getBlockchainInfo(){
        try {
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
        } catch (error) {
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
            throw new Error('Error getting block hash');
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
                throw new Error('Error getting block');
            }
        } catch (error) {
            throw new Error('Error getting block');
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

            // Verify the result is an array (empty mempool returns [])
            if (Array.isArray(response.data.result)) {
                return response.data.result;
            } else {
                throw new Error('Error getting raw mempool');
            }
        } catch (error){
            throw new Error('Error getting raw mempool');
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
            throw new Error('Error getting mempool entry');
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
    
    async createWallet(walletName, tries = 50) {
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
            throw new Error('Error creating wallet');
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
                response = await axios.post(this._walletEndpoint(), data, {
                    auth: {
                        username: this.rpcUser,
                        password: this.rpcPassword,
                    }
                })

                break
            } catch (error) {
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
            throw new Error('Error loading wallet');
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
            const response = await axios.post(this._walletEndpoint(), data, {
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
            throw new Error('Error getting new address');
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
            }
            // Surface the node's actual RPC error so failures are debuggable —
            // e.g. LTC's "bad-txns-vin-empty" stall would have been visible at
            // a glance instead of requiring a curl detour against the node.
            const nodeErr = response.data && response.data.error
                ? (response.data.error.message || JSON.stringify(response.data.error))
                : 'no result, no error'
            throw new Error('generatetoaddress returned no result: ' + nodeErr)
        } catch (error) {
            throw new Error('generateToAddress failed: ' + (error && error.message ? error.message : String(error)))
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
            const response = await axios.post(this._walletEndpoint(), data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

            // Verify if there is a result and return it
            if (response.data.result !== null && response.data.result !== undefined && !isNaN(response.data.result)){
                return response.data.result;
            } else {
                throw new Error('Error getting balance');
            }
        } catch (error) {
            throw new Error('Error getting balance');
        }
    }

    async sendToAddress(address, amount){
        try {
            // Use POSITIONAL params for sendtoaddress, not named. Named-parameter
            // JSON-RPC is a Bitcoin Core 0.18+ feature. Dogecoin v1.14.x is
            // based on Bitcoin Core 0.14 and rejects named-param calls (returns
            // an error or empty response — manifests as "There was a problem
            // sending funds" in the API layer). Positional works on every
            // supported chain (BTC v28.x, LTC v0.21.x, DOGE v1.14.x).
            //
            // Drop the `verbose: true` flag too — that's also 0.18+ and changes
            // the response shape from "<txid string>" to {"txid":"<...>","fee":...}.
            // Keeping the bare-string response form makes the code work on all
            // supported daemons.
            const data = {
                jsonrpc: '2.0',
                method: 'sendtoaddress',
                params: [address, amount],
                id: 1,
            }

            const response = await axios.post(this._walletEndpoint(), data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

            const result = response.data && response.data.result
            // sendtoaddress returns a bare txid string under positional params.
            // Still tolerate the verbose-object form in case a future daemon
            // returns it (e.g. if Bitcoin Core ever flips its default).
            if (typeof result === 'string' && result.length > 0) {
                return result
            }
            if (result && typeof result === 'object' && typeof result.txid === 'string') {
                return result.txid
            }
            // Surface the node's actual error message so failures are debuggable
            const nodeErr = response.data && response.data.error
                ? (nodeErr => nodeErr.message || JSON.stringify(nodeErr))(response.data.error)
                : 'no result, no error'
            throw new Error('sendtoaddress returned no txid: ' + nodeErr)
        } catch (error) {
            // Preserve the underlying error message — generic "Error sending funds
            // to address" loses information that's essential to diagnose chain-
            // specific quirks like the one this method's comment describes.
            throw new Error('sendToAddress failed: ' + (error && error.message ? error.message : String(error)))
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