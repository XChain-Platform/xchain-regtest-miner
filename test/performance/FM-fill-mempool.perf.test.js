/**
 * Performance Tests — FM: fillMempool Performance
 *
 * Measures end-to-end duration and resource consumption of the fillMempool
 * operation at various scales. Uses LatencyMockNode for stateful simulation.
 */

const assert = require('assert')
const sinon = require('sinon')
const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
const LatencyMockNode = require('./helpers/LatencyMockNode')
const PerformanceCollector = require('./helpers/PerformanceCollector')
const MemorySampler = require('./helpers/MemorySampler')
const { assertMaxUnder, assertHeapDeltaUnder } = require('./helpers/perfAssert')

describe('Performance: FM — fillMempool', function () {
    let node, miner, collector

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
        // Pre-seed wallet with plenty of balance (500 blocks of rewards)
        node._rpc_createwallet(['xchain_regtest_wallet'])
        node._rpc_generatetoaddress([500, 'bcrt1qseed'])
        node.calls = []

        collector = new PerformanceCollector('FM')
        miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')
        miner.walletAddress = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'

        // Fast sleep for fillMempool retries
        const originalSleep = miner.sleep.bind(miner)
        miner.sleep = async (ms) => await originalSleep(5)
    })

    afterEach(async function () {
        const names = collector.getMetricNames()
        if (names.length > 0) {
            process.stdout.write(collector.summary())
        }
    })

    // ─── FM-001: fillMempool(10) — small scale baseline ───────────────

    it('FM-001: fillMempool(10) — total duration and RPC call counts', async function () {
        this.timeout(30000)

        const { latencyMs } = await collector.measure('fillMempool:10', () =>
            miner.fillMempool(10)
        )

        collector.record('sendRawTxCalls', node.callsFor('sendrawtransaction').length)
        collector.record('generateCalls', node.callsFor('generatetoaddress').length)

        // Functional: correct number of stress txs in mempool
        assert.strictEqual(node.mempool.length, 10)
        assert.strictEqual(miner.keepMining, true)

        assertMaxUnder(collector, 'fillMempool:10', 15000)
    })

    // ─── FM-002: fillMempool(100) — medium scale ──────────────────────

    it('FM-002: fillMempool(100) — duration and memory', async function () {
        this.timeout(30000)

        const sampler = new MemorySampler(200)
        sampler.start()

        const { latencyMs } = await collector.measure('fillMempool:100', () =>
            miner.fillMempool(100)
        )

        sampler.stop()

        collector.record('sendRawTxCalls', node.callsFor('sendrawtransaction').length)
        collector.record('generateCalls', node.callsFor('generatetoaddress').length)

        assert.strictEqual(node.mempool.length, 100)
        assertMaxUnder(collector, 'fillMempool:100', 30000)
        assertHeapDeltaUnder(sampler, 50 * 1024 * 1024) // < 50MB growth
    })

    // ─── FM-003: fillMempool(500) — scaling behavior ──────────────────

    it('FM-003: fillMempool(500) — scaling behavior', async function () {
        this.timeout(60000)

        const sampler = new MemorySampler(500)
        sampler.start()

        const { latencyMs } = await collector.measure('fillMempool:500', () =>
            miner.fillMempool(500)
        )

        sampler.stop()

        collector.record('sendRawTxCalls', node.callsFor('sendrawtransaction').length)
        collector.record('generateCalls', node.callsFor('generatetoaddress').length)

        assert.strictEqual(node.mempool.length, 500)
        assertMaxUnder(collector, 'fillMempool:500', 60000)
        assertHeapDeltaUnder(sampler, 100 * 1024 * 1024) // < 100MB growth
    })

    // ─── FM-004: Scaling ratio — compare fillMempool(10) vs fillMempool(100)

    it('FM-004: scaling ratio — fillMempool(10) vs fillMempool(100) time', async function () {
        this.timeout(60000)

        // Already measured fillMempool(10) in FM-001. Measure another baseline.
        const { latencyMs: time10 } = await collector.measure('fillMempool:10:scaling', () =>
            miner.fillMempool(10)
        )

        assert.strictEqual(node.mempool.length, 10)

        // Reset node state for next run
        node.reset()
        node._rpc_createwallet(['xchain_regtest_wallet'])
        node._rpc_generatetoaddress([500, 'bcrt1qseed'])
        node.calls = []
        miner.fillMempoolRunning = false

        const { latencyMs: time100 } = await collector.measure('fillMempool:100:scaling', () =>
            miner.fillMempool(100)
        )

        assert.strictEqual(node.mempool.length, 100)

        collector.record('scalingRatio', Math.round((time100 / time10) * 100) / 100)

        // 100 txs should not take more than 20x the time of 10 txs (sub-linear or linear)
        assert.ok(
            time100 <= time10 * 20 + 5000,
            `Scaling issue: 10tx=${time10}ms, 100tx=${time100}ms, ratio=${(time100 / time10).toFixed(1)}x`
        )
    })

    // ─── FM-005: Concurrent fillMempool — mutex rejection ─────────────

    it('FM-005: concurrent fillMempool calls — second rejected immediately', async function () {
        this.timeout(30000)

        // Start first fillMempool (runs async)
        const p1 = miner.fillMempool(10)

        // Immediately attempt second — should be rejected by fillMempoolRunning guard
        const t0 = Date.now()
        const result2 = await miner.fillMempool(10)
        const rejectionTime = Date.now() - t0

        collector.record('mutexRejection', rejectionTime)

        assert.ok(result2 && result2.error, 'Second call should return error object')
        assert.ok(rejectionTime < 50, 'Rejection should be near-instant, got: ' + rejectionTime + 'ms')

        // Let first complete
        await p1
    })
})
