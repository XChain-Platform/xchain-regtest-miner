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
 * T2 Regression Tests: Full Regression (E2E)
 *
 * End-to-end regression tests against a StatefulMockNode that simulates
 * a real Bitcoin Core regtest node. Validates the complete pipeline:
 * wallet lifecycle, mempool monitoring, block generation, and API
 * interactions with real (but fast) async behavior.
 *
 * Target runtime: < 10 minutes
 * Trigger: nightly; before releases; after dependency upgrades
 */

const assert = require('assert')
const XChainRegtestMiner = require('../../../src/XChainRegtestMiner')
const waitUntil = require('../../helpers/waitUntil')
const pipeline = require('./helpers/pipeline')

let node

pipeline.registerFile()

function createMiner() {
    return new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')
}

// Deliberate delay only. Every wait-for-a-condition in this file goes through
// waitUntil, which rejects on timeout; this timer is reserved for the sites
// where the elapsed wall time IS the thing under test.
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function registerTimerBehaviorTest() {
    // ═══════════════════════════════════════════════════════════════════
    // REG-T2-006: Mining Timer Override
    // ═══════════════════════════════════════════════════════════════════
    describe('REG-T2-006: Mining timer override via setMiningTime', function () {
        let miner, startPromise
        beforeEach(function () {
            node.reset()
            node._rpc_createwallet(['xchain_regtest_wallet'])
            node._rpc_generatetoaddress([110, 'bcrt1qseed'])
            node.calls = []
            miner = createMiner()
            const originalSleep = miner.sleep.bind(miner)
            miner.sleep = async (ms) => {
                if (miner._shutdown) throw new Error('__E2E_SHUTDOWN__')
                await originalSleep(10)
            }
        })
        afterEach(async function () {
            miner._shutdown = true
            if (startPromise) {
                try { await startPromise } catch (e) {
                    if (e.message !== '__E2E_SHUTDOWN__') throw e
                }
            }
            if (miner && miner._sigTermHandler) {
                process.removeListener('SIGTERM', miner._sigTermHandler)
            }
        })
        it('setMiningTime changes timer behavior', async function () {
            // Start with very long timers
            miner.maxTimeToMineTxs = 60000
            miner.addedTimeToMineTxs = 60000
            startPromise = miner.start().catch(e => {
                if (e.message !== '__E2E_SHUTDOWN__') throw e
            })
            await waitUntil(() => miner.keepMining, 3000, 'the mining loop to start')
            const heightBefore = node.height
            node.injectMempoolTx('txid_timer_001')
            // Deliberate delay, NOT a synchronization wait: the elapsed 200ms contrasted
            // against the 60s timers above IS the assertion below, which names the window
            // in its own message. Polling for "not mined" has no condition that becomes
            // true, and swapping the window for a poll count would leave that message
            // describing a bound the test no longer takes.
            await sleep(200)
            // Long timers: should not have mined yet
            assert.strictEqual(node.height, heightBefore,
                'Should not mine with 60s timers in 200ms')
            // Override to fast timers
            await miner.setMiningTime(1000, 1000)
            // Now it should mine within ~1s
            const mined = await waitUntil(
                () => node.height > heightBefore, 3000, 'the chain height to advance')
            assert.ok(mined, 'Should mine after timer override')
        })
    })
}

function registerDefaultTimerTest() {
    describe('REG-T2-006: Mining timer override via setMiningTime', function () {
        let miner, startPromise
        beforeEach(function () {
            node.reset()
            node._rpc_createwallet(['xchain_regtest_wallet'])
            node._rpc_generatetoaddress([110, 'bcrt1qseed'])
            node.calls = []
            miner = createMiner()
            const originalSleep = miner.sleep.bind(miner)
            miner.sleep = async (ms) => {
                if (miner._shutdown) throw new Error('__E2E_SHUTDOWN__')
                await originalSleep(10)
            }
        })
        afterEach(async function () {
            miner._shutdown = true
            if (startPromise) {
                try { await startPromise } catch (e) {
                    if (e.message !== '__E2E_SHUTDOWN__') throw e
                }
            }
            if (miner && miner._sigTermHandler) {
                process.removeListener('SIGTERM', miner._sigTermHandler)
            }
        })
        it('setDefaultMiningTime restores defaults', async function () {
            await miner.setMiningTime(5000, 2000)
            assert.strictEqual(miner.maxTimeToMineTxs, 5000)
            assert.strictEqual(miner.addedTimeToMineTxs, 2000)
            await miner.setDefaultMiningTime()
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })
    })
}

describe('T2 Regression: Full E2E Pipeline', function () {
    before(async function () {
        node = await pipeline.start()
    })
    after(async function () {
        await pipeline.finish()
    })
    registerTimerBehaviorTest()
    registerDefaultTimerTest()
})
