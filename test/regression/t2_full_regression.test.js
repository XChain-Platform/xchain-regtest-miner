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
const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
const pipeline = require('./t2_full_regression.test/helpers/pipeline')

let node

pipeline.registerFile()

function createMiner() {
    return new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')
}

function registerFreshWalletTests() {
    // ═══════════════════════════════════════════════════════════════════
    // REG-T2-001: Wallet Lifecycle, Fresh Start
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T2-001: Wallet lifecycle, fresh start', function () {
        beforeEach(function () {
            node.reset()
        })

        it('creates wallet and mines 101 blocks on fresh node', async function () {
            const miner = createMiner()
            await miner.prepareWallet()

            assert.strictEqual(node.wallet.exists, true)
            assert.strictEqual(node.wallet.loaded, true)
            assert.strictEqual(node.wallet.name, 'xchain_regtest_wallet')
            assert.strictEqual(node.height, 101)
            assert.strictEqual(node.callsFor('createwallet').length, 1)
            assert.deepStrictEqual(node.callsFor('generatetoaddress')[0].params[0], 101)
            assert.ok(miner.walletAddress)
            assert.ok(miner.walletAddress.startsWith('bcrt'))

            const balance = await miner.connector.getBalance()
            assert.ok(balance > 0)
        })
    })
}

function registerLoadedWalletTests() {
    // ═══════════════════════════════════════════════════════════════════
    // REG-T2-002: Wallet Lifecycle, Restart (already loaded)
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T2-002: Wallet lifecycle, restart', function () {
        beforeEach(function () {
            node.reset()
            node._rpc_createwallet(['xchain_regtest_wallet'])
            node._rpc_generatetoaddress([110, 'bcrt1qseed'])
            node.calls = []
        })

        it('skips creation when wallet is already loaded', async function () {
            const heightBefore = node.height
            const miner = createMiner()
            await miner.prepareWallet()

            assert.strictEqual(node.callsFor('createwallet').length, 0)
            assert.strictEqual(node.callsFor('loadwallet').length, 0)
            assert.strictEqual(node.height, heightBefore)
            assert.strictEqual(node.callsFor('generatetoaddress').length, 0)
            assert.ok(miner.walletAddress)
        })
    })
}

function registerUnloadedWalletTests() {
    // ═══════════════════════════════════════════════════════════════════
    // REG-T2-003: Wallet Lifecycle, Exists but unloaded
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T2-003: Wallet lifecycle, exists but unloaded', function () {
        beforeEach(function () {
            node.reset()
            node.wallet = { exists: true, loaded: false, name: 'xchain_regtest_wallet' }
            // Seed blocks and balance
            for (let i = 0; i < 110; i++) {
                node.height++
                node.pendingRewards.push({ height: node.height, amount: 5000000000 })
                node.blocks.push({ hash: node._generateHash(), height: node.height, txids: [], previousHash: '00' })
            }
            node._matureCoinbases()
            node.calls = []
        })

        it('loads wallet without creating it', async function () {
            const miner = createMiner()
            await miner.prepareWallet()

            assert.strictEqual(node.callsFor('loadwallet').length, 1)
            assert.strictEqual(node.callsFor('createwallet').length, 0)
            assert.ok(miner.walletAddress)
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

    registerFreshWalletTests()
    registerLoadedWalletTests()
    registerUnloadedWalletTests()
})
