/**
 * E2E Tests — Category B: Mempool Monitoring and Block Generation
 *
 * Validates the mining loop's interaction with a stateful mock node:
 * mempool detection, timer-based block generation, and state resets.
 * Uses real (but fast) sleep intervals and short mining timers.
 */

const assert = require('assert')
const sinon = require('sinon')
const BlockchainConnector = require('../../src/BlockchainConnector')
const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
const StatefulMockNode = require('./helpers/StatefulMockNode')

describe('E2E: Mempool Monitoring and Block Generation', function () {
    let node, miner
    let startPromise

    before(async function () {
        node = new StatefulMockNode()
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
        node.calls = [] // Clear setup calls from tracking

        miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')

        // Fast polling: override sleep to 10ms instead of 1000ms
        const originalSleep = miner.sleep.bind(miner)
        miner.sleep = async (ms) => {
            if (miner._shutdown) {
                throw new Error('__E2E_SHUTDOWN__')
            }
            await originalSleep(10)
        }
    })

    afterEach(async function () {
        // Stop the mining loop
        miner._shutdown = true
        if (startPromise) {
            try { await startPromise } catch (e) {
                if (e.message !== '__E2E_SHUTDOWN__') throw e
            }
        }
        startPromise = null
        // Clean up SIGTERM handler registered by start()
        if (miner && miner._sigTermHandler) {
            process.removeListener('SIGTERM', miner._sigTermHandler)
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

    // ─── B1: Single transaction — detect, wait, mine ────────────────

    it('B1: detects a mempool transaction and mines a block', async function () {
        miner.maxTimeToMineTxs = 500
        miner.addedTimeToMineTxs = 100

        const heightBefore = node.height
        startMinerLoop()

        // Wait for the loop to start
        await waitFor(() => miner.keepMining === true)

        // Inject a transaction into the mock node's mempool
        node.injectMempoolTx('txid_b1_001', '0200000000')

        // Wait for the miner to mine a block
        await waitFor(() => node.height > heightBefore, 3000)

        assert.strictEqual(node.height, heightBefore + 1)
        // Transaction was included in the block
        const lastBlock = node.blocks[node.blocks.length - 1]
        assert.ok(lastBlock.txids.includes('txid_b1_001'))
        // Mempool is now empty
        assert.strictEqual(node.mempool.length, 0)
    })

    // ─── B2: Multiple transactions — timer extension ────────────────

    it('B2: batches multiple transactions into one block', async function () {
        miner.maxTimeToMineTxs = 2000
        miner.addedTimeToMineTxs = 200

        const heightBefore = node.height
        startMinerLoop()
        await waitFor(() => miner.keepMining === true)

        // Send 3 transactions with gaps shorter than addedTimeToMineTxs
        node.injectMempoolTx('txid_b2_001')
        await sleep(50)
        node.injectMempoolTx('txid_b2_002')
        await sleep(50)
        node.injectMempoolTx('txid_b2_003')

        // Wait for mining
        await waitFor(() => node.height > heightBefore, 3000)

        // All 3 should be in the same block
        const lastBlock = node.blocks[node.blocks.length - 1]
        assert.ok(lastBlock.txids.includes('txid_b2_001'))
        assert.ok(lastBlock.txids.includes('txid_b2_002'))
        assert.ok(lastBlock.txids.includes('txid_b2_003'))
        assert.strictEqual(node.height, heightBefore + 1)
    })

    // ─── B3: Max timer forces mining despite new transactions ───────

    it('B3: max timer forces block generation despite continuous new txs', async function () {
        miner.maxTimeToMineTxs = 200
        miner.addedTimeToMineTxs = 150

        const heightBefore = node.height
        startMinerLoop()
        await waitFor(() => miner.keepMining === true)

        // Keep injecting transactions faster than addedTimeToMineTxs
        let txCount = 0
        const interval = setInterval(() => {
            txCount++
            node.injectMempoolTx('txid_b3_' + String(txCount).padStart(3, '0'))
        }, 30)

        // Wait for the max timer to force mining
        await waitFor(() => node.height > heightBefore, 3000)

        clearInterval(interval)

        // A block was mined even though new txs kept arriving
        assert.ok(node.height > heightBefore)
    })

    // ─── B4: Empty mempool — no unnecessary mining ──────────────────

    it('B4: does not mine when mempool is empty', async function () {
        const heightBefore = node.height
        startMinerLoop()
        await waitFor(() => miner.keepMining === true)

        // Wait several polling cycles — no mining should happen
        await sleep(300)

        assert.strictEqual(node.height, heightBefore)
        assert.strictEqual(node.callsFor('generatetoaddress').length, 0)
        // But mempool was polled (loop is alive)
        assert.ok(node.callsFor('getrawmempool').length > 0)
    })

    // ─── B5: Mining resumes after empty period ──────────────────────

    it('B5: mines correctly after an idle period', async function () {
        miner.maxTimeToMineTxs = 500
        miner.addedTimeToMineTxs = 100

        const heightBefore = node.height
        startMinerLoop()
        await waitFor(() => miner.keepMining === true)

        // Idle period
        await sleep(200)
        assert.strictEqual(node.height, heightBefore)

        // Now inject a transaction
        node.injectMempoolTx('txid_b5_001')

        // Should mine after timer
        await waitFor(() => node.height > heightBefore, 3000)
        assert.strictEqual(node.height, heightBefore + 1)
    })

    // ─── B6: Multiple mining cycles ─────────────────────────────────

    it('B6: handles multiple mining cycles with state resets', async function () {
        miner.maxTimeToMineTxs = 500
        miner.addedTimeToMineTxs = 80

        const heightBefore = node.height
        startMinerLoop()
        await waitFor(() => miner.keepMining === true)

        // Cycle 1
        node.injectMempoolTx('txid_b6_001')
        await waitFor(() => node.height >= heightBefore + 1, 3000)

        // Cycle 2
        node.injectMempoolTx('txid_b6_002')
        await waitFor(() => node.height >= heightBefore + 2, 3000)

        // Cycle 3
        node.injectMempoolTx('txid_b6_003')
        await waitFor(() => node.height >= heightBefore + 3, 3000)

        assert.strictEqual(node.height, heightBefore + 3)

        // Each block contains its respective transaction
        const blocksAdded = node.blocks.slice(-3)
        assert.ok(blocksAdded[0].txids.includes('txid_b6_001'))
        assert.ok(blocksAdded[1].txids.includes('txid_b6_002'))
        assert.ok(blocksAdded[2].txids.includes('txid_b6_003'))
    })
})
