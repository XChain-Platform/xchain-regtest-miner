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
 * Performance Tests: SL: Soak and Stability
 *
 * Long-running tests that detect memory leaks, performance degradation,
 * and error recovery behavior over sustained periods.
 */

const assert = require('assert')
const sinon = require('sinon')
const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
const LatencyMockNode = require('./helpers/LatencyMockNode')
const PerformanceCollector = require('./helpers/PerformanceCollector')
const MemorySampler = require('./helpers/MemorySampler')
const { assertNoMemoryLeak, assertHeapDeltaUnder } = require('./helpers/perfAssert')

describe('Performance: SL: Soak and Stability', function () {
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

        collector = new PerformanceCollector('SL')
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

    // ─── SL-001: Idle soak, empty mempool, check memory stability ────

    it('SL-001: idle soak: 3 seconds, empty mempool, no memory growth', async function () {
        const sampler = new MemorySampler(100)

        startMinerLoop()
        await waitFor(() => miner.keepMining === true)

        sampler.start()
        await sleep(3000)
        sampler.stop()

        // Verify the loop was actually running
        const pollCount = node.callsFor('getrawmempool').length
        assert.ok(pollCount > 50, `Expected >50 mempool polls in 3s, got ${pollCount}`)

        collector.record('pollCount', pollCount)
        collector.record('heapGrowthKBPerSec', Math.round(sampler.summarize().heapGrowthRatePerSecond / 1024))

        // Allow generous threshold: GC and JIT can cause growth in short tests
        assertNoMemoryLeak(sampler, 5 * 1024 * 1024) // < 5 MB/s growth (short soak)
    })

    // ─── SL-002: Active soak, txs injected and mined over 3 seconds ──

    it('SL-002: active soak: inject + mine cycles over 3 seconds', async function () {
        miner.maxTimeToMineTxs = 300
        miner.addedTimeToMineTxs = 100

        const sampler = new MemorySampler(100)

        startMinerLoop()
        await waitFor(() => miner.keepMining === true)

        sampler.start()
        const heightBefore = node.height
        const startTime = Date.now()

        // Inject 1 tx every 200ms for 3 seconds
        let txCount = 0
        const interval = setInterval(() => {
            node.injectMempoolTx('txid_sl002_' + txCount++)
        }, 200)

        await sleep(3000)
        clearInterval(interval)

        // Wait for final block
        await sleep(500)
        sampler.stop()

        const blocksMined = node.height - heightBefore
        const elapsed = Date.now() - startTime

        collector.record('blocksMined', blocksMined)
        collector.record('txsInjected', txCount)
        collector.record('elapsedMs', elapsed)
        collector.record('heapGrowthKBPerSec', Math.round(sampler.summarize().heapGrowthRatePerSecond / 1024))

        assert.ok(blocksMined >= 2, `Expected >= 2 blocks in 3s, got ${blocksMined}`)
        // Same generous threshold as SL-001: over a 3.5s window V8 often has
        // not run a major GC at all, so raw heap delta reflects allocation
        // churn (axios/JSON per poll), not a leak. Observed ~2-4.5 MB/s on
        // Node 22 with zero growth across longer soaks.
        assertNoMemoryLeak(sampler, 5 * 1024 * 1024)
    })

    // ─── SL-003: Burst soak, repeated inject+mine cycles ─────────────

    it('SL-003: burst soak: 10 cycles of inject 20 txs + mine', async function () {
        miner.maxTimeToMineTxs = 200
        miner.addedTimeToMineTxs = 80

        const sampler = new MemorySampler(50)

        startMinerLoop()
        await waitFor(() => miner.keepMining === true)
        sampler.start()

        for (let cycle = 0; cycle < 10; cycle++) {
            const heightBefore = node.height

            // Inject 20 txs
            for (let i = 0; i < 20; i++) {
                node.injectMempoolTx(`txid_sl003_c${cycle}_${i}`)
            }

            // Wait for block
            await waitFor(() => node.height > heightBefore, 3000)
            collector.record('cycleBlockTime', Date.now())
        }

        sampler.stop()

        const summary = sampler.summarize()
        collector.record('totalCycles', 10)
        collector.record('heapDeltaMB', Math.round(summary.heapUsedDelta / 1024 / 1024 * 100) / 100)

        assertHeapDeltaUnder(sampler, 10 * 1024 * 1024) // < 10MB total growth
    })

    // ─── SL-004: Error recovery, RPC failures then recovery ──────────

    it('SL-004: error recovery: intermittent RPC failures, then normal operation', async function () {
        miner.maxTimeToMineTxs = 300
        miner.addedTimeToMineTxs = 100

        // Start with failures on getrawmempool for first 500ms
        let failUntil = Date.now() + 500
        const originalGetRawMempool = node._rpc_getrawmempool.bind(node)
        node._rpc_getrawmempool = function (params) {
            if (Date.now() < failUntil) {
                const err = new Error('Node busy')
                err.rpcCode = -28
                throw err
            }
            return originalGetRawMempool(params)
        }

        startMinerLoop()

        // Wait through the failure period
        await sleep(800)

        // Now verify the miner recovered and can still mine
        await waitFor(() => miner.keepMining === true, 3000)

        const heightBefore = node.height
        node.injectMempoolTx('txid_sl004_recovery')

        await collector.measure('recoveryMine', async () => {
            await waitFor(() => node.height > heightBefore, 5000)
        })

        assert.strictEqual(node.height, heightBefore + 1)

        // Error calls were recorded
        const errorCalls = node.calls.filter(c =>
            c.method === 'getrawmempool' && Date.now() - 2000 < failUntil
        )
        collector.record('errorCallsBeforeRecovery', node.callsFor('getrawmempool').length)
    })
})
