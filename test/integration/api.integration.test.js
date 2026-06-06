/*********************************************************************
 *
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC – https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available —
 * contact legal@dankest.llc.
 *
 **********************************************************************
 * Seam A Integration Tests: HTTP Client ↔ Express JSON-RPC Controller
 *
 * Tests send real HTTP requests through the full Express middleware stack
 * (helmet, CORS, body-parser, express-json-rpc-router) with a mocked miner.
 */

const assert = require('assert')
const sinon = require('sinon')
const http = require('http')
const express = require('express')
const bodyParser = require('body-parser')
const helmet = require('helmet')
const cors = require('cors')
const jsonRouter = require('express-json-rpc-router')

describe('Seam A: HTTP ↔ JSON-RPC controller', function () {
    let app, server, port, miner

    before(function (done) {
        miner = {
            sendFundsToAddress: sinon.stub().resolves('txid_abc123'),
            fillMempool: sinon.stub().resolves(),
            continueMining: sinon.stub().resolves(),
            setMiningTime: sinon.stub().resolves(),
            setDefaultMiningTime: sinon.stub().resolves(),
        }

        // Recreate the exact Express stack from api.js
        app = express()
        app.use(helmet())
        app.use(bodyParser.json())
        app.use(cors())

        const jsonRpcController = {
            async ping() {
                return { status: 'success' }
            },
            async send_funds({ address, amount }) {
                let txid = null
                try {
                    txid = await miner.sendFundsToAddress(address, amount)
                } catch (err) {
                    return { error: 'There was a problem sending ' + amount + ' to ' + address }
                }
                return txid
            },
            async fill_mempool({ tx_quantity }) {
                try {
                    await miner.fillMempool(tx_quantity)
                } catch (err) {
                    return { error: 'There was a problem trying to fill mempool with ' + tx_quantity + ' transactions' }
                }
                return { result: 'ok' }
            },
            async continue_mining({}) {
                try {
                    await miner.continueMining()
                } catch (err) {
                    return { error: 'There was a problem trying to continue the mining' }
                }
                return { result: 'ok' }
            },
            async set_mining_time({ max_time, tx_added_time }) {
                try {
                    await miner.setMiningTime(max_time, tx_added_time)
                } catch (err) {
                    return { error: 'There was a problem trying to set a new time to mine blocks' }
                }
                return { result: 'ok' }
            },
            async set_default_mining_time() {
                try {
                    await miner.setDefaultMiningTime()
                } catch (err) {
                    return { error: 'There was a problem trying to set a the default time to mine blocks' }
                }
                return { result: 'ok' }
            },
        }

        app.use(jsonRouter({ methods: jsonRpcController }))

        server = app.listen(0, '127.0.0.1', () => {
            port = server.address().port
            done()
        })
    })

    after(function (done) {
        server.close(done)
    })

    beforeEach(function () {
        // Reset stubs between tests
        miner.sendFundsToAddress.resetHistory()
        miner.sendFundsToAddress.resolves('txid_abc123')
        miner.fillMempool.resetHistory()
        miner.fillMempool.resolves()
        miner.continueMining.resetHistory()
        miner.continueMining.resolves()
        miner.setMiningTime.resetHistory()
        miner.setMiningTime.resolves()
        miner.setDefaultMiningTime.resetHistory()
        miner.setDefaultMiningTime.resolves()
    })

    // Helper: send a JSON-RPC request and get the parsed response
    function rpcCall(method, params = {}) {
        return new Promise((resolve, reject) => {
            const body = JSON.stringify({
                jsonrpc: '2.0',
                method,
                params,
                id: 1,
            })

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
                        resolve({
                            status: res.statusCode,
                            headers: res.headers,
                            body: JSON.parse(data),
                        })
                    } catch (e) {
                        resolve({
                            status: res.statusCode,
                            headers: res.headers,
                            body: data,
                        })
                    }
                })
            })

            req.on('error', reject)
            req.write(body)
            req.end()
        })
    }

    function rawRequest(options, body) {
        return new Promise((resolve, reject) => {
            const req = http.request({
                hostname: '127.0.0.1',
                port,
                ...options,
            }, (res) => {
                let data = ''
                res.on('data', chunk => data += chunk)
                res.on('end', () => resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: data,
                }))
            })
            req.on('error', reject)
            if (body) req.write(body)
            req.end()
        })
    }

    // ─── JSON-RPC Method Routing ────────────────────────────────────────

    describe('ping', function () {
        it('returns success status', async function () {
            const res = await rpcCall('ping')
            assert.strictEqual(res.status, 200)
            assert.deepStrictEqual(res.body.result, { status: 'success' })
        })
    })

    describe('send_funds', function () {
        it('returns txid on success', async function () {
            const res = await rpcCall('send_funds', { address: 'bcrt1qaddr', amount: 1.5 })
            assert.strictEqual(res.body.result, 'txid_abc123')
            assert(miner.sendFundsToAddress.calledWith('bcrt1qaddr', 1.5))
        })

        it('returns error object on miner failure', async function () {
            miner.sendFundsToAddress.rejects(new Error('no funds'))
            const res = await rpcCall('send_funds', { address: 'addr', amount: 99 })
            assert.ok(res.body.result.error)
            assert.ok(res.body.result.error.includes('99'))
            assert.ok(res.body.result.error.includes('addr'))
        })
    })

    describe('fill_mempool', function () {
        it('returns ok and delegates tx_quantity', async function () {
            const res = await rpcCall('fill_mempool', { tx_quantity: 100 })
            assert.deepStrictEqual(res.body.result, { result: 'ok' })
            assert(miner.fillMempool.calledWith(100))
        })

        it('returns error object on failure', async function () {
            miner.fillMempool.rejects(new Error('crash'))
            const res = await rpcCall('fill_mempool', { tx_quantity: 50 })
            assert.ok(res.body.result.error)
        })
    })

    describe('continue_mining', function () {
        it('returns ok on success', async function () {
            const res = await rpcCall('continue_mining', {})
            assert.deepStrictEqual(res.body.result, { result: 'ok' })
            assert(miner.continueMining.calledOnce)
        })
    })

    describe('set_mining_time', function () {
        it('delegates parameters to miner', async function () {
            const res = await rpcCall('set_mining_time', { max_time: 1000, tx_added_time: 500 })
            assert.deepStrictEqual(res.body.result, { result: 'ok' })
            assert(miner.setMiningTime.calledWith(1000, 500))
        })
    })

    describe('set_default_mining_time', function () {
        it('delegates to miner and returns ok', async function () {
            const res = await rpcCall('set_default_mining_time')
            assert.deepStrictEqual(res.body.result, { result: 'ok' })
            assert(miner.setDefaultMiningTime.calledOnce)
        })
    })

    // ─── Security Headers (Helmet) ──────────────────────────────────────

    describe('Helmet security headers', function () {
        it('includes X-Content-Type-Options header', async function () {
            const res = await rpcCall('ping')
            assert.strictEqual(res.headers['x-content-type-options'], 'nosniff')
        })

        it('includes X-Frame-Options header', async function () {
            const res = await rpcCall('ping')
            assert.ok(res.headers['x-frame-options'])
        })
    })

    // ─── CORS ───────────────────────────────────────────────────────────

    describe('CORS', function () {
        it('responds to OPTIONS preflight', async function () {
            const res = await rawRequest({
                path: '/',
                method: 'OPTIONS',
                headers: {
                    'Origin': 'http://localhost:3000',
                    'Access-Control-Request-Method': 'POST',
                },
            })
            // CORS middleware should handle the preflight
            assert.ok(res.status === 200 || res.status === 204)
        })

        it('includes Access-Control-Allow-Origin on POST', async function () {
            const body = JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 1 })
            const res = await rawRequest({
                path: '/',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    'Origin': 'http://localhost:3000',
                },
            }, body)
            assert.strictEqual(res.headers['access-control-allow-origin'], '*')
        })
    })
})
