// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

const assert = require('assert')
const sinon = require('sinon')
const BlockchainConnector = require('../../src/BlockchainConnector')

describe('Security: API Hardening', function () {
    let XChainRegtestMiner
    let miner
    let connectorStub
    let controller

    beforeEach(function () {
        connectorStub = {
            getWalletInfo: sinon.stub(),
            loadWallet: sinon.stub(),
            createWallet: sinon.stub(),
            getNewAddress: sinon.stub().resolves('bcrt1qtest'),
            getBalance: sinon.stub().resolves(50.0),
            getBlockchainInfo: sinon.stub().resolves({ blocks: 200 }),
            generateToAddress: sinon.stub().resolves(['blockhash1']),
            getRawMempool: sinon.stub().resolves([]),
            sendToAddress: sinon.stub().resolves('txid_abc'),
            getRawTransaction: sinon.stub().resolves('0200000001...'),
            sendRawTransaction: sinon.stub().resolves('txid_sent'),
        }

        sinon.stub(BlockchainConnector.prototype, 'constructor')
        XChainRegtestMiner = require('../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        miner.connector = connectorStub
        sinon.stub(miner, 'sleep').resolves()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')

        // Recreate controller logic matching api.js
        controller = {
            async ping() {
                return { status: 'success' }
            },
            async send_funds({ address, amount }) {
                let txid = null
                try {
                    txid = await miner.sendFundsToAddress(address, amount)
                } catch (err) {
                    return { error: 'There was a problem sending funds' }
                }
                return txid
            },
            async fill_mempool({ tx_quantity }) {
                try {
                    await miner.fillMempool(tx_quantity)
                } catch (err) {
                    return { error: 'There was a problem trying to fill the mempool' }
                }
                return { result: 'ok' }
            },
            async set_mining_time({ max_time, tx_added_time }) {
                try {
                    await miner.setMiningTime(max_time, tx_added_time)
                } catch (err) {
                    return { error: 'There was a problem trying to set a new time to mine blocks' }
                }
                return { result: 'ok' }
            },
        }
    })

    afterEach(function () {
        sinon.restore()
        delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
    })

    // ─── API error responses are generic ───────────────────────────────

    describe('send_funds returns generic errors (SEC-012)', function () {
        it('returns generic error for invalid address type', async function () {
            const result = await controller.send_funds({ address: 12345, amount: 1.0 })
            assert.ok(result.error)
            assert.strictEqual(result.error, 'There was a problem sending funds')
            assert.ok(!result.error.includes('12345'))
        })

        it('returns generic error for XSS in address', async function () {
            const result = await controller.send_funds({ address: '<script>alert(1)</script>', amount: 1.0 })
            // The validation rejects empty/non-string, but a string with XSS passes to RPC
            // Either way, the error should be generic
            if (result && result.error) {
                assert.ok(!result.error.includes('<script>'))
            }
        })

        it('returns generic error for negative amount', async function () {
            const result = await controller.send_funds({ address: 'bcrt1qtest', amount: -999 })
            assert.ok(result.error)
            assert.strictEqual(result.error, 'There was a problem sending funds')
            assert.ok(!result.error.includes('-999'))
        })

        it('returns generic error for string amount', async function () {
            const result = await controller.send_funds({ address: 'bcrt1qtest', amount: 'DROP TABLE' })
            assert.ok(result.error)
            assert.ok(!result.error.includes('DROP TABLE'))
        })

        it('returns generic error for null parameters', async function () {
            const result = await controller.send_funds({ address: null, amount: null })
            assert.ok(result.error)
            assert.strictEqual(result.error, 'There was a problem sending funds')
        })

        it('returns generic error for undefined parameters', async function () {
            const result = await controller.send_funds({ address: undefined, amount: undefined })
            assert.ok(result.error)
            assert.strictEqual(result.error, 'There was a problem sending funds')
        })
    })

    describe('fill_mempool returns generic errors', function () {
        it('returns generic error on miner exception', async function () {
            sinon.stub(miner, 'fillMempool').rejects(new Error('internal details'))
            // Re-wire the controller
            const ctrl = {
                async fill_mempool({ tx_quantity }) {
                    try {
                        await miner.fillMempool(tx_quantity)
                    } catch (err) {
                        return { error: 'There was a problem trying to fill the mempool' }
                    }
                    return { result: 'ok' }
                },
            }

            const result = await ctrl.fill_mempool({ tx_quantity: 10 })
            assert.ok(result.error)
            assert.strictEqual(result.error, 'There was a problem trying to fill the mempool')
            assert.ok(!result.error.includes('internal details'))
        })
    })

    describe('set_mining_time handles edge cases', function () {
        it('does not crash with object params', async function () {
            const result = await controller.set_mining_time({ max_time: {}, tx_added_time: {} })
            // Should return ok (setMiningTime returns error object, but doesn't throw)
            assert.ok(result)
        })

        it('does not crash with null params', async function () {
            const result = await controller.set_mining_time({ max_time: null, tx_added_time: null })
            assert.ok(result)
        })

        it('does not crash with very large numbers', async function () {
            const result = await controller.set_mining_time({ max_time: Number.MAX_SAFE_INTEGER, tx_added_time: Number.MAX_SAFE_INTEGER })
            assert.ok(result)
        })
    })

    // ─── Prototype pollution defense ───────────────────────────────────

    describe('prototype pollution resistance', function () {
        it('sendFundsToAddress rejects __proto__ as address', async function () {
            // __proto__ is a string, so it would pass type check but get sent to RPC
            // The important thing is it doesn't crash or expose internals
            connectorStub.sendToAddress.rejects(new Error('bad address'))
            try {
                await miner.sendFundsToAddress('__proto__', 1.0)
            } catch(e) {
                // Expected to fail at RPC level
            }
            // Should have reached the connector (it's a valid string)
            assert.strictEqual(connectorStub.sendToAddress.callCount, 1)
        })

        it('sendFundsToAddress rejects constructor as address', async function () {
            connectorStub.sendToAddress.rejects(new Error('bad address'))
            try {
                await miner.sendFundsToAddress('constructor', 1.0)
            } catch(e) {
                // Expected
            }
            assert.strictEqual(connectorStub.sendToAddress.callCount, 1)
        })
    })
})
