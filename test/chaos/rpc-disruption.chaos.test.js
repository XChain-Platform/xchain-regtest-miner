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
 * Chaos Tests — CE-01, CE-02, CE-03: RPC Disruption
 *
 * CE-01: Mining loop survives complete RPC outage and resumes after recovery.
 * CE-02: Timeout on generatetoaddress does not crash the loop.
 * CE-03: 50% random RPC failure rate — mining still completes.
 */

const assert = require('assert')
const sinon = require('sinon')
const ChaosNode = require('./helpers/ChaosNode')
const { createMiner, seedWallet, startMinerLoop, stopMinerLoop, waitFor, sleep } = require('./helpers/chaosSetup')

describe('Chaos: RPC Disruption', function () {
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

    // ─── CE-01: RPC Connection Loss ─────────────────────────────────

    describe('CE-01: RPC Connection Loss', function () {

        it('CE-01a: mining loop survives RPC outage and resumes after recovery', async function () {
            const miner = createMiner(node)
            miner.maxTimeToMineTxs = 300
            miner.addedTimeToMineTxs = 80

            const { startPromise } = startMinerLoop(miner)
            await waitFor(() => miner.keepMining === true)

            // Establish baseline: mine one block
            const heightBefore = node.height
            node.injectMempoolTx('txid_baseline_001')
            await waitFor(() => node.height > heightBefore, 3000)
            const heightAfterBaseline = node.height

            // Take node offline
            node.goOffline()

            // Let several poll cycles fail
            await sleep(200)

            // Loop should still be running despite errors
            assert.strictEqual(miner.keepMining, true, 'Mining loop should still be active during outage')

            // No new blocks during outage
            assert.strictEqual(node.height, heightAfterBaseline,
                'No blocks should be mined while node is offline')

            // Bring node back online and inject a transaction
            node.goOnline()
            node.injectMempoolTx('txid_recovery_001')

            // Miner should recover and mine
            await waitFor(() => node.height > heightAfterBaseline, 3000)

            assert.ok(node.height > heightAfterBaseline,
                'Miner should mine after recovery')

            // Verify the recovery transaction was included
            const lastBlock = node.blocks[node.blocks.length - 1]
            assert.ok(lastBlock.txids.includes('txid_recovery_001'),
                'Recovery transaction should be in the mined block')

            await stopMinerLoop(miner, startPromise)
        })

        it('CE-01b: miner does not crash during extended outage', async function () {
            const miner = createMiner(node)

            const { startPromise } = startMinerLoop(miner)
            await waitFor(() => miner.keepMining === true)

            // Extended offline period
            node.goOffline()
            await sleep(500)

            // Process still alive
            assert.strictEqual(miner.keepMining, true)

            node.goOnline()
            await stopMinerLoop(miner, startPromise)
        })
    })

    // ─── CE-02: RPC Timeout During Block Generation ─────────────────

    describe('CE-02: RPC Timeout on generatetoaddress', function () {

        it('CE-02: timeout error does not crash loop; mining resumes after recovery', async function () {
            const miner = createMiner(node)
            miner.maxTimeToMineTxs = 300
            miner.addedTimeToMineTxs = 80

            const { startPromise } = startMinerLoop(miner)
            await waitFor(() => miner.keepMining === true)

            const heightBefore = node.height

            // Stub generateToAddress to throw a timeout error once
            let timeoutFired = false
            const originalGenerate = miner.connector.generateToAddress.bind(miner.connector)
            sinon.stub(miner.connector, 'generateToAddress').callsFake(async (count, address) => {
                if (!timeoutFired) {
                    timeoutFired = true
                    const err = new Error('timeout of 60000ms exceeded')
                    err.code = 'ECONNABORTED'
                    throw err
                }
                // Restore real behavior for subsequent calls
                return originalGenerate(count, address)
            })

            // Inject a transaction to trigger mining
            node.injectMempoolTx('txid_ce02_001')

            // Wait for the timeout error to fire, then for successful mining
            await waitFor(() => timeoutFired, 2000)

            // The stub will succeed on the next attempt (or the loop will retry
            // on the next cycle when it sees mempool is still non-empty)
            await waitFor(() => node.height > heightBefore, 3000)

            assert.ok(node.height > heightBefore,
                'Mining should succeed after timeout recovery')
            assert.strictEqual(timeoutFired, true,
                'Timeout should have been triggered')

            // No duplicate blocks — height only increased by expected amount
            assert.ok(node.height <= heightBefore + 2,
                'Should not produce excessive duplicate blocks')

            miner.connector.generateToAddress.restore()
            await stopMinerLoop(miner, startPromise)
        })
    })

    // ─── CE-03: Intermittent RPC Flapping ───────────��───────────────

    describe('CE-03: 50% RPC Flapping', function () {

        it('CE-03: timer logic remains valid under 50% random failure rate', async function () {
            const miner = createMiner(node)
            miner.maxTimeToMineTxs = 800
            miner.addedTimeToMineTxs = 200

            const heightBefore = node.height

            // Inject transactions before starting the loop
            for (let i = 0; i < 5; i++) {
                node.injectMempoolTx('txid_ce03_' + String(i).padStart(3, '0'))
            }

            // Set 50% failure rate on mempool polling
            node.setFailRate('getrawmempool', 0.5)

            const { startPromise } = startMinerLoop(miner)
            await waitFor(() => miner.keepMining === true)

            // Wait for mining to complete despite failures
            await waitFor(() => node.height > heightBefore, 5000)

            // All transactions should eventually be mined
            assert.ok(node.height > heightBefore,
                'At least one block should be mined despite 50% failure rate')

            // Mempool should be empty after mining
            assert.strictEqual(node.mempool.length, 0,
                'All transactions should be included in mined blocks')

            // Multiple poll attempts occurred
            assert.ok(node.callsFor('getrawmempool').length > 5,
                'Multiple poll attempts should have occurred')

            // Loop never exited
            assert.strictEqual(miner.keepMining, true)

            node.clearFailRates()
            await stopMinerLoop(miner, startPromise)
        })

        it('CE-03b: mining resumes cleanly after flapping period ends', async function () {
            const miner = createMiner(node)
            miner.maxTimeToMineTxs = 300
            miner.addedTimeToMineTxs = 80

            const { startPromise } = startMinerLoop(miner)
            await waitFor(() => miner.keepMining === true)

            // Flapping period
            node.setFailRate('getrawmempool', 0.7)
            await sleep(200)
            node.clearFailRates()

            // Normal operation after flapping
            const heightBefore = node.height
            node.injectMempoolTx('txid_ce03b_001')
            await waitFor(() => node.height > heightBefore, 3000)

            assert.ok(node.height > heightBefore,
                'Mining should work normally after flapping period ends')

            await stopMinerLoop(miner, startPromise)
        })
    })
})
