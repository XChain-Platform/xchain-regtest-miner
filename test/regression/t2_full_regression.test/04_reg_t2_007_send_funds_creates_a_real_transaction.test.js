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

function registerSendFundsTests() {
    // ═══════════════════════════════════════════════════════════════════
    // REG-T2-007: send_funds via Connector
    // ═══════════════════════════════════════════════════════════════════
    describe('REG-T2-007: send_funds creates a real transaction', function () {
        beforeEach(function () {
            node.reset()
            node._rpc_createwallet(['xchain_regtest_wallet'])
            node._rpc_generatetoaddress([110, 'bcrt1qseed'])
            node.calls = []
        })

        it('send_funds produces a transaction in the mempool', async function () {
            const miner = createMiner()
            await miner.prepareWallet()

            const address = await miner.connector.getNewAddress()
            const txid = await miner.sendFundsToAddress(address, 1.0)

            assert.ok(txid, 'Should return a txid')
            assert.ok(node.mempool.length > 0, 'Transaction should be in mempool')
            assert.ok(node.mempool.some(m => m.txid === txid),
                'The specific txid should be in the mempool')
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

    registerSendFundsTests()
})
