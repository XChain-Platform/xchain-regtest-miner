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
 * E2E Tests: Category E: Error Resilience
 *
 * Validates graceful error handling when the node is unavailable,
 * operations fail, or invalid input is provided.
 */

const assert = require('assert')
const sinon = require('sinon')
const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
const StatefulMockNode = require('./helpers/StatefulMockNode')

let node

function useNode() {
    before(async function () {
        node = new StatefulMockNode()
        await node.start()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    after(async function () {
        sinon.restore()
        await node.stop()
    })
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function startMiner() {
    node.reset()
    node._rpc_createwallet(['xchain_regtest_wallet'])
    node._rpc_generatetoaddress([110, 'bcrt1qseed'])
    node.calls = []

    const miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')

    // Fast sleep
    const originalSleep = miner.sleep.bind(miner)
    miner.sleep = async (ms) => {
        if (miner._shutdown) throw new Error('__E2E_SHUTDOWN__')
        await originalSleep(10)
    }

    // Start the loop
    const startPromise = miner.start().catch(e => {
        if (e.message !== '__E2E_SHUTDOWN__') throw e
    })

    // Wait for loop to start
    const start = Date.now()
    while (!miner.keepMining && Date.now() - start < 3000) await sleep(20)
    return { miner, startPromise }
}

function injectRpcErrors(onError) {
    const realHandler = node._rpc_getrawmempool.bind(node)
    node._rpc_getrawmempool = function () {
        const errorCount = onError()
        if (errorCount <= 3) {
            const err = new Error('Connection lost')
            err.rpcCode = -1
            throw err
        }
        return realHandler()
    }
    return realHandler
}

async function stopMiner(miner, startPromise) {
    miner._shutdown = true
    try { await startPromise } catch (e) {
        if (e.message !== '__E2E_SHUTDOWN__') throw e
    }
    if (miner._sigTermHandler) process.removeListener('SIGTERM', miner._sigTermHandler)
}

describe('E2E: Error Resilience', function () {
    useNode()

    // ─── E1: Mining loop recovers from RPC errors ───────────────────

    it('E1: mining loop continues after transient RPC errors', async function () {
        const { miner, startPromise } = await startMiner()

        // Inject RPC errors by temporarily replacing the handler
        let errorCount = 0
        const realHandler = injectRpcErrors(() => ++errorCount)

        // Wait for the injected errors to actually be encountered. errorCount is
        // the real post-condition: a fixed settle only assumed the loop had polled
        // three times by then, which is a bet on how busy the venue is.
        const errStart = Date.now()
        while (errorCount < 3 && Date.now() - errStart < 3000) await sleep(20)
        assert.strictEqual(errorCount >= 3, true, 'Mining loop never consumed the 3 injected RPC errors')

        // Restore normal handler and inject a transaction
        node._rpc_getrawmempool = realHandler
        miner.maxTimeToMineTxs = 300
        miner.addedTimeToMineTxs = 80
        const heightBefore = node.height
        node.injectMempoolTx('txid_e1_001')

        // Miner should recover and mine the transaction
        const waitStart = Date.now()
        while (node.height <= heightBefore && Date.now() - waitStart < 3000) await sleep(20)

        assert.ok(node.height > heightBefore, 'Miner did not recover from RPC errors')

        await stopMiner(miner, startPromise)
    })
})

describe('E2E: Error Resilience', function () {
    useNode()

    // ─── E2: send_funds with insufficient balance ───────────────────

    it('E2: send_funds handles insufficient balance gracefully', async function () {
        node.reset()
        node._rpc_createwallet(['xchain_regtest_wallet'])
        // Only mine a few blocks (limited balance)
        node._rpc_generatetoaddress([102, 'bcrt1qseed'])

        const miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')

        // Get current balance
        const balance = await miner.connector.getBalance()

        // Try to send more than available
        await assert.rejects(
            () => miner.sendFundsToAddress('bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080', balance + 100),
            /Insufficient funds|Error sending funds/
        )

        // No transaction should be in the mempool
        assert.strictEqual(node.mempool.length, 0)
    })
})

describe('E2E: Error Resilience', function () {
    useNode()

    // ─── E3: set_mining_time with invalid values ────────────────────

    it('E3: set_mining_time throws on non-integer values and leaves state unchanged', async function () {
        const miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')

        // Defaults
        assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        assert.strictEqual(miner.addedTimeToMineTxs, 5000)

        // Non-integer: throws, state unchanged (uuid:24c35056)
        await assert.rejects(() => miner.setMiningTime('fast', 1000))
        assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        assert.strictEqual(miner.addedTimeToMineTxs, 5000)

        // Float: throws, state unchanged
        await assert.rejects(() => miner.setMiningTime(10.5, 2000))
        assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        assert.strictEqual(miner.addedTimeToMineTxs, 5000)

        // Valid integers within bounds: should change
        await miner.setMiningTime(2000, 1000)
        assert.strictEqual(miner.maxTimeToMineTxs, 2000)
        assert.strictEqual(miner.addedTimeToMineTxs, 1000)
    })
})
