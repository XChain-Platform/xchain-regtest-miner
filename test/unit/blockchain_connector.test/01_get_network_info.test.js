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

    // ─── getNetworkInfo ─────────────────────────────────────────────────

    describe('getNetworkInfo', function () {
        it('returns the result on success', async function () {
            const expected = { version: 250000, subversion: '/Satoshi:25.0.0/' }
            axiosPostStub.resolves(rpcSuccess(expected))
            const result = await connector.getNetworkInfo()
            assert.deepStrictEqual(result, expected)
            assertRpcCall('getnetworkinfo')
        })

        it('throws when result is falsy', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.getNetworkInfo(), /Error getting network info/)
        })

        it('throws clean error on network error', async function () {
            axiosPostStub.rejects(new Error('ECONNREFUSED'))
            await assert.rejects(() => connector.getNetworkInfo(), /Error getting network info/)
        })
    })
})
