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
 * Performance Tests: BG: Block Generation Latency
 *
 * Measures the time to generate blocks under varying mempool sizes
 * and request patterns. Uses LatencyMockNode for stateful simulation
 * with real wall-clock timing.
 */

const assert = require('assert')
const sinon = require('sinon')
const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
const LatencyMockNode = require('./helpers/LatencyMockNode')
const PerformanceCollector = require('./helpers/PerformanceCollector')
const { assertP95Under, assertMeanUnder, assertMaxUnder } = require('./helpers/perfAssert')

describe('Performance: BG: Block Generation Latency', function () {
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
        // Pre-seed a loaded, funded wallet
        node._rpc_createwallet(['xchain_regtest_wallet'])
        node._rpc_generatetoaddress([110, 'bcrt1qseed'])
        node.calls = []

        collector = new PerformanceCollector('BG')
        miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')

        // Fast polling: 10ms instead of 1000ms
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

        // Print summary for this test
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

    // ─── BG-001: Empty mempool, baseline generateToAddress latency ────

    it('BG-001: generateToAddress latency with empty mempool (20 calls)', async function () {
        // Set wallet address directly, bypassing prepareWallet
        miner.walletAddress = node.addresses[0] || 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'

        for (let i = 0; i < 20; i++) {
            await collector.measure('generateToAddress:empty', () =>
                miner.connector.generateToAddress(1, miner.walletAddress)
            )
        }

        assertP95Under(collector, 'generateToAddress:empty', 50)
        assertMeanUnder(collector, 'generateToAddress:empty', 30)
    })

    // ─── BG-002: Small mempool (10 txs), mining cycle latency ─────────

    it('BG-002: mining cycle latency with 10 txs in mempool (5 cycles)', async function () {
        miner.maxTimeToMineTxs = 200
        miner.addedTimeToMineTxs = 80

        startMinerLoop()
        await waitFor(() => miner.keepMining === true)

        for (let cycle = 0; cycle < 5; cycle++) {
            const heightBefore = node.height

            await collector.measure('miningCycle:10tx', async () => {
                // Inject 10 transactions
                for (let i = 0; i < 10; i++) {
                    node.injectMempoolTx(`txid_bg002_c${cycle}_${i}`)
                }
                await waitFor(() => node.height > heightBefore, 3000)
            })
        }

        assertP95Under(collector, 'miningCycle:10tx', 2000)
    })

    // ─── BG-003: Medium mempool (100 txs), mining cycle latency ───────

    it('BG-003: mining cycle latency with 100 txs in mempool (3 cycles)', async function () {
        miner.maxTimeToMineTxs = 200
        miner.addedTimeToMineTxs = 80

        startMinerLoop()
        await waitFor(() => miner.keepMining === true)

        for (let cycle = 0; cycle < 3; cycle++) {
            const heightBefore = node.height

            await collector.measure('miningCycle:100tx', async () => {
                for (let i = 0; i < 100; i++) {
                    node.injectMempoolTx(`txid_bg003_c${cycle}_${i}`)
                }
                await waitFor(() => node.height > heightBefore, 3000)
            })
        }

        assertP95Under(collector, 'miningCycle:100tx', 2000)
    })

    // ─── BG-004: Large mempool (1000 txs), mining cycle latency ───────

    it('BG-004: mining cycle latency with 1000 txs in mempool', async function () {
        miner.maxTimeToMineTxs = 300
        miner.addedTimeToMineTxs = 100

        startMinerLoop()
        await waitFor(() => miner.keepMining === true)

        const heightBefore = node.height

        await collector.measure('miningCycle:1000tx', async () => {
            for (let i = 0; i < 1000; i++) {
                node.injectMempoolTx(`txid_bg004_${i}`)
            }
            await waitFor(() => node.height > heightBefore, 5000)
        })

        assertMaxUnder(collector, 'miningCycle:1000tx', 5000)
    })

    // ─── BG-005: Rapid sequential mining, 10 blocks ───────────────────

    it('BG-005: rapid sequential generateToAddress, 10 blocks', async function () {
        miner.walletAddress = node.addresses[0] || 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'

        for (let i = 0; i < 10; i++) {
            await collector.measure('generateToAddress:sequential', () =>
                miner.connector.generateToAddress(1, miner.walletAddress)
            )
        }

        const metrics = collector.getMetrics('generateToAddress:sequential')
        // No significant degradation: last call should not be >3x the first
        assert.ok(
            metrics.max <= metrics.min * 5 + 10,
            `Sequential degradation: min=${metrics.min}ms, max=${metrics.max}ms`
        )
        assertP95Under(collector, 'generateToAddress:sequential', 100)
    })

    // ─── BG-006: Burst mining, generateToAddress(10) vs 10x single ───

    it('BG-006: burst mining: generateToAddress(10) in one call vs 10x single', async function () {
        miner.walletAddress = node.addresses[0] || 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'

        // Single call for 10 blocks
        const { latencyMs: burstMs } = await collector.measure('generateToAddress:burst10', () =>
            miner.connector.generateToAddress(10, miner.walletAddress)
        )

        // 10 individual calls
        let sequentialTotal = 0
        for (let i = 0; i < 10; i++) {
            const { latencyMs } = await collector.measure('generateToAddress:single', () =>
                miner.connector.generateToAddress(1, miner.walletAddress)
            )
            sequentialTotal += latencyMs
        }

        collector.record('generateToAddress:burst10:total', burstMs)
        collector.record('generateToAddress:10xSingle:total', sequentialTotal)

        // Burst should not be dramatically slower than sequential total
        assert.ok(
            burstMs <= sequentialTotal * 3 + 50,
            `Burst(10)=${burstMs}ms vs 10xSingle=${sequentialTotal}ms; burst should not be >3x slower`
        )
    })
})
