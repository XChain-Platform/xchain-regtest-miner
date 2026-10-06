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

    // ─── getBalance ─────────────────────────────────────────────────────

    describe('getBalance', function () {
        it('returns numeric balance', async function () {
            axiosPostStub.resolves(rpcSuccess(50.0))
            const result = await connector.getBalance()
            assert.strictEqual(result, 50.0)
            assertRpcCall('getbalance', [])
        })

        it('returns zero balance', async function () {
            axiosPostStub.resolves(rpcSuccess(0))
            const result = await connector.getBalance()
            assert.strictEqual(result, 0)
        })

        it('throws when result is NaN', async function () {
            axiosPostStub.resolves({ data: { result: 'not_a_number' } })
            await assert.rejects(() => connector.getBalance(), /Error getting balance/)
        })
    })
})

// A node restarted under the miner answers getbalance with -18 forever. The static
// message must carry the walletMissing bit over both transports so the read path can
// reload the wallet, and must not carry it for any other failure.
describe('BlockchainConnector', function () {
    beforeEach(setup)
    afterEach(teardown)

    const LOST = { code: -18, message: 'Requested wallet does not exist or is not loaded' }

    async function balanceFailure() {
        try { await connector.getBalance() } catch (err) { return err }
        throw new Error('getBalance resolved')
    }

    describe('getBalance wallet-missing classification', function () {
        it('flags a -18 delivered with HTTP 200 (Core 28+), keeping the static message', async function () {
            axiosPostStub.resolves({ data: { jsonrpc: '2.0', error: LOST, id: 1 } })
            const err = await balanceFailure()
            assert.strictEqual(err.message, 'Error getting balance')
            assert.strictEqual(err.walletMissing, true)
        })

        it('flags a -18 delivered as an HTTP 500 rejection (legacy daemons)', async function () {
            axiosPostStub.rejects(Object.assign(new Error('Request failed with status code 500 at http://localhost:18332'),
                { response: { status: 500, data: { result: null, error: LOST, id: 1 } } }))
            const err = await balanceFailure()
            assert.strictEqual(err.message, 'Error getting balance')
            assert.strictEqual(err.walletMissing, true)
        })

        it('flags the base-URL "No wallet is loaded" answer too', async function () {
            axiosPostStub.resolves({ data: { result: null, error: { code: -18, message: 'No wallet is loaded. Load a wallet' }, id: 1 } })
            assert.strictEqual((await balanceFailure()).walletMissing, true)
        })

        it('sets no flag for a transport failure or another RPC error', async function () {
            axiosPostStub.rejects(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:18332'), { code: 'ECONNREFUSED' }))
            const transport = await balanceFailure()
            assert.strictEqual(transport.message, 'Error getting balance')
            assert.strictEqual(transport.walletMissing, undefined)
            axiosPostStub.resolves({ data: { result: null, error: { code: -28, message: 'Loading wallet...' }, id: 1 } })
            assert.strictEqual((await balanceFailure()).walletMissing, undefined)
        })
    })
})
