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

function registerShutdownTests() {
    // ═══════════════════════════════════════════════════════════════════
    // REG-T2-010: SIGTERM Graceful Shutdown
    // ═══════════════════════════════════════════════════════════════════
    describe('REG-T2-010: Graceful shutdown via _shutdown flag', function () {
        beforeEach(function () {
            node.reset()
            node._rpc_createwallet(['xchain_regtest_wallet'])
            node._rpc_generatetoaddress([110, 'bcrt1qseed'])
            node.calls = []
        })

        it('mining loop exits when _shutdown is set', async function () {
            const miner = createMiner()

            const originalSleep = miner.sleep.bind(miner)
            miner.sleep = async (ms) => {
                if (miner._shutdown) throw new Error('__E2E_SHUTDOWN__')
                await originalSleep(10)
            }

            const startPromise = miner.start().catch(e => {
                if (e.message !== '__E2E_SHUTDOWN__') throw e
            })
            await waitUntil(() => miner.keepMining, 3000, 'the mining loop to start')

            miner._shutdown = true

            // Should exit within a short time.
            // The timer is the losing arm of a race, not a synchronization wait: it is
            // already a reachable deadline that throws a named error, which is exactly
            // what waitUntil would supply. Routing it through the helper would rebuild
            // the same mechanism around a flag set by startPromise, so it stays.
            await Promise.race([
                startPromise,
                sleep(2000).then(() => { throw new Error('Loop did not exit in time') }),
            ])

            if (miner._sigTermHandler) {
                process.removeListener('SIGTERM', miner._sigTermHandler)
            }
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

    registerShutdownTests()
})
