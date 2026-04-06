const assert = require('assert')
const sinon = require('sinon')

const BlockchainConnector = require('../../src/BlockchainConnector')

describe('Boundary: API Input Validation', function () {
    let XChainRegtestMiner
    let miner

    beforeEach(function () {
        const connectorStub = {
            getWalletInfo: sinon.stub().resolves({ walletname: 'w' }),
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
            getNetworkInfo: sinon.stub().resolves({}),
        }

        sinon.stub(BlockchainConnector.prototype, 'constructor')

        XChainRegtestMiner = require('../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        miner.connector = connectorStub

        sinon.stub(miner, 'sleep').resolves()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    afterEach(function () {
        sinon.restore()
        delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
    })

    // ═══════════════════════════════════════════════════════════════════
    // setMiningTime input boundaries
    // ═══════════════════════════════════════════════════════════════════

    describe('A-01: set_mining_time with both values = 0', function () {
        it('rejects zero for both timers', async function () {
            await miner.setMiningTime(0, 0)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })
    })

    describe('A-02: set_mining_time with negative integers', function () {
        it('rejects negative integers', async function () {
            await miner.setMiningTime(-1, -1)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('rejects large negative integers', async function () {
            await miner.setMiningTime(-999999, -999999)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })
    })

    describe('A-03: set_mining_time with floats', function () {
        it('rejects 1.5 and 2.7 (not integers)', async function () {
            await miner.setMiningTime(1.5, 2.7)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('rejects 0.1 (float close to zero)', async function () {
            await miner.setMiningTime(0.1, 0.1)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })
    })

    describe('A-04: set_mining_time with strings', function () {
        it('rejects string "abc" and "def"', async function () {
            await miner.setMiningTime('abc', 'def')
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('rejects numeric strings', async function () {
            await miner.setMiningTime('100', '200')
            assert.strictEqual(miner.maxTimeToMineTxs, 30000,
                'String "100" should be rejected by Number.isInteger')
        })
    })

    describe('A-05: set_mining_time with null and undefined', function () {
        it('rejects null values', async function () {
            await miner.setMiningTime(null, null)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })

        it('rejects undefined values', async function () {
            await miner.setMiningTime(undefined, undefined)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })
    })

    describe('A-06: set_mining_time with Number.MAX_SAFE_INTEGER', function () {
        it('rejects MAX_SAFE_INTEGER (exceeds max timer bound)', async function () {
            const result = await miner.setMiningTime(Number.MAX_SAFE_INTEGER, 5000)
            assert.ok(result && result.error)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })
    })

    describe('A-07: set_mining_time with Infinity', function () {
        it('rejects Infinity (not an integer)', async function () {
            await miner.setMiningTime(Infinity, Infinity)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('rejects -Infinity', async function () {
            await miner.setMiningTime(-Infinity, -Infinity)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })
    })

    describe('A-08: set_mining_time with only one value valid', function () {
        it('rejects both when maxTime is valid but txAddedTime is invalid', async function () {
            await miner.setMiningTime(1000, 'bad')
            assert.strictEqual(miner.maxTimeToMineTxs, 30000,
                'Both must be valid integers; partial update not allowed')
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('rejects both when maxTime is invalid but txAddedTime is valid', async function () {
            await miner.setMiningTime(null, 1000)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // setDefaultMiningTime boundaries
    // ═══════════════════════════════════════════════════════════════════

    describe('setDefaultMiningTime', function () {
        it('always resets to hardcoded defaults regardless of current values', async function () {
            miner.maxTimeToMineTxs = 0
            miner.addedTimeToMineTxs = 0
            await miner.setDefaultMiningTime()
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('resets from extreme values', async function () {
            miner.maxTimeToMineTxs = Number.MAX_SAFE_INTEGER
            miner.addedTimeToMineTxs = -1
            await miner.setDefaultMiningTime()
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // JSON-RPC controller: fill_mempool parameter boundaries
    // ═══════════════════════════════════════════════════════════════════

    describe('fill_mempool API controller boundaries', function () {
        let controller

        beforeEach(function () {
            const minerStub = {
                fillMempool: sinon.stub(),
            }

            controller = {
                async fill_mempool({ tx_quantity }) {
                    try {
                        await minerStub.fillMempool(tx_quantity)
                    } catch (err) {
                        return { error: 'There was a problem trying to fill mempool with ' + tx_quantity + ' transactions' }
                    }
                    return { result: 'ok' }
                },
                _miner: minerStub,
            }
        })

        it('A-10: passes tx_quantity=0 through to fillMempool', async function () {
            controller._miner.fillMempool.resolves()
            const result = await controller.fill_mempool({ tx_quantity: 0 })
            assert.deepStrictEqual(result, { result: 'ok' })
            assert(controller._miner.fillMempool.calledWith(0))
        })

        it('A-11: passes tx_quantity=-1 through (no validation in controller)', async function () {
            controller._miner.fillMempool.resolves()
            const result = await controller.fill_mempool({ tx_quantity: -1 })
            assert.deepStrictEqual(result, { result: 'ok' })
            assert(controller._miner.fillMempool.calledWith(-1))
        })

        it('A-12: passes tx_quantity=1 through', async function () {
            controller._miner.fillMempool.resolves()
            const result = await controller.fill_mempool({ tx_quantity: 1 })
            assert(controller._miner.fillMempool.calledWith(1))
        })

        it('A-14: passes tx_quantity=1.5 through (no type check)', async function () {
            controller._miner.fillMempool.resolves()
            await controller.fill_mempool({ tx_quantity: 1.5 })
            assert(controller._miner.fillMempool.calledWith(1.5))
        })

        it('A-15: passes tx_quantity="not_a_number" through (no type check)', async function () {
            controller._miner.fillMempool.resolves()
            await controller.fill_mempool({ tx_quantity: 'not_a_number' })
            assert(controller._miner.fillMempool.calledWith('not_a_number'))
        })

        it('A-16: passes undefined tx_quantity when missing', async function () {
            controller._miner.fillMempool.resolves()
            await controller.fill_mempool({})
            assert(controller._miner.fillMempool.calledWith(undefined))
        })

        it('returns error object when fillMempool throws', async function () {
            controller._miner.fillMempool.rejects(new Error('crash'))
            const result = await controller.fill_mempool({ tx_quantity: -1 })
            assert(result.error.includes('-1'))
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // JSON-RPC controller: send_funds parameter boundaries
    // ═══════════════════════════════════════════════════════════════════

    describe('send_funds API controller boundaries', function () {
        let controller

        beforeEach(function () {
            const minerStub = {
                sendFundsToAddress: sinon.stub(),
            }

            controller = {
                async send_funds({ address, amount }) {
                    let txid = null
                    try {
                        txid = await minerStub.sendFundsToAddress(address, amount)
                    } catch (err) {
                        return { error: 'There was a problem sending ' + amount + ' to ' + address }
                    }
                    return txid
                },
                _miner: minerStub,
            }
        })

        it('A-20: passes empty address and zero amount through', async function () {
            controller._miner.sendFundsToAddress.resolves('txid')
            await controller.send_funds({ address: '', amount: 0 })
            assert(controller._miner.sendFundsToAddress.calledWith('', 0))
        })

        it('A-21: passes minimum BTC amount (1 satoshi)', async function () {
            controller._miner.sendFundsToAddress.resolves('txid')
            await controller.send_funds({ address: 'bcrt1q...', amount: 0.00000001 })
            assert(controller._miner.sendFundsToAddress.calledWith('bcrt1q...', 0.00000001))
        })

        it('A-22: passes sub-satoshi amount through (no validation)', async function () {
            controller._miner.sendFundsToAddress.resolves('txid')
            await controller.send_funds({ address: 'bcrt1q...', amount: 0.000000001 })
            assert(controller._miner.sendFundsToAddress.calledWith('bcrt1q...', 0.000000001))
        })

        it('A-23: passes total supply amount through', async function () {
            controller._miner.sendFundsToAddress.resolves('txid')
            await controller.send_funds({ address: 'bcrt1q...', amount: 21000000 })
            assert(controller._miner.sendFundsToAddress.calledWith('bcrt1q...', 21000000))
        })

        it('A-24: passes negative amount through (no validation)', async function () {
            controller._miner.sendFundsToAddress.resolves('txid')
            await controller.send_funds({ address: 'bcrt1q...', amount: -1 })
            assert(controller._miner.sendFundsToAddress.calledWith('bcrt1q...', -1))
        })

        it('A-25: returns error for invalid address (when node rejects)', async function () {
            controller._miner.sendFundsToAddress.rejects(new Error('Invalid address'))
            const result = await controller.send_funds({ address: 'invalid', amount: 1 })
            assert(result.error.includes('invalid'))
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // JSON-RPC controller: set_mining_time parameter boundaries
    // ═══════════════════════════════════════════════════════════════════

    describe('set_mining_time API controller boundaries', function () {
        let controller

        beforeEach(function () {
            const minerStub = {
                setMiningTime: sinon.stub().resolves(),
            }

            controller = {
                async set_mining_time({ max_time, tx_added_time }) {
                    try {
                        await minerStub.setMiningTime(max_time, tx_added_time)
                    } catch (err) {
                        return { error: 'There was a problem trying to set a new time to mine blocks' }
                    }
                    return { result: 'ok' }
                },
                _miner: minerStub,
            }
        })

        it('passes zero values through', async function () {
            await controller.set_mining_time({ max_time: 0, tx_added_time: 0 })
            assert(controller._miner.setMiningTime.calledWith(0, 0))
        })

        it('passes negative values through', async function () {
            await controller.set_mining_time({ max_time: -1, tx_added_time: -1 })
            assert(controller._miner.setMiningTime.calledWith(-1, -1))
        })

        it('passes null through when parameters missing', async function () {
            await controller.set_mining_time({})
            assert(controller._miner.setMiningTime.calledWith(undefined, undefined))
        })

        it('always returns ok (validation happens in setMiningTime)', async function () {
            const result = await controller.set_mining_time({ max_time: 'bad', tx_added_time: 'bad' })
            assert.deepStrictEqual(result, { result: 'ok' },
                'Controller returns ok; setMiningTime silently rejects invalid values')
        })
    })
})
