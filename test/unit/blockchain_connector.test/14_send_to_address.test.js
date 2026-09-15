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

function rpcSuccess(result) {
    return { data: { result, error: null, id: 1 } }
}

describe('BlockchainConnector', function () {
    beforeEach(setup)
    afterEach(teardown)

    // ─── sendToAddress ──────────────────────────────────────────────────

    describe('sendToAddress', function () {
        // sendtoaddress uses POSITIONAL params (Dogecoin v1.14 compat; see
        // the comment in src/rpc/blockchain_connector.js#sendToAddress) and tolerates
        // both bare-string and {txid} response shapes.
        it('uses positional params and returns the txid', async function () {
            axiosPostStub.resolves(rpcSuccess('abc123'))
            const result = await connector.sendToAddress('addr1', 1.5)
            assert.strictEqual(result, 'abc123')
            const data = axiosPostStub.firstCall.args[1]
            assert.deepStrictEqual(data.params, ['addr1', 1.5])
        })

        it('tolerates the verbose-form {txid: ...} response shape', async function () {
            axiosPostStub.resolves(rpcSuccess({ txid: 'abc123' }))
            const result = await connector.sendToAddress('addr1', 1.5)
            assert.strictEqual(result, 'abc123')
        })

        it('logs the node RPC error when result is falsy but throws a static message', async function () {
            axiosPostStub.resolves({
                data: { result: null, error: { code: -6, message: 'Insufficient funds' }, id: 1 }
            })
            await assert.rejects(() => connector.sendToAddress('a', 1), /Error sending funds to address/)
            const logged = console.error.getCalls().map(c => c.args.join(' ')).join('\n')
            assert.match(logged, /Insufficient funds/)
        })
    })
})

describe('BlockchainConnector', function () {
    beforeEach(setup)
    afterEach(teardown)

    describe('sendToAddress', function () {
        it('flags a lost wallet so the caller can reload it, without saying anything in the message', async function () {
            // The one recoverable send failure. The message must stay static
            // (the line below pins why), so the bit travels as a property.
            axiosPostStub.resolves({
                data: {
                    result: null,
                    error: { code: -18, message: 'Requested wallet does not exist or is not loaded' },
                    id: 1,
                }
            })
            let threw = null
            try { await connector.sendToAddress('a', 1) } catch (e) { threw = e }
            assert.strictEqual(threw && threw.message, 'Error sending funds to address')
            assert.strictEqual(threw.walletMissing, true)
        })

        it('does NOT flag an ordinary send failure as a lost wallet', async function () {
            axiosPostStub.resolves({
                data: { result: null, error: { code: -6, message: 'Insufficient funds' }, id: 1 }
            })
            let threw = null
            try { await connector.sendToAddress('a', 1) } catch (e) { threw = e }
            assert.ok(!threw.walletMissing, 'insufficient funds must not trigger a wallet reload')
        })

        it('throws a static message on a transport error (no host:port leak)', async function () {
            axiosPostStub.rejects(new Error('connect ECONNREFUSED 127.0.0.1:18332'))
            let threw = null
            try { await connector.sendToAddress('a', 1) } catch (e) { threw = e }
            assert.strictEqual(threw && threw.message, 'Error sending funds to address')
            assert.ok(!threw.message.includes('18332'), 'thrown message must not leak the RPC host:port')
        })
    })
})

describe('BlockchainConnector', function () {
    beforeEach(setup)
    afterEach(teardown)

    describe('sendToAddress', function () {
        // The per-call fee ceiling. Bitcoin Core 31 deleted settxfee,
        // so the ONLY way left to cap a funding send on BTC is fee_rate on the
        // call itself. What matters is that the rate actually reaches the wire.
        it('carries a supplied fee rate to the daemon as the fee_rate argument', async function () {
            axiosPostStub.resolves(rpcSuccess('abc123'))
            const result = await connector.sendToAddress('addr1', 1.5, 100)
            assert.strictEqual(result, 'abc123')
            const data = axiosPostStub.firstCall.args[1]
            assert.deepStrictEqual(data.params, { address: 'addr1', amount: 1.5, fee_rate: 100 })
        })

        it('keeps the legacy positional form when no fee rate is supplied', async function () {
            // DOGE v1.14 rejects named params outright, so a coin that pins
            // wallet-wide must not be pushed onto the fee_rate call shape.
            axiosPostStub.resolves(rpcSuccess('abc123'))
            for (const rate of [null, undefined, 0, NaN, -5, 'fast']) {
                axiosPostStub.resetHistory()
                await connector.sendToAddress('addr1', 1.5, rate)
                assert.deepStrictEqual(
                    axiosPostStub.firstCall.args[1].params,
                    ['addr1', 1.5],
                    'fee rate ' + String(rate) + ' must not produce a named-param send'
                )
            }
        })

        it('still surfaces a lost wallet on the fee_rate path', async function () {
            // The reload-and-retry recovery applies to the fee-rate call shape.
            axiosPostStub.resolves({
                data: {
                    result: null,
                    error: { code: -18, message: 'Requested wallet does not exist or is not loaded' },
                    id: 1,
                }
            })
            let threw = null
            try { await connector.sendToAddress('a', 1, 100) } catch (e) { threw = e }
            assert.strictEqual(threw && threw.walletMissing, true)
        })
    })
})
