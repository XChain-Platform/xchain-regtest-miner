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
 * XChain Regtest Miner - Blockchain Connector Class
 *
 * This file handles pulling blockchain data from a coin daemon.
 *
 ********************************************************************/

const axios = require('axios');
const http = require('http');
const https = require('https');
const config = require('../config');
const chainQueries = require('./blockchain_connector/chain_queries.js');
const walletRpc = require('./blockchain_connector/wallet_rpc.js');
const blockControl = require('./blockchain_connector/block_control.js');
axios.defaults.timeout = config.NODE_RPC_TIMEOUT_MS
// axios has no top-level `keepAlive` config key; connection reuse must be
// configured on the underlying http(s) Agent. The miner's auto-mine loop polls
// the node RPC (getRawMempool) every CHECK_BLOCK_DELAY_MS (100ms), so reusing
// TCP connections instead of opening a fresh socket per request is a real win.
axios.defaults.httpAgent = new http.Agent({ keepAlive: true })
axios.defaults.httpsAgent = new https.Agent({ keepAlive: true })

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
}

// Define each source's own enumerable keys on target with class-method flags
// (writable, configurable, not enumerable). A class split into part modules
// has to put the moved methods back on its prototype; Object.assign would do
// that as ENUMERABLE own properties, unlike a class-body method, so a split
// class would change what for...in over an instance, Object.keys of the
// prototype and a spread of it return. Key choice and order match
// Object.assign (a later source wins a shared key), so only the enumerable
// flag differs.
function installMethods(target, ...sources) {
    for (const source of sources) {
        for (const key of Reflect.ownKeys(source)) {
            if (!Object.prototype.propertyIsEnumerable.call(source, key)) continue;
            Object.defineProperty(target, key, {
                value: source[key],
                writable: true,
                enumerable: false,
                configurable: true,
            });
        }
    }
    return target;
}

installMethods(
    BlockchainConnector.prototype,
    chainQueries,
    walletRpc,
    blockControl,
)

module.exports = BlockchainConnector
