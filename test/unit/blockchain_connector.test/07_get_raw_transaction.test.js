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

    // ─── getRawTransaction (silent null pattern) ────────────────────────

    describe('getRawTransaction', function () {
        it('returns raw tx hex on success', async function () {
            axiosPostStub.resolves(rpcSuccess('0200000001...'))
            const result = await connector.getRawTransaction('txid1')
            assert.strictEqual(result, '0200000001...')
            assertRpcCall('getrawtransaction', ['txid1'])
        })

        it('returns null on network error instead of throwing', async function () {
            axiosPostStub.rejects(new Error('ECONNREFUSED'))
            const result = await connector.getRawTransaction('txid1')
            assert.strictEqual(result, null)
        })

        it('returns null on RPC error instead of throwing', async function () {
            axiosPostStub.rejects(new Error('RPC error'))
            const result = await connector.getRawTransaction('bad_txid')
            assert.strictEqual(result, null)
        })

        it('throws when result is falsy (caught internally, returns null)', async function () {
            // When the RPC returns no result, the internal throw is caught and null is returned
            axiosPostStub.resolves(rpcNoResult())
            const result = await connector.getRawTransaction('txid')
            assert.strictEqual(result, null)
        })
    })
})
