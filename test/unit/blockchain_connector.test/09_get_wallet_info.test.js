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

function rpcNoResult() {
    return { data: { result: null, error: { code: -1, message: 'fail' }, id: 1 } }
}

describe('BlockchainConnector', function () {
    beforeEach(setup)
    afterEach(teardown)

    // ─── getWalletInfo (bounded retry with max retries) ─────────────────

    describe('getWalletInfo', function () {
        it('returns wallet info on first success', async function () {
            const info = { walletname: 'default', balance: 50.0 }
            axiosPostStub.resolves(rpcSuccess(info))
            const result = await connector.getWalletInfo()
            assert.deepStrictEqual(result, info)
            assert.strictEqual(axiosPostStub.callCount, 1)
        })

        it('retries on failure and returns on success', async function () {
            axiosPostStub.onFirstCall().rejects(new Error('not ready'))
            axiosPostStub.onSecondCall().rejects(new Error('not ready'))
            axiosPostStub.onThirdCall().resolves(rpcSuccess({ walletname: 'w' }))
            const result = await connector.getWalletInfo(5)
            assert.deepStrictEqual(result, { walletname: 'w' })
            assert.strictEqual(axiosPostStub.callCount, 3)
        })

        it('throws after exhausting max retries', async function () {
            axiosPostStub.rejects(new Error('down'))
            await assert.rejects(() => connector.getWalletInfo(3), /max retries exceeded/)
            assert.strictEqual(axiosPostStub.callCount, 3)
        })

        it('defaults to 50 max retries', async function () {
            axiosPostStub.rejects(new Error('down'))
            await assert.rejects(() => connector.getWalletInfo())
            assert.strictEqual(axiosPostStub.callCount, 50)
        })
    })
})

describe('BlockchainConnector', function () {
    beforeEach(setup)
    afterEach(teardown)

    describe('getWalletInfo', function () {
        it('sleeps 1s between retries', async function () {
            axiosPostStub.onFirstCall().rejects(new Error('fail'))
            axiosPostStub.onSecondCall().resolves(rpcSuccess({ walletname: 'w' }))
            await connector.getWalletInfo(5)
            assert(connector.sleep.calledWith(1000))
        })

        it('throws when response has no result', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.getWalletInfo(), /Error getting wallet info/)
        })

        it('silently retries without logging credentials', async function () {
            axiosPostStub.onFirstCall().rejects(new Error('fail'))
            axiosPostStub.onSecondCall().resolves(rpcSuccess({ walletname: 'w' }))
            await connector.getWalletInfo(5)
            // Retry logging must exclude credentials
            for (const call of console.error.getCalls()) {
                for (const arg of call.args) {
                    const str = typeof arg === 'string' ? arg : String(arg)
                    assert.ok(!str.includes('rpcpass'), 'Logged credentials during retry')
                }
            }
        })
    })
})
