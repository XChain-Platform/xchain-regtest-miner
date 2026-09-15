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

function registerMempoolTransactionTest() {
    // ═══════════════════════════════════════════════════════════════════
    // REG-T2-004: Mining Loop, Mempool Detection and Block Generation
    // ═══════════════════════════════════════════════════════════════════
    describe('REG-T2-004: Mining loop, mempool detection', function () {
        let miner, startPromise
        beforeEach(function () {
            node.reset()
            node._rpc_createwallet(['xchain_regtest_wallet'])
            node._rpc_generatetoaddress([110, 'bcrt1qseed'])
            node.calls = []
            miner = createMiner()
            // Fast polling
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
        it('detects mempool transaction and mines a block', async function () {
            miner.maxTimeToMineTxs = 200
            miner.addedTimeToMineTxs = 80
            startPromise = miner.start().catch(e => {
                if (e.message !== '__E2E_SHUTDOWN__') throw e
            })
            // Wait for mining loop to start
            const started = await waitUntil(
                () => miner.keepMining, 3000, 'the mining loop to start')
            assert.ok(started, 'Mining loop did not start')
            const heightBefore = node.height
            node.injectMempoolTx('txid_reg_001')
            // Wait for the miner to mine a block
            const mined = await waitUntil(
                () => node.height > heightBefore, 3000, 'the chain height to advance')
            assert.ok(mined, 'Miner did not mine the transaction')
            // Transaction should be cleared from mempool
            assert.strictEqual(node.mempool.length, 0)
        })
    })
}

function registerEmptyMempoolTest() {
    describe('REG-T2-004: Mining loop, mempool detection', function () {
        let miner, startPromise
        beforeEach(function () {
            node.reset()
            node._rpc_createwallet(['xchain_regtest_wallet'])
            node._rpc_generatetoaddress([110, 'bcrt1qseed'])
            node.calls = []
            miner = createMiner()
            // Fast polling
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
        it('does not mine when mempool is empty', async function () {
            miner.maxTimeToMineTxs = 100
            miner.addedTimeToMineTxs = 50
            startPromise = miner.start().catch(e => {
                if (e.message !== '__E2E_SHUTDOWN__') throw e
            })
            await waitUntil(() => miner.keepMining, 3000, 'the mining loop to start')
            const heightBefore = node.height
            // Give the negative assertion a window it can defend: 20 observed
            // mempool polls, each of which saw an empty mempool and declined to
            // mine. A fixed 300ms settle proved only that 300ms passed, and on a
            // loaded venue could cover fewer cycles than the mining timers
            // (100ms / 50ms) need in order to be capable of firing at all.
            const pollsBefore = node.callsFor('getrawmempool').length
            const settled = await waitUntil(
                () => node.callsFor('getrawmempool').length >= pollsBefore + 20, 5000,
                '20 further mempool polls')
            assert.ok(settled, 'Mining loop did not poll the mempool 20 times')
            assert.strictEqual(node.height, heightBefore,
                'Should not mine with empty mempool')
        })
    })
}

function registerTimerResetTest() {
    describe('REG-T2-004: Mining loop, mempool detection', function () {
        let miner, startPromise
        beforeEach(function () {
            node.reset()
            node._rpc_createwallet(['xchain_regtest_wallet'])
            node._rpc_generatetoaddress([110, 'bcrt1qseed'])
            node.calls = []
            miner = createMiner()
            // Fast polling
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
        it('mines multiple blocks across timer resets', async function () {
            miner.maxTimeToMineTxs = 150
            miner.addedTimeToMineTxs = 80
            startPromise = miner.start().catch(e => {
                if (e.message !== '__E2E_SHUTDOWN__') throw e
            })
            await waitUntil(() => miner.keepMining, 3000, 'the mining loop to start')
            const heightBefore = node.height
            // Inject tx, wait for it to be mined, then inject another
            node.injectMempoolTx('txid_multi_001')
            const firstMined = await waitUntil(
                () => node.height > heightBefore, 3000, 'the first transaction to be mined')
            assert.ok(firstMined, 'First transaction not mined')
            const heightAfterFirst = node.height
            node.injectMempoolTx('txid_multi_002')
            const secondMined = await waitUntil(
                () => node.height > heightAfterFirst, 3000,
                'the second transaction to be mined')
            assert.ok(secondMined, 'Second transaction not mined')
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
    registerMempoolTransactionTest()
    registerEmptyMempoolTest()
    registerTimerResetTest()
})
