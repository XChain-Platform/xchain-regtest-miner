/**
 * E2E Tests — Category C: JSON-RPC API Against Live Miner
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

describe('E2E: JSON-RPC API Against Live Miner', function () {
    let node, miner, app, apiServer, apiPort
    let startPromise

    before(async function () {
        node = new StatefulMockNode()
        await node.start()

        // Pre-seed wallet
        node._rpc_createwallet(['xchain_regtest_wallet'])
        node._rpc_generatetoaddress([110, 'bcrt1qseed'])

        sinon.stub(console, 'log')
        sinon.stub(console, 'error')

        miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')

        // Fast sleep
        const originalSleep = miner.sleep.bind(miner)
        miner.sleep = async (ms) => {
            if (miner._shutdown) throw new Error('__E2E_SHUTDOWN__')
            await originalSleep(10)
        }

        // Start the mining loop in background
        startPromise = miner.start().catch(e => {
            if (e.message !== '__E2E_SHUTDOWN__') throw e
        })

        // Wait for wallet to be ready
        await new Promise(resolve => {
            const check = setInterval(() => {
                if (miner.walletAddress) {
                    clearInterval(check)
                    resolve()
                }
            }, 20)
        })

        // Build Express app with real miner (same structure as api.js)
        app = express()
        app.use(helmet())
        app.use(bodyParser.json())
        app.use(cors())

        const jsonRpcController = {
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

        app.use(jsonRouter({ methods: jsonRpcController }))

        await new Promise(resolve => {
            apiServer = app.listen(0, '127.0.0.1', () => {
                apiPort = apiServer.address().port
                resolve()
            })
        })
    })

    after(async function () {
        miner._shutdown = true
        if (startPromise) {
            try { await startPromise } catch (e) {
                if (e.message !== '__E2E_SHUTDOWN__') throw e
            }
        }
        await new Promise(resolve => apiServer.close(resolve))
        sinon.restore()
        await node.stop()
    })

    function rpcCall(method, params = {}) {
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

    // ─── C1: Ping health check ──────────────────────────────────────

    it('C1: ping returns success while mining loop is running', async function () {
        const res = await rpcCall('ping')
        assert.strictEqual(res.status, 200)
        assert.deepStrictEqual(res.body.result, { status: 'success' })
    })

    // ─── C2: send_funds creates a real transaction ──────────────────

    it('C2: send_funds creates a transaction on the mock node', async function () {
        const mempoolBefore = node.mempool.length
        const res = await rpcCall('send_funds', { address: 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080', amount: 1.0 })
        assert.strictEqual(res.status, 200)

        // Should return a txid string
        const txid = res.body.result
        assert.ok(typeof txid === 'string')
        assert.ok(txid.length > 0)

        // Transaction should be in the mock node's mempool
        const mempoolTxids = node.mempool.map(m => m.txid)
        assert.ok(mempoolTxids.includes(txid))
    })

    // ─── C3: set_mining_time takes effect on live loop ──────────────

    it('C3: set_mining_time changes live mining behavior', async function () {
        // Set short but valid timers (minimum is 1000ms)
        const res = await rpcCall('set_mining_time', { max_time: 1000, tx_added_time: 1000 })
        assert.deepStrictEqual(res.body.result, { result: 'ok' })
        assert.strictEqual(miner.maxTimeToMineTxs, 1000)
        assert.strictEqual(miner.addedTimeToMineTxs, 1000)

        // Reset to defaults
        const res2 = await rpcCall('set_default_mining_time')
        assert.deepStrictEqual(res2.body.result, { result: 'ok' })
        assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        assert.strictEqual(miner.addedTimeToMineTxs, 5000)
    })

    // ─── C4: Pause and resume mining ────────────────────────────────

    it('C4: continue_mining resumes mining after pause', async function () {
        const heightBefore = node.height

        // Pause mining
        miner.keepMining = false

        // Inject a transaction
        node.injectMempoolTx('txid_c4_001')

        // Wait — no mining should happen
        await sleep(200)
        assert.strictEqual(node.height, heightBefore)

        // Resume via API
        miner.maxTimeToMineTxs = 500
        miner.addedTimeToMineTxs = 80
        const res = await rpcCall('continue_mining', {})
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
