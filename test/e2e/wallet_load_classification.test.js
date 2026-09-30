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
 * E2E Tests: loadwallet failures are classified, never answered by createwallet
 *
 * Drives the real connector over HTTP against the stateful mock node, in both
 * daemon error transports, for a wallet the node already has loaded.
 */

const assert = require('assert')
const axios = require('axios')
const sinon = require('sinon')
const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
const StatefulMockNode = require('./helpers/StatefulMockNode')

const OURS = 'xchain_regtest_wallet'
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

async function rpc(node, method, params) {
    const res = await axios.post(`http://127.0.0.1:${node.port}/`, { jsonrpc: '2.0', method, params, id: 1 })
    return res.data
}

function minerOn(node) {
    const miner = new XChainRegtestMiner('bitcoin-regtest', '127.0.0.1', String(node.port), 'user', 'pass')
    sinon.stub(miner, 'sleep').resolves()
    sinon.stub(miner.connector, 'sleep').resolves()
    return miner
}

async function testAlreadyLoadedIsLoaded(daemon) {
    await withNode(daemon, async node => {
        await rpc(node, 'createwallet', [OURS])
        node.calls = []
        const miner = minerOn(node)

        await miner.ensureWalletLoaded()

        assert.strictEqual(node.callsFor('loadwallet').length, 1)
        assert.strictEqual(node.callsFor('createwallet').length, 0, 'an already-loaded wallet must never be created')
        assert.ok(miner.connector.walletUrl.endsWith('/wallet/' + OURS))
    })
}

async function testCreateOverExistingStopsAtOnce(daemon) {
    await withNode(daemon, async node => {
        await rpc(node, 'createwallet', [OURS])
        node.calls = []
        const miner = minerOn(node)

        await assert.rejects(
            () => miner.connector.createWallet(OURS),
            err => err.message === 'Error creating wallet' && err.rpcCode === -4
        )
        assert.strictEqual(node.callsFor('createwallet').length, 1, 'a deterministic refusal must not be retried 50 times')
        assert(miner.connector.sleep.notCalled)
    })
}

async function testSelfHealWithConcurrentReload(daemon) {
    await withNode(daemon, async node => {
        await rpc(node, 'createwallet', [OURS])
        await rpc(node, 'generatetoaddress', [110, DEST])
        const miner = minerOn(node)
        await miner.ensureWalletLoaded()
        node.calls = []

        // Another caller reloaded the wallet between our failed send and our reload.
        const send = miner.connector.sendToAddress.bind(miner.connector)
        let first = true
        sinon.stub(miner.connector, 'sendToAddress').callsFake(async (...args) => {
            if (first) {
                first = false
                const err = new Error('Error sending funds to address')
                err.walletMissing = true
                throw err
            }
            return send(...args)
        })

        const txid = await miner.sendFundsToAddress(DEST, 1.0)
        assert.ok(node.mempool.some(m => m.txid === txid))
        assert.strictEqual(node.callsFor('loadwallet').length, 1)
        assert.strictEqual(node.callsFor('createwallet').length, 0)
    })
}

describe('E2E: loadwallet failure classification', function () {
    beforeEach(function () {
        sinon.stub(console, 'log')
        sinon.stub(console, 'warn')
        sinon.stub(console, 'error')
    })

    afterEach(function () {
        sinon.restore()
    })

    for (const daemon of ['legacy', 'core31']) {
        describe(`${daemon} daemon`, function () {
            it('treats loadwallet "already loaded" as loaded and never calls createwallet', () => testAlreadyLoadedIsLoaded(daemon))
            it('stops createwallet after one "Database already exists" answer', () => testCreateOverExistingStopsAtOnce(daemon))
            it('survives a send-time reload that finds the wallet already loaded', () => testSelfHealWithConcurrentReload(daemon))
        })
    }
})
