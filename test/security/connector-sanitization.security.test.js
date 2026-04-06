const assert = require('assert')
const sinon = require('sinon')
const axios = require('axios')
const BlockchainConnector = require('../../src/BlockchainConnector')

describe('Security: BlockchainConnector Error Sanitization', function () {
    let connector
    let axiosPostStub

    beforeEach(function () {
        connector = new BlockchainConnector('10.0.0.5', '18332', 'admin', 'sup3rs3cret')
        axiosPostStub = sinon.stub(axios, 'post')
        sinon.stub(connector, 'sleep').resolves()
        sinon.stub(console, 'error')
        sinon.stub(console, 'log')
    })

    afterEach(function () {
        sinon.restore()
    })

    function makeAxiosError(message) {
        const err = new Error(message)
        err.config = {
            url: 'http://10.0.0.5:18332',
            auth: { username: 'admin', password: 'sup3rs3cret' },
            data: '{"jsonrpc":"2.0","method":"sendtoaddress"}'
        }
        err.response = { status: 500, data: { error: { code: -1, message: 'Internal error' } } }
        return err
    }

    // Test every RPC method that wraps axios errors

    describe('getBlockHash does not leak credentials', function () {
        it('error message does not contain password', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.getBlockHash(0)
                assert.fail('should throw')
            } catch(err) {
                assert.ok(!err.message.includes('sup3rs3cret'))
            }
        })
    })

    describe('getBlock does not leak credentials', function () {
        it('error message does not contain password', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.getBlock('abc123')
                assert.fail('should throw')
            } catch(err) {
                assert.ok(!err.message.includes('sup3rs3cret'))
            }
        })
    })

    describe('getRawMempool does not leak credentials', function () {
        it('error message does not contain password', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.getRawMempool()
                assert.fail('should throw')
            } catch(err) {
                assert.ok(!err.message.includes('sup3rs3cret'))
            }
        })
    })

    describe('getMempoolEntry does not leak credentials', function () {
        it('error message does not contain password', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.getMempoolEntry('txid123')
                assert.fail('should throw')
            } catch(err) {
                assert.ok(!err.message.includes('sup3rs3cret'))
            }
        })
    })

    describe('getRawTransaction returns null on error (no leak)', function () {
        it('returns null without logging credentials', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            const result = await connector.getRawTransaction('txid123')
            assert.strictEqual(result, null)

            // Verify nothing was logged that contains credentials
            for (const call of [...console.error.getCalls(), ...console.log.getCalls()]) {
                for (const arg of call.args) {
                    if (typeof arg === 'object' && arg !== null) {
                        const str = JSON.stringify(arg)
                        assert.ok(!str.includes('sup3rs3cret'), 'Logged object contains password')
                    }
                }
            }
        })
    })

    describe('createWallet does not leak credentials', function () {
        it('error message does not contain password after retries', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.createWallet('test_wallet', 2)
                assert.fail('should throw')
            } catch(err) {
                assert.ok(!err.message.includes('sup3rs3cret'))
            }
        })
    })

    describe('loadWallet does not leak credentials', function () {
        it('error message does not contain password', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.loadWallet('test_wallet')
                assert.fail('should throw')
            } catch(err) {
                assert.ok(!err.message.includes('sup3rs3cret'))
            }
        })
    })

    describe('getNewAddress does not leak credentials', function () {
        it('error message does not contain password', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.getNewAddress()
                assert.fail('should throw')
            } catch(err) {
                assert.ok(!err.message.includes('sup3rs3cret'))
            }
        })
    })

    describe('generateToAddress does not leak credentials', function () {
        it('error message does not contain password', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.generateToAddress(1, 'bcrt1qtest')
                assert.fail('should throw')
            } catch(err) {
                assert.ok(!err.message.includes('sup3rs3cret'))
            }
        })
    })

    describe('getBalance does not leak credentials', function () {
        it('error message does not contain password', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.getBalance()
                assert.fail('should throw')
            } catch(err) {
                assert.ok(!err.message.includes('sup3rs3cret'))
            }
        })
    })

    describe('sendToAddress does not leak credentials', function () {
        it('throws clean error without password', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.sendToAddress('bcrt1qtest', 1.0)
                assert.fail('should throw')
            } catch(err) {
                assert.strictEqual(err.message, 'Error sending funds to address')
                assert.ok(!err.message.includes('sup3rs3cret'))
                assert.ok(!err.message.includes('admin'))
                assert.ok(!err.message.includes('10.0.0.5'))
            }
        })
    })

    describe('sendRawTransaction does not leak credentials', function () {
        it('throws clean error without password', async function () {
            axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'))
            try {
                await connector.sendRawTransaction('deadbeef')
                assert.fail('should throw')
            } catch(err) {
                assert.strictEqual(err.message, 'Error sending raw transaction')
                assert.ok(!err.message.includes('sup3rs3cret'))
                assert.ok(!err.message.includes('admin'))
            }
        })
    })

    // ─── Console output credential check ───────────────────────────────

    describe('console output never contains credentials', function () {
        const methods = [
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
                try {
                    await connector[name](...args)
                } catch(e) {}

                for (const call of [...console.error.getCalls(), ...console.log.getCalls()]) {
                    for (const arg of call.args) {
                        const str = typeof arg === 'string' ? arg : (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))
                        assert.ok(!str.includes('sup3rs3cret'), `${name} logged password via console`)
                    }
                }
            })
        }
    })
})
