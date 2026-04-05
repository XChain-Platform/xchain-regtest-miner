const assert = require('assert')
const sinon = require('sinon')
const fc = require('fast-check')
const BlockchainConnector = require('../../src/BlockchainConnector')

describe('Fuzz: mining timer parameters', function () {
    let XChainRegtestMiner
    let miner
    let connectorStub

    beforeEach(function () {
        connectorStub = {
            getWalletInfo: sinon.stub().resolves({ walletname: 'test' }),
            loadWallet: sinon.stub().resolves(),
            createWallet: sinon.stub().resolves(),
            getNewAddress: sinon.stub().resolves('bcrt1qtest'),
            getBalance: sinon.stub().resolves(50.0),
            getBlockchainInfo: sinon.stub().resolves({ blocks: 200 }),
            generateToAddress: sinon.stub().resolves(['blockhash1']),
            getRawMempool: sinon.stub().resolves([]),
            sendToAddress: sinon.stub().resolves('txid_abc'),
            getRawTransaction: sinon.stub().resolves('0200000001'),
            sendRawTransaction: sinon.stub().resolves('txid_sent'),
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

    // ─── setMiningTime with arbitrary integers ──────────────────────

    describe('setMiningTime with arbitrary integers', function () {
        it('only accepts values that pass Number.isInteger', async function () {
            await fc.assert(
                fc.asyncProperty(fc.anything(), fc.anything(), async (maxTime, txAddedTime) => {
                    const origMax = miner.maxTimeToMineTxs
                    const origAdded = miner.addedTimeToMineTxs

                    try {
                        await miner.setMiningTime(maxTime, txAddedTime)
                    } catch (e) {
                        // KNOWN BUG: line 60 in XChainRegtestMiner.js uses string
                        // concatenation to log invalid values. Objects with overridden
                        // toString (e.g. {toString: 0}) cause TypeError when the +
                        // operator tries to convert them to primitives.
                        assert.ok(e instanceof TypeError,
                            'Only TypeError is acceptable from setMiningTime')
                        // State should be unchanged since the error is in the else branch
                        assert.strictEqual(miner.maxTimeToMineTxs, origMax)
                        assert.strictEqual(miner.addedTimeToMineTxs, origAdded)
                        miner.maxTimeToMineTxs = 30000
                        miner.addedTimeToMineTxs = 5000
                        return
                    }

                    if (Number.isInteger(maxTime) && Number.isInteger(txAddedTime)) {
                        assert.strictEqual(miner.maxTimeToMineTxs, maxTime)
                        assert.strictEqual(miner.addedTimeToMineTxs, txAddedTime)
                    } else {
                        assert.strictEqual(miner.maxTimeToMineTxs, origMax)
                        assert.strictEqual(miner.addedTimeToMineTxs, origAdded)
                    }

                    // Reset for next iteration
                    miner.maxTimeToMineTxs = 30000
                    miner.addedTimeToMineTxs = 5000
                }),
                { numRuns: 1000 }
            )
        })

        it('throws TypeError for objects with non-callable toString (known bug)', async function () {
            // Counterexample found by fuzzer: {toString: 0} passed as maxTime or txAddedTime
            // The else branch at line 60 does string concatenation which invokes toString()
            // on the value, but toString is 0 (not a function) → TypeError
            await assert.rejects(
                () => miner.setMiningTime({ toString: 0 }, {}),
                TypeError
            )
            // Verify state was not corrupted
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('does not throw for primitive types', async function () {
            await fc.assert(
                fc.asyncProperty(
                    fc.oneof(fc.integer(), fc.double(), fc.string(), fc.boolean(), fc.constant(null), fc.constant(undefined)),
                    fc.oneof(fc.integer(), fc.double(), fc.string(), fc.boolean(), fc.constant(null), fc.constant(undefined)),
                    async (maxTime, txAddedTime) => {
                        // Primitive types should never throw — they all have working toString
                        await miner.setMiningTime(maxTime, txAddedTime)
                        miner.maxTimeToMineTxs = 30000
                        miner.addedTimeToMineTxs = 5000
                    }
                ),
                { numRuns: 1000 }
            )
        })
    })

    // ─── Integer boundary values ────────────────────────────────────

    describe('setMiningTime integer edge cases', function () {
        const edgeCases = [
            [0, 0],
            [-1, -1],
            [1, 1],
            [-2147483648, -2147483648],  // INT32_MIN
            [2147483647, 2147483647],    // INT32_MAX
            [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
            [Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
            [0, Number.MAX_SAFE_INTEGER],
            [Number.MAX_SAFE_INTEGER, 0],
            [-1, 1],
            [1, -1],
        ]

        for (const [maxTime, txAddedTime] of edgeCases) {
            it(`accepts (${maxTime}, ${txAddedTime}) without throwing`, async function () {
                await miner.setMiningTime(maxTime, txAddedTime)
                assert.strictEqual(miner.maxTimeToMineTxs, maxTime)
                assert.strictEqual(miner.addedTimeToMineTxs, txAddedTime)
            })
        }
    })

    // ─── Non-integer rejection ──────────────────────────────────────

    describe('setMiningTime rejects non-integers', function () {
        const rejectedCases = [
            [1.5, 1],
            [1, 1.5],
            [NaN, 1],
            [1, NaN],
            [Infinity, 1],
            [1, Infinity],
            [-Infinity, 1],
            ['1000', 1000],
            [1000, '1000'],
            [null, 1],
            [1, null],
            [undefined, 1],
            [true, 1],
            [false, 0],
            [{}, 1],
            [[], 1],
        ]

        for (const [maxTime, txAddedTime] of rejectedCases) {
            it(`rejects (${JSON.stringify(maxTime)}, ${JSON.stringify(txAddedTime)}) and preserves defaults`, async function () {
                await miner.setMiningTime(maxTime, txAddedTime)
                assert.strictEqual(miner.maxTimeToMineTxs, 30000)
                assert.strictEqual(miner.addedTimeToMineTxs, 5000)
            })
        }
    })

    // ─── setDefaultMiningTime always restores defaults ──────────────

    describe('setDefaultMiningTime after arbitrary setMiningTime', function () {
        it('always restores defaults regardless of prior state', async function () {
            await fc.assert(
                fc.asyncProperty(fc.integer(), fc.integer(), async (maxTime, txAddedTime) => {
                    await miner.setMiningTime(maxTime, txAddedTime)
                    await miner.setDefaultMiningTime()
                    assert.strictEqual(miner.maxTimeToMineTxs, 30000)
                    assert.strictEqual(miner.addedTimeToMineTxs, 5000)
                }),
                { numRuns: 500 }
            )
        })
    })

    // ─── Rapid sequential setMiningTime calls ───────────────────────

    describe('rapid sequential setMiningTime calls', function () {
        it('last write wins with random integer sequences', async function () {
            await fc.assert(
                fc.asyncProperty(
                    fc.array(fc.tuple(fc.integer(), fc.integer()), { minLength: 1, maxLength: 50 }),
                    async (pairs) => {
                        for (const [maxTime, txAddedTime] of pairs) {
                            await miner.setMiningTime(maxTime, txAddedTime)
                        }
                        const [lastMax, lastAdded] = pairs[pairs.length - 1]
                        assert.strictEqual(miner.maxTimeToMineTxs, lastMax)
                        assert.strictEqual(miner.addedTimeToMineTxs, lastAdded)

                        // Reset
                        miner.maxTimeToMineTxs = 30000
                        miner.addedTimeToMineTxs = 5000
                    }
                ),
                { numRuns: 200 }
            )
        })
    })

    // ─── Timer values and mining loop interaction ───────────────────

    describe('zero/negative timers trigger immediate mining', function () {
        it('maxTimeToMineTxs=0 causes mining on first mempool check with txs', async function () {
            const clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false })

            await miner.setMiningTime(0, 5000)
            miner.keepMining = true

            // Simulate: mempool has 1 tx
            connectorStub.getRawMempool.resolves(['txid1'])

            let loopCount = 0
            let generateCalled = false
            connectorStub.generateToAddress.callsFake(async () => {
                generateCalled = true
                return ['blockhash']
            })

            miner.sleep.callsFake(async () => {
                loopCount++
                // After first iteration sets timestamps, advance time by 1ms
                // so initialTimePassed >= 0 is true
                clock.tick(1)
                if (loopCount >= 3) {
                    miner.keepMining = false
                    throw new Error('__LOOP_BREAK__')
                }
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert.ok(generateCalled, 'generateToAddress should have been called with maxTime=0')
            clock.restore()
        })

        it('negative timers cause mining on first mempool check with txs', async function () {
            const clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false })

            await miner.setMiningTime(-1000, -1000)
            miner.keepMining = true

            connectorStub.getRawMempool.resolves(['txid1'])

            let generateCalled = false
            connectorStub.generateToAddress.callsFake(async () => {
                generateCalled = true
                return ['blockhash']
            })

            let loopCount = 0
            miner.sleep.callsFake(async () => {
                loopCount++
                clock.tick(1)
                if (loopCount >= 3) {
                    miner.keepMining = false
                    throw new Error('__LOOP_BREAK__')
                }
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert.ok(generateCalled, 'generateToAddress should have been called with negative timers')
            clock.restore()
        })
    })
})
