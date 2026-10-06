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
 * E2E Tests: the balance read reloads a wallet lost to a node restart
 *
 * Over HTTP against the stateful mock node, on both RPC error transports:
 * after the node drops the wallet, the miner's own balance refresh reloads
 * it and the next refresh reads a funded wallet again, with no send needed.
 */

const assert = require('assert')
const axios = require('axios')
const sinon = require('sinon')
const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
const StatefulMockNode = require('./helpers/StatefulMockNode')

const DEST = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'

async function rpc(node, method, params) {
    const res = await axios.post(`http://127.0.0.1:${node.port}/`, { jsonrpc: '2.0', method, params, id: 1 })
    return res.data
}

// A funded node whose wallet the miner loaded through the named /wallet/<name> path.
async function preparedMiner(network, node) {
    await rpc(node, 'createwallet', ['xchain_regtest_wallet'])
    await rpc(node, 'generatetoaddress', [110, DEST])
    node.unloadWallet()
    const miner = new XChainRegtestMiner(network, '127.0.0.1', String(node.port), 'user', 'pass')
    sinon.stub(miner, 'sleep').resolves()
    await miner.prepareWallet()
    node.calls = []
    return miner
}

async function testReadPathReload(daemon, network) {
    const node = new StatefulMockNode({ daemon })
    await node.start()
    try {
        const miner = await preparedMiner(network, node)
        node.unloadWallet()

        assert.strictEqual(await miner.refreshWalletFunds(), null, 'the read right after the restart fails')
        await miner.walletReloadInFlight
        assert.strictEqual(node.callsFor('loadwallet').length, 1)

        const balance = await miner.refreshWalletFunds()
        assert.strictEqual(typeof balance, 'number')
        assert.strictEqual(miner.getStatus().wallet_funded, true)
        assert.strictEqual(node.callsFor('sendtoaddress').length, 0, 'no send was needed to recover')
    } finally {
        await node.stop()
    }
}

describe('E2E: balance read reloads a lost wallet', function () {
    beforeEach(function () {
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    afterEach(function () {
        sinon.restore()
    })

    it('recovers wallet_funded when the daemon reports the lost wallet with HTTP 500', async function () {
        await testReadPathReload('legacy', 'litecoin-regtest')
    })

    it('recovers wallet_funded when the daemon reports the lost wallet with HTTP 200', async function () {
        await testReadPathReload('core31', 'bitcoin-regtest')
    })
})
