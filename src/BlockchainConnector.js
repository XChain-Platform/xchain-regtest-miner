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
 ********************************************************************/

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
        // getnewaddress, getwalletinfo) target THIS wallet specifically,
        // which is necessary when multiple wallets are loaded on the same node
        // (bare RPC calls fail with -19 "Wallet file not specified").
        // Left null on legacy daemons (Dogecoin v1.14 etc.) that don't
        // implement /wallet/ URI routing; RPCs fall back to base URL.
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

            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

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

            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

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

            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

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
                params: [blockhash, !hexFormat],  // getblock verbose is a boolean (false=hex, true=json); Dogecoin 1.14 rejects integer verbosity. Bitcoin Core coerces the boolean, so this is safe cross-node
                id: 1,
            }

            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

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

            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

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

            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

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

            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

            if (response.data.result) {
                return response.data.result;
            } else {
                throw new Error('Error getting raw transaction');
            }
        } catch (error){
            return null
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
                    const response = await axios.post(this.url, data, {
                        auth: {
                            username: this.rpcUser,
                            password: this.rpcPassword,
                        }
                    })

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

            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

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

            const response = await axios.post(this._walletEndpoint(), data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

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

            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                },
                // Inherit axios.defaults.timeout (NODE_RPC_TIMEOUT, default 60000)
                // rather than hardcoding, so the mining RPC honors the same env knob
                // as every other call on this connector.
            })

            if (response.data.result) {
                return response.data.result;
            }
            // Surface the node's actual RPC error so failures are debuggable.
            // For example, LTC's "bad-txns-vin-empty" stall would have been
            // visible at a glance instead of requiring a curl detour against the node.
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

            const response = await axios.post(this._walletEndpoint(), data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

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
            // an error or empty response, which manifests as "There was a problem
            // sending funds" in the API layer). Positional works on every
            // supported chain (BTC v28.x, LTC v0.21.x, DOGE v1.14.x).
            //
            // Drop the `verbose: true` flag too; that is also 0.18+ and changes
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
            // Tolerate the verbose-object form {txid:...} in case a future daemon returns it.
            if (typeof result === 'string' && result.length > 0) {
                return result
            }
            if (result && typeof result === 'object' && typeof result.txid === 'string') {
                return result.txid
            }
            const nodeErr = response.data && response.data.error
                ? (nodeErr => nodeErr.message || JSON.stringify(nodeErr))(response.data.error)
                : 'no result, no error'
            throw new Error('sendtoaddress returned no txid: ' + nodeErr)
        } catch (error) {
            // Preserve the underlying error message. A generic "Error sending funds
            // to address" loses information that's essential to diagnose chain-
            // specific quirks like the one this method's comment describes.
            throw new Error('sendToAddress failed: ' + (error && error.message ? error.message : String(error)))
        }
    }
    
    // Marks a block (identified by its hash) as invalid, causing the node to
    // roll back to a fork point. Combined with reconsiderBlock this enables
    // deterministic reorg testing: invalidate the tip, mine a competing branch,
    // then reconsider to let the node pick the longest chain.
    async invalidateBlock(blockHash) {
        try {
            const data = {
                jsonrpc: '2.0',
                method: 'invalidateblock',
                params: [blockHash],
                id: 1,
            }

            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

            // invalidateblock returns null on success (no error field = success).
            if (response.data && response.data.error) {
                throw new Error('invalidateblock RPC error: ' + response.data.error.message)
            }
            return true
        } catch (error) {
            throw new Error('invalidateBlock failed: ' + (error && error.message ? error.message : String(error)))
        }
    }

    // Removes a block from the invalid set, allowing the node to re-evaluate
    // it as part of the best chain. Use after invalidateBlock once the competing
    // branch has been mined to trigger reorg resolution.
    async reconsiderBlock(blockHash) {
        try {
            const data = {
                jsonrpc: '2.0',
                method: 'reconsiderblock',
                params: [blockHash],
                id: 1,
            }

            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

            // reconsiderblock returns null on success (no error field = success).
            if (response.data && response.data.error) {
                throw new Error('reconsiderblock RPC error: ' + response.data.error.message)
            }
            return true
        } catch (error) {
            throw new Error('reconsiderBlock failed: ' + (error && error.message ? error.message : String(error)))
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