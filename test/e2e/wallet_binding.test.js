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
 * E2E Tests: the miner binds to its own named wallet
 *
 * Drives prepareWallet over HTTP against the stateful mock node when the
 * base-URL probe succeeds, and checks the connector ends up pinned to the
 * miner's own /wallet/<name> URI so a later node restart self-heals.
 */

const assert = require('assert')
const axios = require('axios')
const sinon = require('sinon')
const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
const StatefulMockNode = require('./helpers/StatefulMockNode')

const OURS = 'xchain_regtest_wallet'
const DEST = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'
const WALLET_RPCS = ['getwalletinfo', 'getnewaddress', 'getbalance', 'settxfee', 'sendtoaddress']

async function withNode(daemon, fn) {
    const node = new StatefulMockNode({ daemon })
    await node.start()
    try {
        return await fn(node)
    } finally {
        await node.stop()
    }
}

async function rpc(node, method, params) {
    const res = await axios.post(`http://127.0.0.1:${node.port}/`, { jsonrpc: '2.0', method, params, id: 1 })
    return res.data
}

// Loads and funds one wallet under `name` so the base-URL probe succeeds on it.
async function fundedNodeWith(node, name) {
    await rpc(node, 'createwallet', [name])
    await rpc(node, 'generatetoaddress', [110, DEST])
    node.calls = []
}

async function preparedMiner(network, node) {
    const miner = new XChainRegtestMiner(network, '127.0.0.1', String(node.port), 'user', 'pass')
    sinon.stub(miner, 'sleep').resolves()
    await miner.prepareWallet()
    return miner
}

// Sends one base-URL RPC and returns the reply whatever its HTTP status.
async function rpcReply(node, method, params) {
    const res = await axios.post(`http://127.0.0.1:${node.port}/`, { jsonrpc: '2.0', method, params, id: 1 },
        { validateStatus: () => true })
    return res.data
}

// Asserts the real daemon path: loadwallet finds no wallet of ours, the miner
// creates it beside the foreign one, and every later wallet RPC is pinned to it.
function assertCreatedBesideForeign(node, miner) {
    assert.deepStrictEqual(node.callsFor('loadwallet').map(c => c.params[0]), [OURS])
    assert.deepStrictEqual(node.callsFor('createwallet').map(c => c.params[0]), [OURS])
    assert.deepStrictEqual(node.loadedWallets().sort(), ['cosigner_test', OURS])
    assert.ok(miner.connector.walletUrl.endsWith('/wallet/' + OURS))
    const created = node.calls.findIndex(c => c.method === 'createwallet')
    const later = node.calls.slice(created + 1).filter(c => WALLET_RPCS.includes(c.method))
    assert.ok(later.length > 0, 'the miner must make wallet calls after creating its wallet')
    for (const call of later) assert.strictEqual(call.wallet, OURS, `${call.method} must target our wallet`)
}

// Balances are node-wide in the double, so the funded case asserts no warmup.
async function testForeignWalletRebind() {
    await withNode('legacy', async node => {
        await fundedNodeWith(node, 'cosigner_test')
        const miner = await preparedMiner('litecoin-regtest', node)

        assertCreatedBesideForeign(node, miner)
        assert.notStrictEqual(miner.walletAddress, node.addresses[0], 'the foreign wallet address must be discarded')
        const reply = await rpcReply(node, 'getwalletinfo', [])
        assert.strictEqual(reply.error && reply.error.code, -19, 'a base-URL wallet call is ambiguous with two wallets loaded')
    })
}

async function testUnfundedForeignWalletRebind() {
    await withNode('legacy', async node => {
        await rpc(node, 'createwallet', ['cosigner_test'])
        node.calls = []
        const miner = await preparedMiner('litecoin-regtest', node)

        assertCreatedBesideForeign(node, miner)
        assert.deepStrictEqual(node.callsFor('generatetoaddress').map(c => c.params), [[101, miner.walletAddress]])
        assert.ok(miner.balance > 0, 'the warmup must fund our pinned wallet')
        assert.strictEqual(miner.walletReady, true)
    })
}

async function testBaseUrlRestartRecovery(daemon, network) {
    await withNode(daemon, async node => {
        await fundedNodeWith(node, OURS)
        const miner = await preparedMiner(network, node)
        assert.ok(miner.connector.walletUrl.endsWith('/wallet/' + OURS), 'a probed own wallet must be pinned')
        assert.strictEqual(node.callsFor('loadwallet').length, 0)
        node.calls = []

        node.unloadWallet()
        const txid = await miner.sendFundsToAddress(DEST, 1.0)
        assert.ok(node.mempool.some(m => m.txid === txid))
        assert.strictEqual(node.callsFor('sendtoaddress').length, 2)
        assert.strictEqual(node.callsFor('loadwallet').length, 1)
    })
}

describe('E2E: wallet binding after a successful probe', function () {
    beforeEach(function () {
        sinon.stub(console, 'log')
        sinon.stub(console, 'warn')
        sinon.stub(console, 'error')
    })

    afterEach(function () {
        sinon.restore()
    })

    it('loads and pins its own wallet when only a foreign wallet is loaded', testForeignWalletRebind)
    it('creates, pins and matures its own wallet when only an unfunded foreign wallet is loaded', testUnfundedForeignWalletRebind)
    it('reloads a wallet lost to a restart after a probed start (HTTP 500 daemon)', async function () {
        await testBaseUrlRestartRecovery('legacy', 'litecoin-regtest')
    })
    it('reloads a wallet lost to a restart after a probed start (HTTP 200 daemon)', async function () {
        await testBaseUrlRestartRecovery('core31', 'bitcoin-regtest')
    })
})
