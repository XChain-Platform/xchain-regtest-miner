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
 * E2E Tests: Category C: JSON-RPC API Against Live Miner
 *
 * Validates the full HTTP → Express → miner → connector → mock node
 * pipeline with all components running concurrently.
 */

const assert = require('assert')
const sinon = require('sinon')
const http = require('http')
const express = require('express')
const bodyParser = require('body-parser')
const helmet = require('helmet')
const cors = require('cors')
const jsonRouter = require('express-json-rpc-router')
const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
const StatefulMockNode = require('./helpers/StatefulMockNode')

function createJsonRpcController(miner) {
    return {
        async ping() { return { status: 'success' } },
        async send_funds({ address, amount }) {
            try {
                return await miner.sendFundsToAddress(address, amount)
            } catch (err) {
                return { error: 'There was a problem sending ' + amount + ' to ' + address }
            }
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
}

async function waitForWallet(miner) {
    // Wait for wallet to be ready
    await new Promise(resolve => {
        const check = setInterval(() => {
            if (miner.walletAddress) {
                clearInterval(check)
                resolve()
            }
        }, 20)
    })
}

async function startApiContext() {
    const node = new StatefulMockNode()
    await node.start()

    // Pre-seed wallet
    node._rpc_createwallet(['xchain_regtest_wallet'])
    node._rpc_generatetoaddress([110, 'bcrt1qseed'])

    sinon.stub(console, 'log')
    sinon.stub(console, 'error')

    const miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')

    // Fast sleep
    const originalSleep = miner.sleep.bind(miner)
    miner.sleep = async (ms) => {
        if (miner._shutdown) throw new Error('__E2E_SHUTDOWN__')
        await originalSleep(10)
    }

    // Start the mining loop in background
    const startPromise = miner.start().catch(e => {
        if (e.message !== '__E2E_SHUTDOWN__') throw e
    })

    await waitForWallet(miner)

    // Build Express app with real miner (same structure as api.js)
    const app = express()
    app.use(helmet())
    app.use(bodyParser.json())
    app.use(cors())
    app.use(jsonRouter({ methods: createJsonRpcController(miner) }))

    let apiServer
    await new Promise(resolve => {
        apiServer = app.listen(0, '127.0.0.1', resolve)
    })
    return { node, miner, apiServer, apiPort: apiServer.address().port, startPromise }
}

async function stopApiContext(context) {
    context.miner._shutdown = true
    if (context.startPromise) {
        try { await context.startPromise } catch (e) {
            if (e.message !== '__E2E_SHUTDOWN__') throw e
        }
    }
    await new Promise(resolve => context.apiServer.close(resolve))
    sinon.restore()
    await context.node.stop()
}

function rpcCall(apiPort, method, params = {}) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 })
        const req = http.request({
            hostname: '127.0.0.1',
            port: apiPort,
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
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }) }
                catch (e) { resolve({ status: res.statusCode, body: data }) }
            })
        })
        req.on('error', reject)
        req.write(body)
        req.end()
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

describe('E2E: JSON-RPC API Against Live Miner', function () {
    let context, apiPort

    before(async function () {
        context = await startApiContext()
        apiPort = context.apiPort
    })
    after(async function () { await stopApiContext(context) })

    // ─── C1: Ping health check ──────────────────────────────────────

    it('C1: ping returns success while mining loop is running', async function () {
        const res = await rpcCall(apiPort, 'ping')
        assert.strictEqual(res.status, 200)
        assert.deepStrictEqual(res.body.result, { status: 'success' })
    })
})

// ─── C2: send_funds creates a real transaction ──────────────────

describe('E2E: JSON-RPC API Against Live Miner', function () {
    let context, node, apiPort

    before(async function () {
        context = await startApiContext()
        ;({ node, apiPort } = context)
    })
    after(async function () { await stopApiContext(context) })

    it('C2: send_funds creates a transaction on the mock node', async function () {
        const mempoolBefore = node.mempool.length
        const res = await rpcCall(apiPort, 'send_funds', { address: 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080', amount: 1.0 })
        assert.strictEqual(res.status, 200)

        // Should return a txid string
        const txid = res.body.result
        assert.ok(typeof txid === 'string')
        assert.ok(txid.length > 0)

        // Transaction should be in the mock node's mempool
        const mempoolTxids = node.mempool.map(m => m.txid)
        assert.ok(mempoolTxids.includes(txid))
    })
})

// ─── C3: set_mining_time takes effect on live loop ──────────────

describe('E2E: JSON-RPC API Against Live Miner', function () {
    let context, miner, apiPort

    before(async function () {
        context = await startApiContext()
        ;({ miner, apiPort } = context)
    })
    after(async function () { await stopApiContext(context) })

    it('C3: set_mining_time changes live mining behavior', async function () {
        // Set short but valid timers (minimum is 1000ms)
        const res = await rpcCall(apiPort, 'set_mining_time', { max_time: 1000, tx_added_time: 1000 })
        assert.deepStrictEqual(res.body.result, { result: 'ok' })
        assert.strictEqual(miner.maxTimeToMineTxs, 1000)
        assert.strictEqual(miner.addedTimeToMineTxs, 1000)

        // Reset to defaults
        const res2 = await rpcCall(apiPort, 'set_default_mining_time')
        assert.deepStrictEqual(res2.body.result, { result: 'ok' })
        assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        assert.strictEqual(miner.addedTimeToMineTxs, 5000)
    })
})

// ─── C4: Pause and resume mining ────────────────────────────────

describe('E2E: JSON-RPC API Against Live Miner', function () {
    let context, node, miner, apiPort

    before(async function () {
        context = await startApiContext()
        ;({ node, miner, apiPort } = context)
    })
    after(async function () { await stopApiContext(context) })

    it('C4: continue_mining resumes mining after pause', async function () {
        const heightBefore = node.height

        // Pause mining
        miner.keepMining = false

        // Inject a transaction
        node.injectMempoolTx('txid_c4_001')

        // No mining should happen. A paused loop issues no RPC at all, so the
        // node records nothing and there is no external event to wait on; its
        // own sleep is the one tick per cycle. Count cycles so the "nothing
        // happened" window is a known number of loop iterations that ran with
        // mining off, instead of a wall-clock guess that may not have covered
        // even one.
        let pausedCycles = 0
        const loopSleep = miner.sleep
        miner.sleep = async (ms) => {
            pausedCycles++
            return loopSleep(ms)
        }
        try {
            await waitFor(() => pausedCycles >= 10, 3000)
        } finally {
            miner.sleep = loopSleep
        }
        assert.strictEqual(node.height, heightBefore)

        // Resume via API
        miner.maxTimeToMineTxs = 500
        miner.addedTimeToMineTxs = 80
        const res = await rpcCall(apiPort, 'continue_mining', {})
        assert.deepStrictEqual(res.body.result, { result: 'ok' })

        // Now mining should resume and process the transaction
        const start = Date.now()
        while (node.height <= heightBefore && Date.now() - start < 3000) {
            await sleep(20)
        }

        assert.ok(node.height > heightBefore)

        // Restore defaults
        miner.maxTimeToMineTxs = 30000
        miner.addedTimeToMineTxs = 5000
    })
})
