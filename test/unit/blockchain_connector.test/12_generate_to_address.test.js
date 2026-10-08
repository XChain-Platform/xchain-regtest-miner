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

    // ─── generateToAddress ──────────────────────────────────────────────

    describe('generateToAddress', function () {
        it('returns array of block hashes', async function () {
            const hashes = ['hash1', 'hash2']
            axiosPostStub.resolves(rpcSuccess(hashes))
            const result = await connector.generateToAddress(2, 'addr1')
            assert.deepStrictEqual(result, hashes)
            assertRpcCall('generatetoaddress', [2, 'addr1'])
        })

        it('does not override the timeout, inheriting the NODE_RPC_TIMEOUT default', async function () {
            // generateToAddress inherits axios.defaults.timeout (NODE_RPC_TIMEOUT,
            // default 60000), so the per-request config carries no timeout.
            axiosPostStub.resolves(rpcSuccess(['hash']))
            await connector.generateToAddress(1, 'addr')
            const config = axiosPostStub.firstCall.args[2]
            assert.strictEqual(config.timeout, undefined)
            assert.strictEqual(axios.defaults.timeout, 60000)
        })

        it('throws a static message when result is falsy', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.generateToAddress(1, 'a'), /Error generating to address/)
        })

        it('logs the node RPC error for diagnosis but throws a static message', async function () {
            // The real RPC error remains in logs for diagnosing LTC block-generation failures.
            // The thrown message stays static to prevent transport-detail disclosure.
            axiosPostStub.resolves({
                data: { result: null, error: { code: -25, message: 'bad-txns-vin-empty, Transaction check failed' }, id: 1 }
            })
            await assert.rejects(
                () => connector.generateToAddress(1, 'addr'),
                /Error generating to address/
            )
            const logged = console.error.getCalls().map(c => c.args.join(' ')).join('\n')
            assert.match(logged, /bad-txns-vin-empty/)
        })

        it('does not surface a transport error host:port in the thrown message', async function () {
            const netErr = new Error('ECONNREFUSED 127.0.0.1:3220')
            axiosPostStub.rejects(netErr)
            let threw = null
            try { await connector.generateToAddress(1, 'addr') } catch (e) { threw = e }
            assert.ok(threw, 'should throw')
            assert.strictEqual(threw.message, 'Error generating to address')
            assert.ok(!threw.message.includes('3220'), 'thrown message must not leak the RPC host:port')
        })
    })
})

describe('BlockchainConnector', function () {
    beforeEach(setup)
    afterEach(teardown)

    describe('generateToAddress', function () {
        // Pre-JSON-RPC-2.0 daemons (LTC v0.21, DOGE v1.14) carry the error on HTTP 500.
        it('logs the node RPC error from an HTTP 500 reply but throws a static message', async function () {
            const err = new Error('Request failed with status code 500')
            err.response = { status: 500, data: { result: null, error: { code: -25, message: 'bad-txns-vin-empty' }, id: 1 } }
            axiosPostStub.rejects(err)
            let threw = null
            try { await connector.generateToAddress(1, 'addr') } catch (e) { threw = e }
            assert.strictEqual(threw && threw.message, 'Error generating to address')
            const logged = console.error.getCalls().map(c => c.args.join(' ')).join('\n')
            assert.match(logged, /generatetoaddress returned no result: bad-txns-vin-empty/)
        })
    })
})

describe('BlockchainConnector', function () {
    beforeEach(setup)
    afterEach(teardown)

    describe('generateToAddress', function () {
        // generatetoaddress answers a short or empty list, with no error, when it
        // runs out of maxtries at real difficulty; that is a failed mine.
        it('throws a static message when the node returns an empty hash list', async function () {
            axiosPostStub.resolves(rpcSuccess([]))
            await assert.rejects(() => connector.generateToAddress(1, 'addr'), /^Error: Error generating to address$/)
        })

        it('throws and logs both counts when the node returns fewer hashes than requested', async function () {
            axiosPostStub.resolves(rpcSuccess(['h1']))
            await assert.rejects(() => connector.generateToAddress(2, 'addr'), /^Error: Error generating to address$/)
            const logged = console.error.getCalls().map(c => c.args.join(' ')).join('\n')
            assert.match(logged, /returned 1 of 2 requested blocks/)
        })

        it('throws a static message when the result is truthy but not an array', async function () {
            axiosPostStub.resolves(rpcSuccess('abc'))
            await assert.rejects(() => connector.generateToAddress(1, 'addr'), /Error generating to address/)
            axiosPostStub.resolves(rpcSuccess({}))
            await assert.rejects(() => connector.generateToAddress(1, 'addr'), /Error generating to address/)
        })
    })
})

describe('BlockchainConnector', function () {
    beforeEach(setup)
    afterEach(teardown)

    describe('generateToAddress', function () {
        // A client timeout leaves the node mining, so the miner must be able to tell it apart.
        it('flags a client timeout as timedOut with a static, host-free message', async function () {
            for (const code of ['ECONNABORTED', 'ETIMEDOUT']) {
                axiosPostStub.rejects(Object.assign(new Error('timeout of 60000ms exceeded at 127.0.0.1:3220'), { code }))
                let threw = null
                try { await connector.generateToAddress(5, 'addr') } catch (e) { threw = e }
                assert.strictEqual(threw && threw.message, 'Error generating to address')
                assert.strictEqual(threw.timedOut, true, code + ' must be flagged timedOut')
                assert.deepStrictEqual(Object.keys(threw), ['timedOut'])
            }
        })

        it('leaves a non-timeout failure unflagged', async function () {
            axiosPostStub.rejects(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3220'), { code: 'ECONNREFUSED' }))
            let threw = null
            try { await connector.generateToAddress(1, 'addr') } catch (e) { threw = e }
            assert.strictEqual(threw && threw.message, 'Error generating to address')
            assert.strictEqual(threw.timedOut, undefined)
        })
    })
})
