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
 * T2 Regression Tests: Full Regression (E2E)
 *
 * End-to-end regression tests against a StatefulMockNode that simulates
 * a real Bitcoin Core regtest node. Validates the complete pipeline:
 * wallet lifecycle, mempool monitoring, block generation, and API
 * interactions with real (but fast) async behavior.
 *
 * Target runtime: < 10 minutes
 * Trigger: nightly; before releases; after dependency upgrades
 */

const assert = require('assert')
const XChainRegtestMiner = require('../../../src/XChainRegtestMiner')
const waitUntil = require('../../helpers/waitUntil')
const pipeline = require('./helpers/pipeline')

let node

pipeline.registerFile()

function createMiner() {
    return new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')
}

// Deliberate delay only. Every wait-for-a-condition in this file goes through
// waitUntil, which rejects on timeout; this timer is reserved for the sites
// where the elapsed wall time IS the thing under test.
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function registerPauseAndResumeTests() {
    // ═══════════════════════════════════════════════════════════════════
    // REG-T2-005: Mining Loop, Pause/Resume via keepMining
    // ═══════════════════════════════════════════════════════════════════
    describe('REG-T2-005: Mining loop, pause and resume', function () {
        let miner, startPromise
        beforeEach(function () {
            node.reset()
            node._rpc_createwallet(['xchain_regtest_wallet'])
            node._rpc_generatetoaddress([110, 'bcrt1qseed'])
            node.calls = []
            miner = createMiner()
            miner.maxTimeToMineTxs = 100
            miner.addedTimeToMineTxs = 50
            const originalSleep = miner.sleep.bind(miner)
            miner.sleep = async (ms) => {
                if (miner._shutdown) throw new Error('__E2E_SHUTDOWN__')
                await originalSleep(10)
            }
        })
        afterEach(async function () {
            miner._shutdown = true
            if (startPromise) {
                try { await startPromise } catch (e) {
                    if (e.message !== '__E2E_SHUTDOWN__') throw e
                }
            }
            if (miner && miner._sigTermHandler) {
                process.removeListener('SIGTERM', miner._sigTermHandler)
            }
        })
        it('pauses mining and resumes with continueMining', async function () {
            startPromise = miner.start().catch(e => {
                if (e.message !== '__E2E_SHUTDOWN__') throw e
            })
            await waitUntil(() => miner.keepMining, 3000, 'the mining loop to start')
            // Pause mining
            miner.keepMining = false
            const heightBefore = node.height
            node.injectMempoolTx('txid_pause_001')
            // Deliberate delay, NOT a synchronization wait: kept as a timer on purpose.
            // A paused loop skips the whole polling block (XChainRegtestMiner.start,
            // the `if (this.keepMining)` gate), so the node observes no RPC at all while
            // keepMining is false and there is no post-condition to poll for. The quiet
            // window itself is the claim, so the only honest witness is elapsed time.
            await sleep(300)
            assert.strictEqual(node.height, heightBefore,
                'Should not mine while paused')
            // Resume mining
            await miner.continueMining()
            const mined = await waitUntil(
                () => node.height > heightBefore, 3000, 'the chain height to advance')
            assert.ok(mined, 'Should mine after resuming')
        })
    })
}

describe('T2 Regression: Full E2E Pipeline', function () {
    before(async function () {
        node = await pipeline.start()
    })
    after(async function () {
        await pipeline.finish()
    })
    registerPauseAndResumeTests()
})
