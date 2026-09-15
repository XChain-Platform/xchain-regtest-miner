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

describe('BlockchainConnector', function () {
    beforeEach(setup)
    afterEach(teardown)

    // ─── setTxFee ───────────────────────────────────────────────────────

    describe('setTxFee', function () {
        it('calls settxfee with the fee rate and returns true on success', async function () {
            axiosPostStub.resolves(rpcSuccess(true))
            const result = await connector.setTxFee(0.001)
            assert.strictEqual(result, true)
            assertRpcCall('settxfee', [0.001])
        })

        it('returns false (tolerated) when the daemon rejects settxfee', async function () {
            // A daemon that does not honor settxfee must not break wallet prep;
            // funding then falls back to the fee-estimate path.
            axiosPostStub.resolves({ data: { result: false, error: null, id: 1 } })
            assert.strictEqual(await connector.setTxFee(0.001), false)
        })

        it('returns false on a network error rather than throwing', async function () {
            axiosPostStub.rejects(new Error('ECONNREFUSED'))
            assert.strictEqual(await connector.setTxFee(0.001), false)
        })
    })
})
