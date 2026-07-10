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
const BlockchainConnector = require('../../src/BlockchainConnector')

describe('Security: Error Sanitization & Information Disclosure', function () {
    let connector
    let axiosPostStub

    beforeEach(function () {
        connector = new BlockchainConnector('localhost', '18332', 'secretuser', 'secretpass')
        axiosPostStub = sinon.stub(axios, 'post')
        sinon.stub(connector, 'sleep').resolves()
        sinon.stub(console, 'error')
        sinon.stub(console, 'log')
    })

    afterEach(function () {
        sinon.restore()
    })

    // ─── SEC-004: RPC credential leakage ───────────────────────────────

    describe('sendToAddress error sanitization (SEC-004)', function () {
        it('does not expose RPC URL in thrown error', async function () {
            const axiosError = new Error('connect ECONNREFUSED http://localhost:18332')
            axiosError.config = { url: 'http://localhost:18332', auth: { username: 'secretuser', password: 'secretpass' } }
            axiosPostStub.rejects(axiosError)

            try {
                await connector.sendToAddress('bcrt1qtest', 1.0)
                assert.fail('should have thrown')
            } catch(err) {
                assert.ok(!err.message.includes('secretuser'))
                assert.ok(!err.message.includes('secretpass'))
                assert.ok(!err.message.includes('18332'))
                assert.ok(!err.message.includes('ECONNREFUSED'))
            }
        })

        it('throws a clean error message for sendToAddress', async function () {
            axiosPostStub.rejects(new Error('Network Error'))

            try {
                await connector.sendToAddress('bcrt1qtest', 1.0)
                assert.fail('should have thrown')
            } catch(err) {
                assert.strictEqual(err.message, 'Error sending funds to address')
            }
        })

        it('does not log RPC credentials on sendToAddress failure', async function () {
            const axiosError = new Error('Request failed')
            axiosError.config = { auth: { username: 'secretuser', password: 'secretpass' } }
            axiosPostStub.rejects(axiosError)

            try {
                await connector.sendToAddress('bcrt1qtest', 1.0)
            } catch(e) {}

            // Check that no console output contains credentials
            for (const call of console.error.getCalls()) {
                for (const arg of call.args) {
                    const str = typeof arg === 'string' ? arg : JSON.stringify(arg)
                    assert.ok(!str.includes('secretuser'), 'console.error leaked username')
                    assert.ok(!str.includes('secretpass'), 'console.error leaked password')
                }
            }
            for (const call of console.log.getCalls()) {
                for (const arg of call.args) {
                    const str = typeof arg === 'string' ? arg : JSON.stringify(arg)
                    assert.ok(!str.includes('secretuser'), 'console.log leaked username')
                    assert.ok(!str.includes('secretpass'), 'console.log leaked password')
                }
            }
        })
    })

    describe('sendRawTransaction error sanitization (SEC-004)', function () {
        it('throws a clean error message', async function () {
            const axiosError = new Error('connect ECONNREFUSED http://localhost:18332')
            axiosError.config = { url: 'http://localhost:18332', auth: { username: 'secretuser', password: 'secretpass' } }
            axiosPostStub.rejects(axiosError)

            try {
                await connector.sendRawTransaction('deadbeef')
                assert.fail('should have thrown')
            } catch(err) {
                assert.strictEqual(err.message, 'Error sending raw transaction')
                assert.ok(!err.message.includes('secretuser'))
                assert.ok(!err.message.includes('secretpass'))
            }
        })

        it('does not log credentials on sendRawTransaction failure', async function () {
            const axiosError = new Error('Request failed')
            axiosError.config = { auth: { username: 'secretuser', password: 'secretpass' } }
            axiosPostStub.rejects(axiosError)

            try {
                await connector.sendRawTransaction('deadbeef')
            } catch(e) {}

            for (const call of console.error.getCalls()) {
                for (const arg of call.args) {
                    const str = typeof arg === 'string' ? arg : JSON.stringify(arg)
                    assert.ok(!str.includes('secretuser'), 'console.error leaked username')
                    assert.ok(!str.includes('secretpass'), 'console.error leaked password')
                }
            }
        })
    })

    describe('sendToAddress does not reflect RPC error data', function () {
        it('does not include RPC error response in thrown error', async function () {
            axiosPostStub.resolves({
                data: {
                    result: null,
                    error: { code: -5, message: 'Invalid Bitcoin address: DROP TABLE wallets' },
                    id: 1
                }
            })

            try {
                await connector.sendToAddress('DROP TABLE wallets', 1.0)
                assert.fail('should have thrown')
            } catch(err) {
                assert.ok(!err.message.includes('DROP TABLE'))
                assert.ok(!err.message.includes('Invalid Bitcoin'))
            }
        })
    })

    // ─── SEC-012: API error message reflection ─────────────────────────

    describe('API error messages do not reflect user input (SEC-012)', function () {
        let XChainRegtestMiner
        let minerInstance
        let minerConnectorStub

        beforeEach(function () {
            minerConnectorStub = {
                sendToAddress: sinon.stub(),
                getWalletInfo: sinon.stub(),
                loadWallet: sinon.stub(),
                createWallet: sinon.stub(),
                getNewAddress: sinon.stub().resolves('bcrt1qtest'),
                getBalance: sinon.stub().resolves(50.0),
                getBlockchainInfo: sinon.stub().resolves({ blocks: 200 }),
                generateToAddress: sinon.stub().resolves(['blockhash1']),
                getRawMempool: sinon.stub().resolves([]),
                getRawTransaction: sinon.stub().resolves(null),
                sendRawTransaction: sinon.stub().resolves('txid'),
            }

            sinon.stub(BlockchainConnector.prototype, 'constructor')
            XChainRegtestMiner = require('../../src/XChainRegtestMiner')
            minerInstance = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
            minerInstance.connector = minerConnectorStub
            sinon.stub(minerInstance, 'sleep').resolves()
        })

        afterEach(function () {
            delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
        })

        it('sendFundsToAddress error does not include the address', async function () {
            const maliciousAddress = '<script>alert("xss")</script>'
            try {
                await minerInstance.sendFundsToAddress(maliciousAddress, 1.0)
            } catch(err) {
                // The error message should be generic, not containing the address
                // Even the validation error message is generic
                assert.ok(!err.message.includes('<script>'))
            }
        })

        it('setMiningTime error does not include raw values', async function () {
            // Non-printable objects should not cause crashes; setMiningTime now
            // throws rather than returning a sentinel {error} object (uuid:24c35056)
            try {
                await minerInstance.setMiningTime({toString: 0}, {toString: 0})
                assert.fail('expected setMiningTime to throw')
            } catch (err) {
                assert.ok(err && err.message)
                assert.ok(!err.message.includes('[object'))
            }
        })
    })
})
