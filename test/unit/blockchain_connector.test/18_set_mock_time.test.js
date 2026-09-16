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

    // ─── setMockTime ─────────────────────────────────────────────────────

    describe('setMockTime', function () {
        it('calls setmocktime RPC with the numeric timestamp and returns true', async function () {
            axiosPostStub.resolves({ data: { result: null, error: null, id: 1 } })
            const result = await connector.setMockTime(1900000000)
            assert.strictEqual(result, true)
            assertRpcCall('setmocktime', [1900000000])
        })

        it('coerces the timestamp to a Number for the RPC params', async function () {
            axiosPostStub.resolves({ data: { result: null, error: null, id: 1 } })
            await connector.setMockTime('1900000000')
            assertRpcCall('setmocktime', [1900000000])
        })

        it('logs the node RPC error but throws a static message', async function () {
            axiosPostStub.resolves({ data: { result: null, error: { code: -8, message: 'Timestamp must be 0 or greater' }, id: 1 } })
            await assert.rejects(() => connector.setMockTime(-5), /Error setting mock time/)
            const logged = console.error.getCalls().map(c => c.args.join(' ')).join('\n')
            assert.match(logged, /Timestamp must be 0 or greater/)
        })

        it('throws a static message on network error (no transport detail leak)', async function () {
            axiosPostStub.rejects(new Error('connect ECONNREFUSED 127.0.0.1:18332'))
            await assert.rejects(() => connector.setMockTime(1900000000), /Error setting mock time/)
        })

        // setmocktime answers result:null on success, so the absence of an error
        // member is not itself a success signal: an empty or truncated body could
        // certify a chain operation the node never performed.
        it('rejects an error-less body that carries no result', async function () {
            axiosPostStub.resolves({ data: {} })
            await assert.rejects(() => connector.setMockTime(1900000000), /Error setting mock time/)
        })

        it('rejects a 2xx body whose result member is absent', async function () {
            axiosPostStub.resolves({ data: { id: 1 } })
            await assert.rejects(() => connector.setMockTime(1900000000), /Error setting mock time/)
        })
    })
})
