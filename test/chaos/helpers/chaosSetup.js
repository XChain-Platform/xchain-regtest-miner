/*********************************************************************
 *
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC – https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available —
 * contact legal@dankest.llc.
 *
 **********************************************************************
 * Shared utilities for chaos engineering tests.
 *
 * Provides factory functions and helpers that mirror the patterns
 * established in test/e2e/mining-loop.test.js.
 */

const XChainRegtestMiner = require('../../../src/XChainRegtestMiner')

/**
 * Create a miner pointed at a ChaosNode with fast sleep override.
 * @param {ChaosNode} node - must be started (node.port available)
 * @returns {XChainRegtestMiner}
 */
function createMiner(node) {
    const miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')

    // Fast polling: 10ms instead of 1000ms
    const originalSleep = miner.sleep.bind(miner)
    miner.sleep = async (ms) => {
        if (miner._shutdown) {
            throw new Error('__E2E_SHUTDOWN__')
        }
        await originalSleep(10)
    }

    return miner
}

/**
 * Pre-seed a ChaosNode with a loaded, funded wallet.
 * Generates 110 blocks so balance is mature.
 * @param {ChaosNode} node
 */
function seedWallet(node) {
    node._rpc_createwallet(['xchain_regtest_wallet'])
    node._rpc_generatetoaddress([110, 'bcrt1qseed'])
    node.calls = [] // Clear setup calls from tracking
}

/**
 * Start the miner's mining loop in the background.
 * Returns object with startPromise for cleanup.
 * @param {XChainRegtestMiner} miner
 * @returns {{ startPromise: Promise }}
 */
function startMinerLoop(miner) {
    const startPromise = miner.start().catch(e => {
        if (e.message !== '__E2E_SHUTDOWN__') throw e
    })
    return { startPromise }
}

/**
 * Stop the miner loop and wait for it to exit.
 * @param {XChainRegtestMiner} miner
 * @param {Promise} startPromise
 */
async function stopMinerLoop(miner, startPromise) {
    miner._shutdown = true
    if (startPromise) {
        try { await startPromise } catch (e) {
            if (e.message !== '__E2E_SHUTDOWN__') throw e
        }
    }
    // Clean up SIGTERM handler registered by start()
    if (miner._sigTermHandler) {
        process.removeListener('SIGTERM', miner._sigTermHandler)
    }
}

/**
 * Poll a condition function until it returns true or timeout.
 * @param {function} conditionFn
 * @param {number} timeoutMs
 */
async function waitFor(conditionFn, timeoutMs = 5000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
        if (conditionFn()) return true
        await sleep(20)
    }
    throw new Error('waitFor timed out after ' + timeoutMs + 'ms')
}

/**
 * Simple async sleep.
 * @param {number} ms
 */
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = {
    createMiner,
    seedWallet,
    startMinerLoop,
    stopMinerLoop,
    waitFor,
    sleep,
}
