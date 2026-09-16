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
const pipeline = require('./helpers/pipeline')

let node

pipeline.registerFile()

function createMiner() {
    return new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')
}

function registerChainStateTests() {
    // ═══════════════════════════════════════════════════════════════════
    // REG-T2-009: Chain State Progression
    // ═══════════════════════════════════════════════════════════════════
    describe('REG-T2-009: Chain state progresses correctly', function () {
        beforeEach(function () {
            node.reset()
        })

        it('blockchain height and balance increase after mining', async function () {
            const miner = createMiner()
            await miner.prepareWallet()

            const heightAfterSetup = node.height
            assert.strictEqual(heightAfterSetup, 101)

            // Mine additional blocks
            await miner.generateBlocks(10)
            assert.strictEqual(node.height, 111)

            // Balance should have increased
            const balance = await miner.connector.getBalance()
            assert.ok(balance > 0)
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

    registerChainStateTests()
})
