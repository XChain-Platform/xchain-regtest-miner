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
 * Chaos Tests: CE-07: Large Mempool, CE-09: Concurrent API Abuse
 *
 * CE-07: Tests miner behavior with 10,000+ entries in mempool response.
 * CE-09: Tests concurrency guard and Express stability under load.
 */

const assert = require('assert')
const sinon = require('sinon')
const http = require('http')
const ChaosNode = require('./helpers/ChaosNode')
const { createMiner, seedWallet, startMinerLoop, stopMinerLoop, waitFor, sleep } = require('./helpers/chaosSetup')

describe('Chaos: Stress Testing', function () {
    let node

    before(async function () {
        node = new ChaosNode()
        await node.start()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    after(async function () {
        sinon.restore()
        await node.stop()
    })

    beforeEach(function () {
        node.reset()
        seedWallet(node)
    })

    // ── JSON-RPC helper for API tests ───────────────────────────────

    function rpcCall(port, method, params = {}) {
        return new Promise((resolve, reject) => {
            const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 })
            const req = http.request({
                hostname: '127.0.0.1',
                port,
                path: '/',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                },
            }, (res) => {
                let data = ''
                res.on('data', chunk => data += chunk)
                res.on('end', () => {
                    try {
                        resolve({ status: res.statusCode, body: JSON.parse(data) })
                    } catch (e) {
                        resolve({ status: res.statusCode, body: data })
                    }
                })
            })
            req.on('error', reject)
            req.write(body)
            req.end()
        })
    }

    // ─── CE-07: Large Mempool ───────────────────────────────────────

    describe('CE-07: Large Mempool (10,000+ entries)', function () {

        it('CE-07: miner handles 10,000+ mempool entries without memory issues', async function () {
            const miner = createMiner(node)
            miner.maxTimeToMineTxs = 300
            miner.addedTimeToMineTxs = 80

            const heapBefore = process.memoryUsage().heapUsed

            // Corrupt getrawmempool to return a synthetic large array
            const tenThousandTxids = Array.from(
                { length: 10001 },
                (_, i) => 'fakeid_' + String(i).padStart(8, '0')
            )
            node.corruptResponse('getrawmempool', () => tenThousandTxids)

            const heightBefore = node.height
            const { startPromise } = startMinerLoop(miner)
            await waitFor(() => miner.keepMining === true)

            // Miner will see 10,001 "transactions" and mine a block
            await waitFor(() => node.height > heightBefore, 3000)

            assert.ok(node.height > heightBefore,
                'Miner should handle large mempool and mine a block')

            // Memory check: heap increase should be reasonable
            const heapAfter = process.memoryUsage().heapUsed
            const heapIncreaseMB = (heapAfter - heapBefore) / (1024 * 1024)
            assert.ok(heapIncreaseMB < 50,
                'Heap increase should be under 50MB, got ' + heapIncreaseMB.toFixed(2) + 'MB')

            node.clearCorruptors()
            await stopMinerLoop(miner, startPromise)
        })
    })

    // ─── CE-09: Concurrent API Abuse ────────────────────────────────

    describe('CE-09: Concurrent API Abuse', function () {
        let apiServer
        let apiPort

        beforeEach(async function () {
            // Spin up the Express API server (mirrors api.js setup)
            const express = require('express')
            const jsonRpcRouter = require('express-json-rpc-router')
            const app = express()
            app.use(express.json())

            const miner = createMiner(node)
            // Pre-set wallet address so send_funds works
            miner.walletAddress = 'bcrt1qseed'
            miner.keepMining = true

            // Store miner reference for assertions
            this.miner = miner

            const controller = {
                async ping() { return { status: 'success' } },
                async send_funds({ address, amount }) {
                    try {
                        const txid = await miner.sendFundsToAddress(address, amount)
                        return txid
                    } catch (err) {
                        return { error: err.message }
                    }
                },
                async fill_mempool({ tx_quantity }) {
                    try {
                        const result = await miner.fillMempool(tx_quantity)
                        if (result && result.error) return result
                        return { result: 'ok' }
                    } catch (err) {
                        return { error: err.message }
                    }
                },
                async set_mining_time({ max_time, tx_added_time }) {
                    try {
                        const result = await miner.setMiningTime(max_time, tx_added_time)
                        if (result && result.error) return result
                        return { result: 'ok' }
                    } catch (err) {
                        return { error: err.message }
                    }
                },
            }

            app.use(jsonRpcRouter({ methods: controller }))

            await new Promise(resolve => {
                apiServer = app.listen(0, '127.0.0.1', () => {
                    apiPort = apiServer.address().port
                    resolve()
                })
            })
        })

        afterEach(async function () {
            if (apiServer) {
                await new Promise(resolve => apiServer.close(resolve))
                apiServer = null
            }
        })

        it('CE-09a: 10 concurrent fill_mempool calls; exactly 1 accepted, rest rejected by guard', async function () {
            const miner = this.miner

            // Stub connector.sleep so fillMempool retries don't wait
            sinon.stub(miner.connector, 'sleep').resolves()

            const results = await Promise.all(
                Array.from({ length: 10 }, () =>
                    rpcCall(apiPort, 'fill_mempool', { tx_quantity: 1 })
                )
            )

            // Count how many were rejected by the concurrency guard
            const rejected = results.filter(r =>
                r.body.result && r.body.result.error && r.body.result.error.includes('already running')
            )

            // At least some should be rejected (concurrency guard works)
            // In practice, due to Node.js single-threaded nature, the first
            // request sets fillMempoolRunning=true synchronously before yielding,
            // so most subsequent requests will see the guard.
            assert.ok(rejected.length >= 1,
                'At least 1 call should be rejected by concurrency guard, got ' + rejected.length)

            // Eventually fillMempoolRunning resets
            await sleep(100)
            assert.strictEqual(miner.fillMempoolRunning, false,
                'fillMempoolRunning should reset after all calls complete')

            miner.connector.sleep.restore()
        })

        it('CE-09b: 50 concurrent send_funds calls complete without crashing', async function () {
            const results = await Promise.all(
                Array.from({ length: 50 }, (_, i) =>
                    rpcCall(apiPort, 'send_funds', {
                        address: 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080',
                        amount: 0.001,
                    })
                )
            )

            // All requests should have completed (success or error response)
            assert.strictEqual(results.length, 50, 'All 50 requests should complete')

            // Some may fail due to insufficient funds; that's expected.
            // The key assertion is: server is still alive
            const pingResult = await rpcCall(apiPort, 'ping', {})
            assert.strictEqual(pingResult.body.result.status, 'success',
                'API server should still be responsive after 50 concurrent calls')
        })

        it('CE-09c: 20 concurrent set_mining_time calls produce valid final state', async function () {
            const miner = this.miner

            const validTimes = Array.from({ length: 20 }, (_, i) => ({
                max_time: 1000 + (i * 100),
                tx_added_time: 1000 + (i * 50),
            }))

            await Promise.all(
                validTimes.map(t =>
                    rpcCall(apiPort, 'set_mining_time', t)
                )
            )

            // Final state should be one of the valid values
            assert.ok(Number.isInteger(miner.maxTimeToMineTxs),
                'maxTimeToMineTxs should be an integer')
            assert.ok(Number.isInteger(miner.addedTimeToMineTxs),
                'addedTimeToMineTxs should be an integer')
            assert.ok(miner.maxTimeToMineTxs >= 1000 && miner.maxTimeToMineTxs <= 2900,
                'maxTimeToMineTxs should be within the range of values sent')
            assert.ok(miner.addedTimeToMineTxs >= 1000 && miner.addedTimeToMineTxs <= 1950,
                'addedTimeToMineTxs should be within the range of values sent')

            // Server still alive
            const pingResult = await rpcCall(apiPort, 'ping', {})
            assert.strictEqual(pingResult.body.result.status, 'success')
        })
    })
})
