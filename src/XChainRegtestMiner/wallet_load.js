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
 * XChain Regtest Miner - Wallet Load
 *
 * Classifies a loadwallet answer and loads or creates the named wallet,
 * run against the miner as `this`.
 *
 ********************************************************************/

'use strict';

const { logger } = require('./constants.js')

// Reports whether the named wallet is already loaded on the node, false when the
// daemon cannot say (no listwallets RPC, or the call failed).
async function isWalletAlreadyLoaded(walletName){
    try {
        const loaded = await this.connector.listWallets()
        return Array.isArray(loaded) && loaded.includes(walletName)
    } catch(err){
        return false
    }
}

// loadwallet answers the miner acts on (Bitcoin Core rpc/protocol.h).
const RPC_WALLET_NOT_FOUND = -18
const RPC_WALLET_ALREADY_LOADED = -35
const RPC_METHOD_NOT_FOUND = -32601

// Bounds the wait for a wallet the node is still loading (a mature regtest
// wallet was measured at about a minute, past the 60s RPC timeout).
const WALLET_LOAD_MAX_ATTEMPTS = 30
const WALLET_LOAD_RETRY_INTERVAL_MS = 5000

// Creates the wallet loadwallet reported absent. Resolves true once it exists and
// is loaded; throws when the node cannot create it.
async function createMissingWallet(walletName){
    logger.info("Wallet not found. Creating a new wallet")
    try {
        await this.createWallet(walletName)
        return true
    } catch(err){
        // Another caller created it between our load and create.
        if (await isWalletAlreadyLoaded.call(this, walletName)){
            return true
        }
        throw new Error(`Could not create wallet '${walletName}' on regtest node (chain may not support createwallet RPC, e.g. Dogecoin v1.14.x): ${err.message}`)
    }
}

// Runs one classified load: true when loaded, false to retry. Creates only on -18
// (or -32601, whose create fails fast with the unsupported-daemon message).
async function loadWalletOnce(walletName){
    let loadErr
    try {
        await this.connector.loadWallet(walletName)
        return true
    } catch(err){
        loadErr = err
    }

    const rpcCode = loadErr ? loadErr.rpcCode : undefined
    if (rpcCode === RPC_WALLET_ALREADY_LOADED){
        return true
    }
    if (rpcCode === RPC_WALLET_NOT_FOUND || rpcCode === RPC_METHOD_NOT_FOUND){
        return await createMissingWallet.call(this, walletName)
    }

    // Timeout, warmup, "already loading" or a transport fault: the wallet may be
    // loaded or still loading, so ask the node instead of creating over it.
    return await isWalletAlreadyLoaded.call(this, walletName)
}

module.exports = { loadWalletOnce, WALLET_LOAD_MAX_ATTEMPTS, WALLET_LOAD_RETRY_INTERVAL_MS }
