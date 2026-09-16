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
 **********************************************************************/

const axios = require('axios');

module.exports = {
    setWalletName(walletName) {
        this.walletName = walletName
        this.walletUrl  = walletName ? (this.url + "/wallet/" + walletName) : null
    },

    // URL for wallet-context RPCs. Falls back to base URL on legacy daemons.
    walletEndpoint() {
        return this.walletUrl || this.url
    },

    async sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    },

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
    },

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
    },

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
    },

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
    },

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

            // Verify the result is an array (empty mempool returns [])
            if (Array.isArray(response.data.result)) {
                return response.data.result;
            } else {
                throw new Error('Error getting raw mempool');
            }
        } catch (error){
            throw new Error('Error getting raw mempool');
        }
    },

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
    },

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
    },
}
