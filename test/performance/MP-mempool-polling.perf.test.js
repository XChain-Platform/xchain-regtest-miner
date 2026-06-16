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
 * Performance Tests — MP: Mempool Polling and Transaction Batching
 *
 * Measures how the mining loop responds to varying mempool sizes
 * and transaction arrival rates under real wall-clock timing.
 */

const assert = require('assert')
const sinon = require('sinon')
const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
const LatencyMockNode = require('./helpers/LatencyMockNode')
const PerformanceCollector = require('./helpers/PerformanceCollector')
const { assertP95Under, assertMeanUnder, assertMaxUnder } = require('./helpers/perfAssert')

describe('Performance: MP — Mempool Polling', function () {
    let node, miner, collector
    let startPromise

    before(async function () {
        node = new LatencyMockNode()
        await node.start()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    after(async function () {
        sinon.restore()
        await node.stop()
    })

    beforeEach(async function () {
        node.reset()
        node._rpc_createwallet(['xchain_regtest_wallet'])
        node._rpc_generatetoaddress([110, 'bcrt1qseed'])
        node.calls = []

        collector = new PerformanceCollector('MP')
        miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')

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
        startPromise = null

        const names = collector.getMetricNames()
        if (names.length > 0) {
            process.stdout.write(collector.summary())
        }
    })

    function startMinerLoop() {
        startPromise = miner.start().catch(e => {
            if (e.message !== '__E2E_SHUTDOWN__') throw e
        })
    }

    async function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    async function waitFor(conditionFn, timeoutMs = 5000) {
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
            if (conditionFn()) return true
            await sleep(20)
        }
        throw new Error('waitFor timed out after ' + timeoutMs + 'ms')
    }

    // ─── MP-001: Steady trickle — 1 tx every 100ms for 1 second ──��───

    it('MP-001: mempool poll latency with steady trickle (10 txs over 1s)', async function () {
        miner.maxTimeToMineTxs = 300
        miner.addedTimeToMineTxs = 200

        // Wrap getRawMempool to record latency
        collector.wrapMethod(miner.connector, 'getRawMempool')

        startMinerLoop()
        await waitFor(() => miner.keepMining === true)

        // Inject 10 transactions at ~100ms intervals
        for (let i = 0; i < 10; i++) {
            await sleep(100)
            node.injectMempoolTx('txid_mp001_' + i)
        }

        // Wait for mining to complete
        await waitFor(() => node.callsFor('generatetoaddress').length > 0, 3000)

        // getRawMempool should stay fast regardless of injection rate
        assertP95Under(collector, 'getRawMempool', 50)
    })

    // ─── MP-002: Burst arrival — 100 txs injected at once ─────────────

    it('MP-002: mining response time to burst of 100 txs', async function () {
        miner.maxTimeToMineTxs = 300
        miner.addedTimeToMineTxs = 100

        startMinerLoop()
        await waitFor(() => miner.keepMining === true)

        const heightBefore = node.height

        await collector.measure('burstResponse:100tx', async () => {
            // Inject 100 txs simultaneously
            for (let i = 0; i < 100; i++) {
                node.injectMempoolTx('txid_mp002_' + i)
            }
            await waitFor(() => node.height > heightBefore, 3000)
        })

        assertMaxUnder(collector, 'burstResponse:100tx', 3000)
        // All 100 txs should have been included in the mined block
        const lastBlock = node.blocks[node.blocks.length - 1]
        assert.ok(lastBlock.txids.length > 50, 'Expected most txs included in block')
    })

    // ─── MP-003: Continuous flood — 5 txs per poll for 2 seconds ──────

    it('MP-003: block generation under continuous flood (5 tx/poll, 2s)', async function () {
        miner.maxTimeToMineTxs = 500
        miner.addedTimeToMineTxs = 200

        startMinerLoop()
        await waitFor(() => miner.keepMining === true)

        const heightBefore = node.height
        const startTime = Date.now()

        // Inject 5 txs every 50ms for 2 seconds (200 txs total)
        let txCount = 0
        const interval = setInterval(() => {
            for (let i = 0; i < 5; i++) {
                node.injectMempoolTx('txid_mp003_' + txCount++)
            }
        }, 50)

        await sleep(2000)
        clearInterval(interval)

        // Wait for at least one block to be mined
        await waitFor(() => node.height > heightBefore, 3000)
        const elapsed = Date.now() - startTime

        const blocksMined = node.height - heightBefore
        collector.record('flood:blocksMined', blocksMined)
        collector.record('flood:txsInjected', txCount)
        collector.record('flood:elapsedMs', elapsed)

        // Should have mined at least 1 block in this period
        assert.ok(blocksMined >= 1, `Expected >= 1 block mined, got ${blocksMined}`)
    })

    // ─── MP-004: Timer boundary — tx arrives just before addedTime ────

    it('MP-004: timer extension when txs arrive near addedTimeToMineTxs boundary', async function () {
        miner.maxTimeToMineTxs = 2000
        miner.addedTimeToMineTxs = 200

        startMinerLoop()
        await waitFor(() => miner.keepMining === true)

        const heightBefore = node.height

        // Inject first tx
        node.injectMempoolTx('txid_mp004_0')

        // Inject more txs at ~150ms intervals (just under 200ms addedTime)
        // This should keep extending the timer
        for (let i = 1; i <= 5; i++) {
            await sleep(150)
            node.injectMempoolTx('txid_mp004_' + i)
        }

        // After stopping injection, mining should happen within addedTimeToMineTxs
        await collector.measure('timerBoundary:mineAfterStop', async () => {
            await waitFor(() => node.height > heightBefore, 3000)
        })

        // All 6 txs should be in one block (timer kept extending)
        const lastBlock = node.blocks[node.blocks.length - 1]
        const mp004Txs = lastBlock.txids.filter(id => id.startsWith('txid_mp004_'))
        assert.strictEqual(mp004Txs.length, 6, `Expected 6 txs in block, got ${mp004Txs.length}`)
    })

    // ─── MP-005: Large mempool — 5000 txids, measure poll overhead ────

    it('MP-005: getRawMempool overhead with 5000 txids in mempool', async function () {
        // Pre-populate mempool with 5000 entries
        for (let i = 0; i < 5000; i++) {
            node.injectMempoolTx('txid_mp005_' + i)
        }

        // Measure raw getRawMempool performance (bypass mining loop)
        for (let i = 0; i < 20; i++) {
            await collector.measure('getRawMempool:5000', () =>
                miner.connector.getRawMempool()
            )
        }

        assertP95Under(collector, 'getRawMempool:5000', 100)
        assertMeanUnder(collector, 'getRawMempool:5000', 50)
    })
})
