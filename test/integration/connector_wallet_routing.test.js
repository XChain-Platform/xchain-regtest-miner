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
 * Seam D Integration Tests: wallet-context routing and non-2xx RPC errors
 *
 * Once setWalletName pins a wallet, wallet RPCs go to /wallet/<name> while
 * chain RPCs stay on the base URL; a regression there is the -19 "Wallet
 * file not specified" break on a multi-wallet node. Also drives the HTTP 500
 * error replies of daemons that predate JSON-RPC 2.0 over real HTTP.
 */

const assert = require('assert')
const sinon = require('sinon')
const MockRpcServer = require('./helpers/MockRpcServer')
const BlockchainConnector = require('../../src/rpc/blockchain_connector')

const WALLET = 'xchain_regtest_wallet'

let server, connector

async function testWalletRpcsTargetWalletUri() {
    server.onMethod('getbalance').returns(12.5)
    server.onMethod('getnewaddress').returns('bcrt1qwallet')
    server.onMethod('getblockchaininfo').returns({ blocks: 7 })
    connector.setWalletName(WALLET)

    assert.strictEqual(await connector.getBalance(), 12.5)
    assert.strictEqual(await connector.getNewAddress(), 'bcrt1qwallet')
    assert.strictEqual(server.callsFor('getbalance')[0].walletName, WALLET)
    assert.strictEqual(server.callsFor('getnewaddress')[0].walletName, WALLET)

    // Chain RPCs stay on the base URL.
    assert.strictEqual((await connector.getBlockchainInfo()).blocks, 7)
    assert.strictEqual(server.callsFor('getblockchaininfo')[0].walletName, null)
}

async function testWalletPinnedSendAndFee() {
    server.onMethod('settxfee').returns(true)
    server.onMethod('sendtoaddress').returns('txid-wallet')
    connector.setWalletName(WALLET)

    assert.strictEqual(await connector.setTxFee(0.0001), true)
    assert.strictEqual(await connector.sendToAddress('bcrt1qdest', 1), 'txid-wallet')
    assert.strictEqual(server.callsFor('settxfee')[0].walletName, WALLET)
    assert.strictEqual(server.callsFor('sendtoaddress')[0].walletName, WALLET)
}

async function testLostWalletOverHttp500() {
    server.onMethod('sendtoaddress')
        .failTimes(1, 'rpc500', { code: -18, message: 'Requested wallet does not exist or is not loaded' })
        .thenReturn('txid-after')
    connector.setWalletName(WALLET)

    let threw = null
    try { await connector.sendToAddress('bcrt1qdest', 1) } catch (e) { threw = e }
    assert.strictEqual(threw && threw.message, 'Error sending funds to address')
    assert.strictEqual(threw.walletMissing, true)
    assert.ok(!threw.message.includes(String(server.port)), 'thrown message must not leak the RPC port')
}

describe('Seam D: BlockchainConnector ↔ MockRpcServer', function () {
    before(async function () {
        server = new MockRpcServer()
        await server.start()
    })

    after(async function () {
        await server.stop()
    })

    beforeEach(function () {
        server.reset()
        connector = new BlockchainConnector('127.0.0.1', String(server.port), 'rpcuser', 'rpcpass')
        sinon.stub(connector, 'sleep').resolves()
        sinon.stub(console, 'error')
        sinon.stub(console, 'log')
    })

    afterEach(function () {
        sinon.restore()
    })

    describe('wallet-context routing', function () {
        it('wallet RPCs target the /wallet/<name> URI once a wallet is pinned', testWalletRpcsTargetWalletUri)
        it('settxfee and sendtoaddress reach the pinned wallet', testWalletPinnedSendAndFee)
        it('flags a lost wallet that the daemon reports with HTTP 500', testLostWalletOverHttp500)
    })
})
