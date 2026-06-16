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

describe('Security: BlockchainConnector Error Sanitization', function () {
    let connector
    let axiosPostStub

    const RPC_USER = 'admin'
    const RPC_PASS = 'sup3rs3cret'
    const RPC_HOST = '10.0.0.5'
    const RPC_PORT = '18332'

    beforeEach(function () {
        connector = new BlockchainConnector(RPC_HOST, RPC_PORT, RPC_USER, RPC_PASS)
        axiosPostStub = sinon.stub(axios, 'post')
        sinon.stub(connector, 'sleep').resolves()
        sinon.stub(console, 'error')
        sinon.stub(console, 'log')
        sinon.stub(console, 'warn')
    })

    afterEach(function () {
        sinon.restore()
    })

    function makeAxiosError(message) {
        const err = new Error(message)
        err.config = {
            url: 'http://' + RPC_HOST + ':' + RPC_PORT,
            auth: { username: RPC_USER, password: RPC_PASS },
            data: '{"jsonrpc":"2.0","method":"sendtoaddress"}'
        }
        err.response = { status: 500, data: { error: { code: -1, message: 'Internal error' } } }
        return err
    }

    // Helper to assert an error has no credential leaks
    function assertCleanError(err, expectedMessage) {
        // Error message should be a clean generic message
        assert.strictEqual(err.message, expectedMessage)
        // Error object must NOT carry axios config with credentials
        assert.strictEqual(err.config, undefined, 'Error object carries .config (potential credential leak)')
        assert.ok(!err.message.includes(RPC_PASS), 'Error message contains password')
        assert.ok(!err.message.includes(RPC_USER), 'Error message contains username')
        assert.ok(!err.message.includes(RPC_HOST), 'Error message contains host')
    }

    // Helper to assert no console output contains credentials
    function assertConsoleClean() {
        for (const call of [...console.error.getCalls(), ...console.log.getCalls(), ...console.warn.getCalls()]) {
            for (const arg of call.args) {
                const str = typeof arg === 'string' ? arg : (typeof arg === 'object' && arg !== null ? JSON.stringify(arg) : String(arg))
                assert.ok(!str.includes(RPC_PASS), 'Console output contains password')
                assert.ok(!str.includes(RPC_USER), 'Console output contains username')
            }
        }
    }

    // ─── Per-method error sanitization tests ──────────────────────────

    describe('getNetworkInfo', function () {
        it('throws clean error without credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.getNetworkInfo()
                assert.fail('should throw')
            } catch (err) {
                assertCleanError(err, 'Error getting network info')
            }
        })

        it('does not log credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try { await connector.getNetworkInfo() } catch (e) {}
            assertConsoleClean()
        })
    })

    describe('getBlockchainInfo', function () {
        it('throws clean error without credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.getBlockchainInfo()
                assert.fail('should throw')
            } catch (err) {
                assertCleanError(err, 'Error getting blockchain info')
            }
        })

        it('does not log credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try { await connector.getBlockchainInfo() } catch (e) {}
            assertConsoleClean()
        })
    })

    describe('getBlockHash', function () {
        it('throws clean error without credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.getBlockHash(0)
                assert.fail('should throw')
            } catch (err) {
                assertCleanError(err, 'Error getting block hash')
            }
        })

        it('does not log credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try { await connector.getBlockHash(0) } catch (e) {}
            assertConsoleClean()
        })
    })

    describe('getBlock', function () {
        it('throws clean error without credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.getBlock('abc123')
                assert.fail('should throw')
            } catch (err) {
                assertCleanError(err, 'Error getting block')
            }
        })

        it('does not log credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try { await connector.getBlock('abc123') } catch (e) {}
            assertConsoleClean()
        })
    })

    describe('getRawMempool', function () {
        it('throws clean error without credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.getRawMempool()
                assert.fail('should throw')
            } catch (err) {
                assertCleanError(err, 'Error getting raw mempool')
            }
        })

        it('does not log credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try { await connector.getRawMempool() } catch (e) {}
            assertConsoleClean()
        })
    })

    describe('getMempoolEntry', function () {
        it('throws clean error without credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.getMempoolEntry('txid123')
                assert.fail('should throw')
            } catch (err) {
                assertCleanError(err, 'Error getting mempool entry')
            }
        })

        it('does not log credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try { await connector.getMempoolEntry('txid123') } catch (e) {}
            assertConsoleClean()
        })
    })

    describe('getRawTransaction', function () {
        it('returns null on error without logging credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            const result = await connector.getRawTransaction('txid123')
            assert.strictEqual(result, null)
            assertConsoleClean()
        })
    })

    describe('createWallet', function () {
        it('throws clean error without credentials after retries', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.createWallet('test_wallet', 2)
                assert.fail('should throw')
            } catch (err) {
                assertCleanError(err, 'Error creating wallet')
            }
        })

        it('does not log credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try { await connector.createWallet('test_wallet', 2) } catch (e) {}
            assertConsoleClean()
        })
    })

    describe('getWalletInfo', function () {
        it('throws clean error without credentials after retries', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.getWalletInfo(2)
                assert.fail('should throw')
            } catch (err) {
                assertCleanError(err, 'Error getting wallet info: max retries exceeded')
            }
        })

        it('does not log credentials during retries', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try { await connector.getWalletInfo(2) } catch (e) {}
            assertConsoleClean()
        })
    })

    describe('loadWallet', function () {
        it('throws clean error without credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.loadWallet('test_wallet')
                assert.fail('should throw')
            } catch (err) {
                assertCleanError(err, 'Error loading wallet')
            }
        })

        it('does not log credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try { await connector.loadWallet('test_wallet') } catch (e) {}
            assertConsoleClean()
        })
    })

    describe('getNewAddress', function () {
        it('throws clean error without credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.getNewAddress()
                assert.fail('should throw')
            } catch (err) {
                assertCleanError(err, 'Error getting new address')
            }
        })

        it('does not log credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try { await connector.getNewAddress() } catch (e) {}
            assertConsoleClean()
        })
    })

    describe('generateToAddress', function () {
        it('throws clean error without credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.generateToAddress(1, 'bcrt1qtest')
                assert.fail('should throw')
            } catch (err) {
                assertCleanError(err, 'Error generating to address')
            }
        })

        it('does not log credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try { await connector.generateToAddress(1, 'bcrt1qtest') } catch (e) {}
            assertConsoleClean()
        })
    })

    describe('getBalance', function () {
        it('throws clean error without credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.getBalance()
                assert.fail('should throw')
            } catch (err) {
                assertCleanError(err, 'Error getting balance')
            }
        })

        it('does not log credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try { await connector.getBalance() } catch (e) {}
            assertConsoleClean()
        })
    })

    describe('sendToAddress', function () {
        it('throws clean error without credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.sendToAddress('bcrt1qtest', 1.0)
                assert.fail('should throw')
            } catch (err) {
                assertCleanError(err, 'Error sending funds to address')
            }
        })

        it('does not log credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try { await connector.sendToAddress('bcrt1qtest', 1.0) } catch (e) {}
            assertConsoleClean()
        })
    })

    describe('sendRawTransaction', function () {
        it('throws clean error without credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.sendRawTransaction('deadbeef')
                assert.fail('should throw')
            } catch (err) {
                assertCleanError(err, 'Error sending raw transaction')
            }
        })

        it('does not log credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try { await connector.sendRawTransaction('deadbeef') } catch (e) {}
            assertConsoleClean()
        })
    })

    // ─── Blanket console output credential check ──────────────────────

    describe('no method ever logs credentials to console', function () {
        const methods = [
            { name: 'getNetworkInfo', args: [] },
            { name: 'getBlockchainInfo', args: [] },
            { name: 'getBlockHash', args: [0] },
            { name: 'getBlock', args: ['abc'] },
            { name: 'getRawMempool', args: [] },
            { name: 'getMempoolEntry', args: ['txid'] },
            { name: 'loadWallet', args: ['test'] },
            { name: 'getNewAddress', args: [] },
            { name: 'generateToAddress', args: [1, 'addr'] },
            { name: 'getBalance', args: [] },
            { name: 'sendToAddress', args: ['addr', 1.0] },
            { name: 'sendRawTransaction', args: ['hex'] },
        ]

        for (const { name, args } of methods) {
            it(`${name} does not log password`, async function () {
                axiosPostStub.rejects(makeAxiosError('ECONNREFUSED'))
                try { await connector[name](...args) } catch (e) {}
                assertConsoleClean()
            })
        }
    })

    // ─── Error object property checks ─────────────────────────────────

    describe('no method exposes .config on thrown errors', function () {
        const methods = [
            { name: 'getNetworkInfo', args: [] },
            { name: 'getBlockchainInfo', args: [] },
            { name: 'getBlockHash', args: [0] },
            { name: 'getBlock', args: ['abc'] },
            { name: 'getRawMempool', args: [] },
            { name: 'getMempoolEntry', args: ['txid'] },
            { name: 'createWallet', args: ['test', 1] },
            { name: 'getWalletInfo', args: [1] },
            { name: 'loadWallet', args: ['test'] },
            { name: 'getNewAddress', args: [] },
            { name: 'generateToAddress', args: [1, 'addr'] },
            { name: 'getBalance', args: [] },
            { name: 'sendToAddress', args: ['addr', 1.0] },
            { name: 'sendRawTransaction', args: ['hex'] },
        ]

        for (const { name, args } of methods) {
            it(`${name} error has no .config property`, async function () {
                axiosPostStub.rejects(makeAxiosError('ECONNREFUSED'))
                try {
                    await connector[name](...args)
                    // getRawTransaction returns null, doesn't throw
                    if (name === 'getRawTransaction') return
                    assert.fail('should throw')
                } catch (err) {
                    assert.strictEqual(err.config, undefined, `${name} error exposes .config`)
                    assert.strictEqual(err.response, undefined, `${name} error exposes .response`)
                }
            })
        }
    })
})
