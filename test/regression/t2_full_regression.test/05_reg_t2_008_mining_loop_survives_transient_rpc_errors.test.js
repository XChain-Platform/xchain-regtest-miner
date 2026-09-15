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

// ═══════════════════════════════════════════════════════════════════
// REG-T2-008: Error Resilience, Mining loop survives RPC errors
// ═══════════════════════════════════════════════════════════════════
function registerRpcResilienceTests() {
    describe('REG-T2-008: Mining loop survives transient RPC errors', function () {
        let miner, startPromise
        beforeEach(function () {
            node.reset()
            node._rpc_createwallet(['xchain_regtest_wallet'])
            node._rpc_generatetoaddress([110, 'bcrt1qseed'])
            node.calls = []
            miner = createMiner()
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
        it('recovers from transient RPC errors and mines', async function () {
            startPromise = miner.start().catch(e => {
                if (e.message !== '__E2E_SHUTDOWN__') throw e
            })
            await waitUntil(() => miner.keepMining, 3000, 'the mining loop to start')
            // Inject RPC errors
            const realHandler = node._rpc_getrawmempool.bind(node)
            let errorCount = 0
            node._rpc_getrawmempool = function () {
                errorCount++
                if (errorCount <= 3) {
                    const err = new Error('Connection lost')
                    err.rpcCode = -1
                    throw err
                }
                return realHandler()
            }
            // Wait for the injected errors to actually be delivered. errorCount is
            // the real post-condition; a fixed settle only assumed the loop had
            // polled three times by then, which is a bet on venue speed.
            await waitUntil(
                () => errorCount >= 3, 3000, 'all three injected RPC errors to be delivered')
            // Restore and inject a transaction
            node._rpc_getrawmempool = realHandler
            miner.maxTimeToMineTxs = 300
            miner.addedTimeToMineTxs = 80
            const heightBefore = node.height
            node.injectMempoolTx('txid_resilience_001')
            const mined = await waitUntil(
                () => node.height > heightBefore, 3000, 'the chain height to advance')
            assert.ok(mined, 'Miner should recover from RPC errors and mine')
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
    registerRpcResilienceTests()
})
