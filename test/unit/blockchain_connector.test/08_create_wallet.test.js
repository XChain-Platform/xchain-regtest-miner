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

let connector
let axiosPostStub

function setup() {
    connector = new BlockchainConnector('localhost', '18332', 'rpcuser', 'rpcpass')
    axiosPostStub = sinon.stub(axios, 'post')
    sinon.stub(connector, 'sleep').resolves()
    sinon.stub(console, 'error')
    sinon.stub(console, 'log')
}

function teardown() {
    sinon.restore()
}

function assertRpcCall(expectedMethod, expectedParams) {
    const [url, data, config] = axiosPostStub.firstCall.args
    assert.strictEqual(url, 'http://localhost:18332')
    assert.strictEqual(data.jsonrpc, '2.0')
    assert.strictEqual(data.method, expectedMethod)
    assert.strictEqual(data.id, 1)
    if (expectedParams !== undefined) {
        assert.deepStrictEqual(data.params, expectedParams)
    }
    assert.deepStrictEqual(config.auth, { username: 'rpcuser', password: 'rpcpass' })
}

function rpcSuccess(result) {
    return { data: { result, error: null, id: 1 } }
}

function rpcNoResult() {
    return { data: { result: null, error: { code: -1, message: 'fail' }, id: 1 } }
}

describe('BlockchainConnector', function () {
    beforeEach(setup)
    afterEach(teardown)

    // ─── createWallet (bounded retry pattern) ───────────────────────────

    describe('createWallet', function () {
        it('returns wallet info on first success', async function () {
            const walletInfo = { name: 'test_wallet' }
            axiosPostStub.resolves(rpcSuccess(walletInfo))
            const result = await connector.createWallet('test_wallet')
            assert.deepStrictEqual(result, walletInfo)
            assert.strictEqual(axiosPostStub.callCount, 1)
        })

        it('retries on failure and succeeds', async function () {
            axiosPostStub.onFirstCall().rejects(new Error('busy'))
            axiosPostStub.onSecondCall().rejects(new Error('busy'))
            axiosPostStub.onThirdCall().resolves(rpcSuccess({ name: 'w' }))
            const result = await connector.createWallet('w', 5)
            assert.deepStrictEqual(result, { name: 'w' })
            assert.strictEqual(axiosPostStub.callCount, 3)
        })

        it('retries on an empty answer and succeeds', async function () {
            axiosPostStub.onFirstCall().resolves({ data: { result: null, error: null, id: 1 } })
            axiosPostStub.onSecondCall().resolves(rpcSuccess({ name: 'w' }))
            const result = await connector.createWallet('w', 5)
            assert.deepStrictEqual(result, { name: 'w' })
            assert.strictEqual(axiosPostStub.callCount, 2)
        })

        it('exhausts retries and throws', async function () {
            axiosPostStub.rejects(new Error('always fails'))
            await assert.rejects(() => connector.createWallet('w', 3), /Error creating wallet/)
            assert.strictEqual(axiosPostStub.callCount, 3)
        })

        it('defaults to 50 retries', async function () {
            axiosPostStub.rejects(new Error('fail'))
            await assert.rejects(() => connector.createWallet('w'))
            assert.strictEqual(axiosPostStub.callCount, 50)
        })

        it('sleeps between retries', async function () {
            axiosPostStub.onFirstCall().rejects(new Error('fail'))
            axiosPostStub.onSecondCall().resolves(rpcSuccess({ name: 'w' }))
            await connector.createWallet('w', 3)
            assert(connector.sleep.calledWith(1000))
        })

        it('sends correct RPC method and params', async function () {
            axiosPostStub.resolves(rpcSuccess({ name: 'my_wallet' }))
            await connector.createWallet('my_wallet')
            assertRpcCall('createwallet', ['my_wallet'])
        })
    })

    describe('createWallet node answers', createWalletNodeAnswerTests)
})

// A node answer other than warmup repeats on every try, so it must not be retried.
function createWalletNodeAnswerTests() {
    it('retries a warmup answer and succeeds', async function () {
        axiosPostStub.onFirstCall().resolves({ data: { result: null, error: { code: -28, message: 'Loading wallet...' }, id: 1 } })
        axiosPostStub.onSecondCall().resolves(rpcSuccess({ name: 'w' }))
        const result = await connector.createWallet('w', 5)
        assert.deepStrictEqual(result, { name: 'w' })
        assert.strictEqual(axiosPostStub.callCount, 2)
    })

    it('stops at once on a node error it would repeat (HTTP 200 body)', async function () {
        axiosPostStub.resolves(rpcNoResult())
        await assert.rejects(
            () => connector.createWallet('w'),
            err => err.message === 'Error creating wallet' && err.rpcCode === -1 && err.config === undefined
        )
        assert.strictEqual(axiosPostStub.callCount, 1)
        assert(connector.sleep.notCalled)
    })

    it('stops at once on "Database already exists" (HTTP 500 body)', async function () {
        const rejection = new Error('Request failed with status code 500')
        rejection.response = { status: 500, data: { result: null, error: { code: -4, message: "Failed to create database path 'w'. Database already exists." }, id: 1 } }
        axiosPostStub.rejects(rejection)
        await assert.rejects(
            () => connector.createWallet('w'),
            err => err.message === 'Error creating wallet' && err.rpcCode === -4
        )
        assert.strictEqual(axiosPostStub.callCount, 1)
    })
}
