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
 * Performance Tests: API Layer Throughput
 *
 * Measures JSON-RPC API response latency and throughput
 * by spinning up a real Express server with the miner.
 */

const assert = require('assert')
const sinon = require('sinon')
const http = require('http')
const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
const LatencyMockNode = require('./helpers/LatencyMockNode')
const PerformanceCollector = require('./helpers/PerformanceCollector')
const { assertP95Under, assertMeanUnder, assertThroughputAbove } = require('./helpers/perfAssert')

// Minimal JSON-RPC HTTP client (avoids axios connection pool interference)
function jsonRpcCall(port, method, params = {}) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 })
        const req = http.request({
            hostname: '127.0.0.1',
            port,
            path: '/',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        }, (res) => {
            let data = ''
            res.on('data', chunk => { data += chunk })
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data))
                } catch (e) {
                    reject(new Error('Invalid JSON response: ' + data))
                }
            })
        })
        req.on('error', reject)
        req.write(body)
        req.end()
    })
}

describe('Performance: API Throughput', function () {
    let node, miner, collector
    let apiServer, apiPort

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

        collector = new PerformanceCollector('API')
        miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')
        miner.walletAddress = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'
        miner.balance = 50.0
        miner.keepMining = true

        // Skip the mining loop; only set up the API server for these tests.
        const express = require('express')
        const jsonRpcRouter = require('express-json-rpc-router')

        const app = express()
        app.use(express.json())

        const controller = {
            ping: async () => ({ status: 'success' }),
            send_funds: async ({ address, amount }) => {
                const result = await miner.sendFundsToAddress(address, amount)
                if (result && result.error) return result
                return { result: 'ok' }
            },
            set_mining_time: async ({ max_time, tx_added_time }) => {
                // setMiningTime throws on invalid input (uuid:24c35056); this
                // mirror only ever exercises valid values, but catch defensively
                // to match the real controller's contract.
                try {
                    await miner.setMiningTime(max_time, tx_added_time)
                } catch (err) {
                    return { error: err.message }
                }
                return { result: 'ok' }
            },
            set_default_mining_time: async () => {
                await miner.setDefaultMiningTime()
                return { result: 'ok' }
            },
        }

        app.use('/', jsonRpcRouter({ methods: controller }))

        apiServer = await new Promise(resolve => {
            const srv = app.listen(0, '127.0.0.1', () => {
                apiPort = srv.address().port
                resolve(srv)
            })
        })
    })

    afterEach(async function () {
        if (apiServer) {
            await new Promise(resolve => apiServer.close(resolve))
            apiServer = null
        }

        const names = collector.getMetricNames()
        if (names.length > 0) {
            process.stdout.write(collector.summary())
        }
    })

    // ─── API-001: Ping flood, 50 sequential pings ─────────────────────

    it('API-001: ping flood, 50 sequential pings', async function () {
        const startTime = Date.now()

        for (let i = 0; i < 50; i++) {
            const { result, latencyMs } = await collector.measure('api:ping', async () => {
                return await jsonRpcCall(apiPort, 'ping')
            })
            assert.strictEqual(result.result.status, 'success')
        }

        const elapsed = Date.now() - startTime

        assertP95Under(collector, 'api:ping', 50)
        assertThroughputAbove(collector, 'api:ping', 50, elapsed) // >= 50 pings/sec
    })

    // ─── API-002: Mixed workload, interleaved methods ─────────────────

    it('API-002: mixed workload: ping + set_mining_time + set_default_mining_time', async function () {
        for (let round = 0; round < 10; round++) {
            await collector.measure('api:ping:mixed', async () =>
                jsonRpcCall(apiPort, 'ping')
            )

            await collector.measure('api:set_mining_time', async () =>
                jsonRpcCall(apiPort, 'set_mining_time', { max_time: 5000, tx_added_time: 2000 })
            )

            await collector.measure('api:set_default_mining_time', async () =>
                jsonRpcCall(apiPort, 'set_default_mining_time')
            )
        }

        assertP95Under(collector, 'api:ping:mixed', 50)
        assertP95Under(collector, 'api:set_mining_time', 50)
        assertP95Under(collector, 'api:set_default_mining_time', 50)
    })

    // ─── API-003: Concurrent requests, 10 pings at once ──────────────

    it('API-003: concurrent requests, 10 simultaneous pings', async function () {
        const fns = Array.from({ length: 10 }, () => async () =>
            jsonRpcCall(apiPort, 'ping')
        )

        const { results, latencies } = await collector.measureConcurrent('api:ping:concurrent', fns)

        assert.strictEqual(results.length, 10)
        results.forEach(r => assert.strictEqual(r.result.status, 'success'))

        assertP95Under(collector, 'api:ping:concurrent', 100)
    })
})
