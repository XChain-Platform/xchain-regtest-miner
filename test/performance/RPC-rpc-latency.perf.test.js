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
 * Performance Tests — RPC: RPC Method Latency
 *
 * Measures raw HTTP round-trip latency for BlockchainConnector RPC methods
 * using MockRpcServer (stateless, with delay injection support).
 */

const assert = require('assert')
const sinon = require('sinon')
const BlockchainConnector = require('../../src/BlockchainConnector')
const MockRpcServer = require('../integration/helpers/MockRpcServer')
const PerformanceCollector = require('./helpers/PerformanceCollector')
const { assertP95Under, assertMeanUnder, assertMaxUnder } = require('./helpers/perfAssert')

describe('Performance: RPC — RPC Method Latency', function () {
    let server, connector, collector

    before(async function () {
        server = new MockRpcServer()
        await server.start()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    after(async function () {
        sinon.restore()
        await server.stop()
    })

    beforeEach(function () {
        server.reset()
        connector = new BlockchainConnector('127.0.0.1', server.port, 'user', 'pass')
        collector = new PerformanceCollector('RPC')
    })

    afterEach(function () {
        const names = collector.getMetricNames()
        if (names.length > 0) {
            process.stdout.write(collector.summary())
        }
    })

    // ─── RPC-001: Baseline latency for core RPC methods ───────────────

    it('RPC-001: baseline latency for core RPC methods (10 calls each)', async function () {
        const methods = [
            {
                name: 'getNetworkInfo',
                setup: () => server.onMethod('getnetworkinfo').returns({ version: 250000 }),
                call: () => connector.getNetworkInfo(),
            },
            {
                name: 'getBlockchainInfo',
                setup: () => server.onMethod('getblockchaininfo').returns({ chain: 'regtest', blocks: 100 }),
                call: () => connector.getBlockchainInfo(),
            },
            {
                name: 'getRawMempool',
                setup: () => server.onMethod('getrawmempool').returns([]),
                call: () => connector.getRawMempool(),
            },
            {
                name: 'getBalance',
                setup: () => server.onMethod('getbalance').returns(50.0),
                call: () => connector.getBalance(),
            },
            {
                name: 'generateToAddress',
                setup: () => server.onMethod('generatetoaddress').returns(['hash1']),
                call: () => connector.generateToAddress(1, 'bcrt1qtest'),
            },
            {
                name: 'getNewAddress',
                setup: () => server.onMethod('getnewaddress').returns('bcrt1qnewaddr'),
                call: () => connector.getNewAddress(),
            },
            {
                name: 'getBlockHash',
                setup: () => server.onMethod('getblockhash').returns('0000aabbcc'),
                call: () => connector.getBlockHash(1),
            },
            {
                name: 'getBlock',
                setup: () => server.onMethod('getblock').returns({ hash: '00aa', height: 1, tx: [] }),
                call: () => connector.getBlock('00aa'),
            },
            {
                name: 'sendRawTransaction',
                setup: () => server.onMethod('sendrawtransaction').returns('txid123'),
                call: () => connector.sendRawTransaction('0200000000'),
            },
            {
                name: 'sendToAddress',
                setup: () => server.onMethod('sendtoaddress').returns({ txid: 'txid456' }),
                call: () => connector.sendToAddress('bcrt1qtest', 1.0),
            },
        ]

        for (const { name, setup, call } of methods) {
            setup()
            for (let i = 0; i < 10; i++) {
                await collector.measure('rpc:' + name, call)
            }
        }

        // Each method should complete quickly against a local mock
        for (const { name } of methods) {
            assertP95Under(collector, 'rpc:' + name, 50)
        }
    })

    // ─── RPC-002: Concurrent load — 10 simultaneous getRawMempool ─────

    it('RPC-002: 10 concurrent getRawMempool calls', async function () {
        server.onMethod('getrawmempool').returns(['tx1', 'tx2', 'tx3'])

        const fns = Array.from({ length: 10 }, () => () => connector.getRawMempool())
        const { results, latencies } = await collector.measureConcurrent('getRawMempool:concurrent', fns)

        assert.strictEqual(results.length, 10)
        results.forEach(r => assert.deepStrictEqual(r, ['tx1', 'tx2', 'tx3']))

        assertP95Under(collector, 'getRawMempool:concurrent', 100)
    })

    // ─── RPC-003: Under simulated node load — 50ms artificial delay ───

    it('RPC-003: RPC latency with 50ms simulated node delay', async function () {
        server.onMethod('getrawmempool').withDelay(50).returns([])
        server.onMethod('generatetoaddress').withDelay(50).returns(['hash'])

        for (let i = 0; i < 10; i++) {
            await collector.measure('getRawMempool:delayed', () => connector.getRawMempool())
            await collector.measure('generateToAddress:delayed', () => connector.generateToAddress(1, 'bcrt1q'))
        }

        // Should be >= 50ms (delay) but not excessively more
        const mempoolMetrics = collector.getMetrics('getRawMempool:delayed')
        const genMetrics = collector.getMetrics('generateToAddress:delayed')

        assert.ok(mempoolMetrics.min >= 45, `Expected min >= 45ms, got ${mempoolMetrics.min}ms`)
        assertP95Under(collector, 'getRawMempool:delayed', 150)
        assertP95Under(collector, 'generateToAddress:delayed', 150)
    })

    // ─── RPC-004: Connection reuse — 100 sequential calls ─────────────

    it('RPC-004: connection reuse — 100 sequential calls, no degradation', async function () {
        server.onMethod('getrawmempool').returns([])

        for (let i = 0; i < 100; i++) {
            await collector.measure('getRawMempool:100seq', () => connector.getRawMempool())
        }

        const metrics = collector.getMetrics('getRawMempool:100seq')

        // First 10 calls vs last 10 calls should not show significant degradation
        const first10 = metrics.samples.slice(0, 10)
        const last10 = metrics.samples.slice(-10)
        const first10Avg = first10.reduce((a, b) => a + b, 0) / 10
        const last10Avg = last10.reduce((a, b) => a + b, 0) / 10

        collector.record('first10avg', Math.round(first10Avg))
        collector.record('last10avg', Math.round(last10Avg))

        // No more than 3x degradation
        assert.ok(
            last10Avg <= first10Avg * 3 + 10,
            `Connection degradation: first10avg=${first10Avg.toFixed(1)}ms, last10avg=${last10Avg.toFixed(1)}ms`
        )

        assertP95Under(collector, 'getRawMempool:100seq', 50)
    })

    // ─── RPC-005: Mixed concurrent methods ────────────────────────────

    it('RPC-005: mixed concurrent RPC calls (5 different methods)', async function () {
        server.onMethod('getrawmempool').returns([])
        server.onMethod('getblockchaininfo').returns({ chain: 'regtest', blocks: 100 })
        server.onMethod('getbalance').returns(50.0)
        server.onMethod('getnetworkinfo').returns({ version: 250000 })
        server.onMethod('generatetoaddress').returns(['hash1'])

        const fns = [
            () => connector.getRawMempool(),
            () => connector.getBlockchainInfo(),
            () => connector.getBalance(),
            () => connector.getNetworkInfo(),
            () => connector.generateToAddress(1, 'bcrt1q'),
        ]

        // Run 3 rounds of all 5 concurrently
        for (let round = 0; round < 3; round++) {
            await collector.measureConcurrent('mixedConcurrent', fns)
        }

        assertP95Under(collector, 'mixedConcurrent', 100)
    })
})
