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
 * Chaos Tests — CE-06: fillMempool Interruption
 *
 * Tests miner state recovery when fillMempool is interrupted by node failure.
 * Documents W-3: keepMining stuck at false after fillMempool failure.
 */

const assert = require('assert')
const sinon = require('sinon')
const ChaosNode = require('./helpers/ChaosNode')
const { createMiner, seedWallet, startMinerLoop, stopMinerLoop, waitFor, sleep } = require('./helpers/chaosSetup')

describe('Chaos: fillMempool Interruption (CE-06)', function () {
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
        // Seed wallet with lots of balance for fillMempool
        node._rpc_createwallet(['xchain_regtest_wallet'])
        node._rpc_generatetoaddress([200, 'bcrt1qseed'])
        node.calls = []
    })

    // ─── CE-06a: fillMempoolRunning resets after failure ────────────

    it('CE-06a: fillMempoolRunning resets to false after node failure mid-fillMempool', async function () {
        const miner = createMiner(node)
        miner.walletAddress = 'bcrt1qseed'

        // Stub connector.sleep for fast retries during fillMempool
        sinon.stub(miner.connector, 'sleep').resolves()

        assert.strictEqual(miner.fillMempoolRunning, false)

        // Start fillMempool — it will try to send funds, which needs a real wallet interaction
        const fillPromise = miner.fillMempool(3).catch(e => e)

        // Let it get into the send loop
        await sleep(50)

        // Kill the node mid-operation
        node.goOffline()

        // Wait for fillMempool to exhaust retries and fail
        const result = await fillPromise

        // The finally block should have reset fillMempoolRunning
        assert.strictEqual(miner.fillMempoolRunning, false,
            'fillMempoolRunning should be reset to false by the finally block')

        // Clean up
        node.goOnline()
        sinon.restore()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    // ─── CE-06b: keepMining stuck at false (W-3) ────────────────────

    it('CE-06b: keepMining is restored to true after fillMempool fails — W-3 fixed', async function () {
        const miner = createMiner(node)
        miner.walletAddress = 'bcrt1qseed'

        // Stub connector.sleep for fast retries
        sinon.stub(miner.connector, 'sleep').resolves()

        // Initially keepMining is false (not started yet), set it to true
        // to simulate a running miner
        miner.keepMining = true

        // fillMempool sets keepMining = false at line 90
        const fillPromise = miner.fillMempool(3).catch(e => e)

        // Immediately verify keepMining was set to false
        assert.strictEqual(miner.keepMining, false,
            'fillMempool should set keepMining to false on entry')

        // Let it start, then kill the node
        await sleep(50)
        node.goOffline()

        // Wait for failure
        await fillPromise

        // W-3 FIXED: the finally block now restores keepMining to true
        assert.strictEqual(miner.keepMining, true,
            'W-3 fixed: keepMining should be restored to true by the finally block')

        // Clean up
        node.goOnline()
        sinon.restore()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    // ─── CE-06c: continueMining restores mining after failure ───────

    it('CE-06c: mining works immediately after failed fillMempool — W-3 fixed', async function () {
        const miner = createMiner(node)
        miner.walletAddress = 'bcrt1qseed'

        // Stub connector.sleep for fast retries
        sinon.stub(miner.connector, 'sleep').resolves()

        miner.keepMining = true

        // Trigger fillMempool then kill node
        const fillPromise = miner.fillMempool(3).catch(e => e)
        await sleep(50)
        node.goOffline()
        await fillPromise

        // W-3 fixed: keepMining is restored by the finally block
        assert.strictEqual(miner.keepMining, true,
            'keepMining should be restored to true by the finally block')

        // Restore node
        node.goOnline()

        // Restore connector.sleep stub for the mining loop
        sinon.restore()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')

        // Verify mining works by starting the loop and injecting a tx
        const heightBefore = node.height
        miner.maxTimeToMineTxs = 300
        miner.addedTimeToMineTxs = 80

        // Re-apply fast sleep for the mining loop
        const originalSleep = miner.sleep.bind(miner)
        miner.sleep = async (ms) => {
            if (miner._shutdown) throw new Error('__E2E_SHUTDOWN__')
            await originalSleep(10)
        }

        const { startPromise } = startMinerLoop(miner)

        await waitFor(() => miner.keepMining === true)
        node.injectMempoolTx('txid_ce06c_001')

        await waitFor(() => node.height > heightBefore, 3000)

        assert.ok(node.height > heightBefore,
            'Mining should resume after continueMining() call')

        await stopMinerLoop(miner, startPromise)
    })
})
