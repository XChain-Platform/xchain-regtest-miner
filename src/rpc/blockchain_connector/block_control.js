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
const { logger } = require('./constants');

module.exports = {
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
            // Surface the node's own RPC error to the LOG so failures are debuggable
            // (e.g. LTC's "bad-txns-vin-empty" stall), but THROW a static message: the
            // node's message is safe to log, whereas a transport axios error.message
            // carries the internal RPC host:port (connect ECONNREFUSED host:18332). The
            // sanitization security suite and every other connector method require a
            // static thrown message with no host/port.
            const nodeErr = response.data && response.data.error
                ? (response.data.error.message || JSON.stringify(response.data.error))
                : 'no result, no error'
            logger.error('generatetoaddress returned no result: ' + nodeErr)
            throw new Error('Error generating to address')
        } catch (error) {
            throw new Error('Error generating to address')
        }
    },

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

            if (response.data && response.data.error) {
                logger.error('invalidateblock RPC error: ' + response.data.error.message)
                throw new Error('Error invalidating block')
            }
            // Require the explicit JSON-RPC success result, not merely the absence of
            // an error member. invalidateblock answers result:null on success, so an empty
            // body, a {}, or any other error-less 2xx can certify a reorg the node
            // never performed: the miner then reported "ok" for a rollback that did
            // not happen, which is exactly the determinism the harness exists to give.
            if (!response.data || response.data.result !== null) {
                throw new Error('Error invalidating block')
            }
            return true
        } catch (error) {
            // Static message: a transport axios error.message leaks the RPC host:port.
            throw new Error('Error invalidating block')
        }
    },

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

            if (response.data && response.data.error) {
                logger.error('reconsiderblock RPC error: ' + response.data.error.message)
                throw new Error('Error reconsidering block')
            }
            // Require the explicit JSON-RPC success result, not merely the absence of
            // an error member. reconsiderblock answers result:null on success, so an empty
            // body, a {}, or any other error-less 2xx can certify a reorg the node
            // never performed: the miner then reported "ok" for a rollback that did
            // not happen, which is exactly the determinism the harness exists to give.
            if (!response.data || response.data.result !== null) {
                throw new Error('Error reconsidering block')
            }
            return true
        } catch (error) {
            // Static message: a transport axios error.message leaks the RPC host:port.
            throw new Error('Error reconsidering block')
        }
    },

    // Freeze the node's clock at `timestamp` (unix seconds) via setmocktime, so
    // the next generatetoaddress stamps its block at that time (bitcoind sets the
    // block time to max(median-time-past+1, adjusted-time), and adjusted-time is
    // the mock clock). timestamp 0 releases the mock clock back to system time.
    // Callers pass a value strictly above the current tip's median-time-past so
    // the stamped time equals the requested time exactly. Used by the multi-chain
    // parity harness to pin block timestamps for deterministic, cross-chain-
    // identical time-based expiries (ORDER_EXPIRE); never used on mainnet.
    async setMockTime(timestamp){
        try {
            const data = {
                jsonrpc: '2.0',
                method: 'setmocktime',
                params: [Number(timestamp)],
                id: 1,
            }

            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

            if (response.data && response.data.error) {
                logger.error('setmocktime RPC error: ' + response.data.error.message)
                throw new Error('Error setting mock time')
            }
            // Require the explicit JSON-RPC success result, not merely the absence of
            // an error member. setmocktime answers result:null on success, so an empty
            // body, a {}, or any other error-less 2xx can certify a reorg the node
            // never performed: the miner then reported "ok" for a rollback that did
            // not happen, which is exactly the determinism the harness exists to give.
            if (!response.data || response.data.result !== null) {
                throw new Error('Error setting mock time')
            }
            return true
        } catch (error) {
            // Static message: a transport axios error.message leaks the RPC host:port.
            throw new Error('Error setting mock time')
        }
    },

    async sendRawTransaction(txHex){
        try {
            const data = {
                jsonrpc: '2.0',
                method: 'sendrawtransaction',
                params: [txHex],
                id: 1,
            }

            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

            if (response.data.result){
                return response.data.result
            } else {
                throw new Error('Error sending raw transaction')
            }
        } catch (error) {
            throw new Error('Error sending raw transaction');
        }
    },
}
