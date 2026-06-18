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
 * E2E Tests: Category F: Chain State Consistency
 *
 * Validates that the miner produces valid chain extensions,
 * wallet balance tracks correctly, and concurrent operations
 * don't corrupt state.
 */

const assert = require('assert')
const sinon = require('sinon')
const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
const StatefulMockNode = require('./helpers/StatefulMockNode')

describe('E2E: Chain State Consistency', function () {
    let node

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

    async function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    // ─── F1: Mined blocks form a valid chain ────────────────────────

    it('F1: each mined block references the previous block hash', async function () {
        node.reset()
        node._rpc_createwallet(['xchain_regtest_wallet'])
        node._rpc_generatetoaddress([110, 'bcrt1qseed'])
        node.calls = []

        const miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')
        miner.walletAddress = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'

        // Record the current best block hash
        const infoBefore = await miner.connector.getBlockchainInfo()
        const previousHash = infoBefore.bestblockhash

        // Mine a block (generateBlocks does not return hashes)
        await miner.generateBlocks(1)

        // Get the new block hash via the connector
        const infoAfter = await miner.connector.getBlockchainInfo()
        const newBlockHash = infoAfter.bestblockhash
        const blockData = await miner.connector.getBlock(newBlockHash, false)

        // New block should reference the previous best block
        assert.strictEqual(blockData.previousblockhash, previousHash)
        assert.strictEqual(blockData.height, infoBefore.blocks + 1)

        // Mine another block
        await miner.generateBlocks(1)
        const infoAfter2 = await miner.connector.getBlockchainInfo()
        const blockData2 = await miner.connector.getBlock(infoAfter2.bestblockhash, false)

        // Second block references the first
        assert.strictEqual(blockData2.previousblockhash, newBlockHash)
    })

    // ─── F2: Wallet balance increases with mining ───────────────────

    it('F2: wallet balance reflects mining rewards after maturity', async function () {
        node.reset()
        node._rpc_createwallet(['xchain_regtest_wallet'])
        node.calls = []

        const miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')

        // Initially no balance
        let balance = await miner.connector.getBalance()
        assert.strictEqual(balance, 0)

        // Mine 50 blocks (none are mature yet)
        miner.walletAddress = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'
        await miner.generateBlocks(50)
        balance = await miner.connector.getBalance()
        assert.strictEqual(balance, 0) // None mature (need 100 confirmations)

        // Mine 51 more blocks (first block is now mature)
        await miner.generateBlocks(51)
        balance = await miner.connector.getBalance()
        assert.ok(balance > 0, 'Expected positive balance after 101 blocks')
        assert.strictEqual(balance, 50) // First block's 50 BTC is now mature
    })

    // ─── F3: Transactions are included in mined blocks ──────────────

    it('F3: mempool transactions appear in mined blocks', async function () {
        node.reset()
        node._rpc_createwallet(['xchain_regtest_wallet'])
        node._rpc_generatetoaddress([110, 'bcrt1qseed'])
        node.calls = []

        const miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')
        miner.walletAddress = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'

        // Inject transactions into the mempool
        node.injectMempoolTx('txid_f3_001')
        node.injectMempoolTx('txid_f3_002')
        node.injectMempoolTx('txid_f3_003')

        assert.strictEqual(node.mempool.length, 3)

        // Mine a block
        await miner.generateBlocks(1)

        // Mempool should be empty
        assert.strictEqual(node.mempool.length, 0)

        // Block should contain all 3 transactions
        const info = await miner.connector.getBlockchainInfo()
        const blockData = await miner.connector.getBlock(info.bestblockhash, false)
        assert.ok(blockData.tx.includes('txid_f3_001'))
        assert.ok(blockData.tx.includes('txid_f3_002'))
        assert.ok(blockData.tx.includes('txid_f3_003'))
    })

    // ─── F4: send_funds deducts from wallet balance ─────────────────

    it('F4: sendFundsToAddress reduces wallet balance', async function () {
        node.reset()
        node._rpc_createwallet(['xchain_regtest_wallet'])
        node._rpc_generatetoaddress([110, 'bcrt1qseed'])

        const miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')
        miner.walletAddress = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'

        const balanceBefore = await miner.connector.getBalance()
        assert.ok(balanceBefore > 0)

        // Send 1 BTC
        const txid = await miner.sendFundsToAddress('bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080', 1.0)
        assert.ok(typeof txid === 'string')

        const balanceAfter = await miner.connector.getBalance()
        assert.ok(balanceAfter < balanceBefore, 'Balance should decrease after send')
        assert.strictEqual(balanceBefore - balanceAfter, 1)
    })

    // ─── F5: Multiple generateBlocks calls maintain chain continuity ─

    it('F5: sequential block generation maintains ascending heights', async function () {
        node.reset()
        node._rpc_createwallet(['xchain_regtest_wallet'])
        node.calls = []

        const miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')
        miner.walletAddress = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'

        await miner.generateBlocks(5)
        assert.strictEqual(node.height, 5)

        await miner.generateBlocks(3)
        assert.strictEqual(node.height, 8)

        await miner.generateBlocks(1)
        assert.strictEqual(node.height, 9)

        // Verify ascending, connected chain
        for (let i = 1; i < node.blocks.length; i++) {
            assert.strictEqual(node.blocks[i].height, node.blocks[i - 1].height + 1)
            assert.strictEqual(node.blocks[i].previousHash, node.blocks[i - 1].hash)
        }
    })
})
