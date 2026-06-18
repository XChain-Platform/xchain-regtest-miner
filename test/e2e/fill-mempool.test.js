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
 * E2E Tests: Category D: fillMempool with Real Broadcasting
 *
 * Validates the full PSBT construction and broadcasting pipeline:
 * BIP39 mnemonic → BIP32 key derivation → PSBT construction →
 * signing → sendRawTransaction, all against a stateful mock node
 * that accepts and stores the transactions.
 */

const assert = require('assert')
const sinon = require('sinon')
const bitcoin = require('bitcoinjs-lib')
const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
const StatefulMockNode = require('./helpers/StatefulMockNode')

describe('E2E: fillMempool with Real Broadcasting', function () {
    let node, miner

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

        // Pre-seed wallet with plenty of balance
        node._rpc_createwallet(['xchain_regtest_wallet'])
        node._rpc_generatetoaddress([200, 'bcrt1qseed'])
        node.calls = []

        miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')
        miner.walletAddress = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'

        // Fast sleep
        const originalSleep = miner.sleep.bind(miner)
        miner.sleep = async (ms) => await originalSleep(5)
    })

    // ─── D1: fillMempool(1): single transaction ────────────────────

    it('D1: fillMempool(1) broadcasts valid transactions to the node', async function () {
        this.timeout(15000)

        await miner.fillMempool(1)

        // keepMining should be restored to true by the finally block
        assert.strictEqual(miner.keepMining, true)

        // Stress transaction(s) should be in the mempool
        assert.ok(node.mempool.length >= 1, 'Expected at least 1 tx in mempool, got ' + node.mempool.length)

        // Every mempool transaction should be valid Bitcoin transaction hex
        for (const entry of node.mempool) {
            assert.doesNotThrow(() => {
                bitcoin.Transaction.fromHex(entry.hex)
            }, 'Mempool tx ' + entry.txid + ' is not valid Bitcoin transaction hex')
        }

        // sendRawTransaction was called (stress txs are broadcast raw)
        assert.ok(node.callsFor('sendrawtransaction').length >= 1)

        // Intermediate mining happened (funding + distribution confirmation)
        assert.ok(node.callsFor('generatetoaddress').length >= 1)
    })

    // ─── D2: fillMempool(3): multiple transactions ─────────────────

    it('D2: fillMempool(3) creates 3 distinct stress transactions', async function () {
        this.timeout(15000)

        await miner.fillMempool(3)

        assert.strictEqual(miner.keepMining, true)

        // Should have 3 stress txs in mempool
        assert.strictEqual(node.mempool.length, 3)

        // All txids should be unique
        const txids = node.mempool.map(m => m.txid)
        assert.strictEqual(new Set(txids).size, 3)

        // Each should be a valid transaction
        for (const entry of node.mempool) {
            const tx = bitcoin.Transaction.fromHex(entry.hex)
            // Each stress tx has 1 input and 1 output
            assert.strictEqual(tx.ins.length, 1)
            assert.strictEqual(tx.outs.length, 1)
            // Output value should be AMOUNT_FOR_EACH_ADDRESS (1000 sats)
            assert.strictEqual(tx.outs[0].value, 1000)
        }
    })

    // ─── D3: Funding and distribution transactions are valid ────────

    it('D3: intermediate funding and distribution txs are properly mined', async function () {
        this.timeout(15000)

        const heightBefore = node.height

        await miner.fillMempool(2)

        // Multiple blocks were mined during fillMempool
        // Phase 1: funding confirmation block(s)
        // Phase 2: distribution confirmation block
        const generateCalls = node.callsFor('generatetoaddress')
        assert.ok(generateCalls.length >= 2, 'Expected at least 2 generate calls, got ' + generateCalls.length)

        // sendToAddress was called for funding
        const sendCalls = node.callsFor('sendtoaddress')
        assert.ok(sendCalls.length >= 1)

        // getRawTransaction was called to find UTXOs from funding tx
        const rawTxCalls = node.callsFor('getrawtransaction')
        assert.ok(rawTxCalls.length >= 1)

        // Height increased from intermediate mining
        assert.ok(node.height > heightBefore)

        // Stress txs are in the mempool (not yet mined)
        assert.strictEqual(node.mempool.length, 2)
    })
})
