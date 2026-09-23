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
 * E2E Tests: Funding fee pin and the sendtoaddress wire contract
 *
 * Drives both fee-pin mechanisms (per-call fee_rate on Bitcoin Core 31,
 * wallet-wide settxfee on the legacy daemons) over HTTP against the
 * stateful mock node, and pins the mock's own RPC answers to the daemon
 * shapes they stand in for so the double cannot drift from them.
 */

const assert = require('assert')
const axios = require('axios')
const sinon = require('sinon')
const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
const { FUNDING_FEE_RATE_SAT_PER_VB, FUNDING_FEE_RATE_COINS_PER_KB } = require('../../src/XChainRegtestMiner/constants')
const StatefulMockNode = require('./helpers/StatefulMockNode')

const DEST = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'

async function withNode(daemon, fn) {
    const node = new StatefulMockNode({ daemon })
    await node.start()
    try {
        return await fn(node)
    } finally {
        await node.stop()
    }
}

function createMiner(network, node) {
    return new XChainRegtestMiner(network, '127.0.0.1', String(node.port), 'user', 'pass')
}

async function rpc(node, method, params) {
    const res = await axios.post(`http://127.0.0.1:${node.port}/`, { jsonrpc: '2.0', method, params, id: 1 })
    return res.data
}

// Seeds a loaded, matured wallet so prepareWallet skips the fresh-node probe retries.
async function fundedNode(node) {
    await rpc(node, 'createwallet', ['xchain_regtest_wallet'])
    await rpc(node, 'generatetoaddress', [110, DEST])
    node.calls = []
}

describe('E2E: Funding fee pin per daemon', function () {
    beforeEach(function () {
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    afterEach(function () {
        sinon.restore()
    })

    it('pins BTC per call on Core 31 and never calls the deleted settxfee', async function () {
        await withNode('core31', async node => {
            await fundedNode(node)
            const miner = createMiner('bitcoin-regtest', node)
            await miner.prepareWallet()

            assert.strictEqual(node.callsFor('settxfee').length, 0)
            assert.strictEqual(miner.fundingFeeRateSatPerVb, FUNDING_FEE_RATE_SAT_PER_VB)

            const txid = await miner.sendFundsToAddress(DEST, 1.0)
            assert.strictEqual(typeof txid, 'string')
            assert.ok(node.mempool.some(m => m.txid === txid))
            assert.deepStrictEqual(node.callsFor('sendtoaddress')[0].params,
                { address: DEST, amount: 1.0, fee_rate: FUNDING_FEE_RATE_SAT_PER_VB })
        })
    })

    it('falls back to the per-call rate when a bare network meets a Core 31 node', async function () {
        await withNode('core31', async node => {
            await fundedNode(node)
            const miner = createMiner('regtest', node)
            await miner.prepareWallet()

            assert.strictEqual(node.callsFor('settxfee').length, 1)
            assert.strictEqual(miner.fundingFeeRateSatPerVb, FUNDING_FEE_RATE_SAT_PER_VB)

            const txid = await miner.sendFundsToAddress(DEST, 1.0)
            assert.strictEqual(typeof txid, 'string')
            assert.deepStrictEqual(node.callsFor('sendtoaddress')[0].params,
                { address: DEST, amount: 1.0, fee_rate: FUNDING_FEE_RATE_SAT_PER_VB })
        })
    })

    it('keeps the wallet-wide settxfee pin and positional sends on a legacy daemon', async function () {
        await withNode('legacy', async node => {
            await fundedNode(node)
            const miner = createMiner('litecoin-regtest', node)
            await miner.prepareWallet()

            assert.strictEqual(node.callsFor('settxfee').length, 1)
            assert.deepStrictEqual(node.callsFor('settxfee')[0].params, [FUNDING_FEE_RATE_COINS_PER_KB])
            assert.strictEqual(miner.fundingFeeRateSatPerVb, null)

            const txid = await miner.sendFundsToAddress(DEST, 1.0)
            assert.strictEqual(typeof txid, 'string')
            assert.ok(node.mempool.some(m => m.txid === txid))
            assert.deepStrictEqual(node.callsFor('sendtoaddress')[0].params, [DEST, 1.0])
        })
    })
})

describe('E2E: StatefulMockNode wire contract', function () {
    it('answers a positional sendtoaddress with a bare txid string', async function () {
        await withNode('legacy', async node => {
            await fundedNode(node)
            const body = await rpc(node, 'sendtoaddress', [DEST, 1.0])
            assert.strictEqual(body.error, null)
            assert.strictEqual(typeof body.result, 'string')
            assert.ok(body.result.length > 0)
        })
    })

    it('answers a named sendtoaddress without verbose with a bare txid string', async function () {
        await withNode('core31', async node => {
            await fundedNode(node)
            const body = await rpc(node, 'sendtoaddress', { address: DEST, amount: 1.0, fee_rate: 100 })
            assert.strictEqual(typeof body.result, 'string')
        })
    })

    it('answers the verbose object only when verbose is requested', async function () {
        await withNode('core31', async node => {
            await fundedNode(node)
            const body = await rpc(node, 'sendtoaddress', { address: DEST, amount: 1.0, verbose: true })
            assert.strictEqual(typeof body.result, 'object')
            assert.strictEqual(typeof body.result.txid, 'string')
        })
    })

    it('rejects settxfee as method-not-found and reports 31.0.0 in core31 mode', async function () {
        await withNode('core31', async node => {
            const fee = await rpc(node, 'settxfee', [0.001])
            assert.strictEqual(fee.result, null)
            assert.strictEqual(fee.error.code, -32601)

            const info = await rpc(node, 'getnetworkinfo', [])
            assert.ok(info.result.version >= 310000)
        })
    })

    it('honors settxfee in legacy mode', async function () {
        await withNode('legacy', async node => {
            const fee = await rpc(node, 'settxfee', [0.001])
            assert.strictEqual(fee.result, true)
            assert.strictEqual(fee.error, null)
        })
    })

    it('keeps the daemon mode across reset and refuses an unknown one', async function () {
        const node = new StatefulMockNode({ daemon: 'core31' })
        node.reset()
        assert.strictEqual(node.daemon, 'core31')
        assert.strictEqual(new StatefulMockNode().daemon, 'legacy')
        assert.throws(() => new StatefulMockNode({ daemon: 'core30' }), /Unknown daemon/)
    })
})
