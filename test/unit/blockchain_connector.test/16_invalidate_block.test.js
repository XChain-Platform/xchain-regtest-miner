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

describe('BlockchainConnector', function () {
    beforeEach(setup)
    afterEach(teardown)

    // ─── invalidateBlock ────────────────────────────────────────────────

    describe('invalidateBlock', function () {
        it('calls invalidateblock RPC and returns true on success', async function () {
            axiosPostStub.resolves({ data: { result: null, error: null, id: 1 } })
            const result = await connector.invalidateBlock('abc123')
            assert.strictEqual(result, true)
            assertRpcCall('invalidateblock', ['abc123'])
        })

        it('logs the node RPC error but throws a static message', async function () {
            axiosPostStub.resolves({ data: { result: null, error: { code: -8, message: 'Block not found' }, id: 1 } })
            await assert.rejects(() => connector.invalidateBlock('badhash'), /Error invalidating block/)
            const logged = console.error.getCalls().map(c => c.args.join(' ')).join('\n')
            assert.match(logged, /Block not found/)
        })

        it('throws a static message on network error (no transport detail leak)', async function () {
            axiosPostStub.rejects(new Error('connect ECONNREFUSED 127.0.0.1:18332'))
            await assert.rejects(() => connector.invalidateBlock('abc123'), /Error invalidating block/)
        })

        // invalidateblock answers result:null on success, so the absence of an error
        // member is not itself a success signal: an empty or truncated body could
        // certify a chain operation the node never performed.
        it('rejects an error-less body that carries no result', async function () {
            axiosPostStub.resolves({ data: {} })
            await assert.rejects(() => connector.invalidateBlock('abc123'), /Error invalidating block/)
        })

        it('rejects a 2xx body whose result member is absent', async function () {
            axiosPostStub.resolves({ data: { id: 1 } })
            await assert.rejects(() => connector.invalidateBlock('abc123'), /Error invalidating block/)
        })

        // Pre-JSON-RPC-2.0 daemons (LTC v0.21, DOGE v1.14) carry the error on HTTP 500.
        it('logs the node RPC error from an HTTP 500 reply but throws a static message', async function () {
            const err = new Error('Request failed with status code 500')
            err.response = { status: 500, data: { result: null, error: { code: -5, message: 'Block not found' }, id: 1 } }
            axiosPostStub.rejects(err)
            await assert.rejects(() => connector.invalidateBlock('badhash'), /^Error: Error invalidating block$/)
            const logged = console.error.getCalls().map(c => c.args.join(' ')).join('\n')
            assert.match(logged, /invalidateblock RPC error: Block not found/)
        })
    })
})
