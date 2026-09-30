// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const assert = require('assert')
const sinon = require('sinon')
const axios = require('axios')
const BlockchainConnector = require('../../../src/rpc/blockchain_connector')

// Core's reply to a base-URL wallet call when no wallet is loaded.
const CORE_BASE_URL_NO_WALLET = 'No wallet is loaded. Load a wallet using loadwallet or create a new one with createwallet. (Note: A default wallet is no longer automatically created)'
// The same condition as pre-0.21 Core daemons word it.
const LEGACY_NO_WALLET = 'Method not found (wallet method is disabled because no wallet is loaded)'

let connector
let axiosPostStub

function setup() {
    connector = new BlockchainConnector('localhost', '18332', 'rpcuser', 'rpcpass')
    axiosPostStub = sinon.stub(axios, 'post')
    sinon.stub(connector, 'sleep').resolves()
    sinon.stub(console, 'error')
    sinon.stub(console, 'log')
}

function rpcRejection(status, data) {
    const err = new Error('Request failed with status code ' + status)
    err.response = { status, data }
    return err
}

async function sendFailure() {
    try { await connector.sendToAddress('a', 1) } catch (e) { return e }
    return null
}

describe('BlockchainConnector', function () {
    beforeEach(setup)
    afterEach(() => sinon.restore())

    describe('sendToAddress on the base RPC URL', function () {
        it('flags a lost wallet reported with the base-URL text over HTTP 200', async function () {
            axiosPostStub.resolves({ data: { result: null, error: { code: -18, message: CORE_BASE_URL_NO_WALLET }, id: 1 } })
            const threw = await sendFailure()
            assert.strictEqual(threw && threw.message, 'Error sending funds to address')
            assert.strictEqual(threw.walletMissing, true)
        })

        it('flags a lost wallet reported with the base-URL text over HTTP 500', async function () {
            axiosPostStub.rejects(rpcRejection(500, { result: null, error: { code: -18, message: CORE_BASE_URL_NO_WALLET }, id: 1 }))
            const threw = await sendFailure()
            assert.strictEqual(threw && threw.message, 'Error sending funds to address')
            assert.strictEqual(threw.walletMissing, true)
        })

        it('flags the pre-0.21 wallet-disabled wording as a lost wallet', async function () {
            axiosPostStub.rejects(rpcRejection(404, { result: null, error: { code: -32601, message: LEGACY_NO_WALLET }, id: 1 }))
            const threw = await sendFailure()
            assert.strictEqual(threw.walletMissing, true)
        })

        it('does NOT flag a several-wallets-loaded refusal as a lost wallet', async function () {
            axiosPostStub.resolves({ data: { result: null, error: { code: -19, message: 'Wallet file not specified (must request wallet RPC through /wallet/<filename> uri-path).' }, id: 1 } })
            const threw = await sendFailure()
            assert.ok(!threw.walletMissing)
        })
    })

    describe('listWallets', function () {
        it('returns the loaded wallet names from the base URL', async function () {
            axiosPostStub.resolves({ data: { result: ['xchain_regtest_wallet', 'cosigner_test'], error: null, id: 1 } })
            connector.setWalletName('xchain_regtest_wallet')
            const names = await connector.listWallets()
            assert.deepStrictEqual(names, ['xchain_regtest_wallet', 'cosigner_test'])
            assert.strictEqual(axiosPostStub.firstCall.args[0], 'http://localhost:18332')
            assert.strictEqual(axiosPostStub.firstCall.args[1].method, 'listwallets')
        })

        it('returns null when the daemon has no listwallets RPC', async function () {
            axiosPostStub.rejects(rpcRejection(404, { result: null, error: { code: -32601, message: 'Method not found' }, id: 1 }))
            assert.strictEqual(await connector.listWallets(), null)
        })

        it('returns null on a transport error instead of throwing', async function () {
            axiosPostStub.rejects(new Error('connect ECONNREFUSED 127.0.0.1:18332'))
            assert.strictEqual(await connector.listWallets(), null)
        })
    })
})
