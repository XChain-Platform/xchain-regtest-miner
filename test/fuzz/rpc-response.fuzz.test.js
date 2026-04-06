const assert = require('assert')
const sinon = require('sinon')
const fc = require('fast-check')
const BlockchainConnector = require('../../src/BlockchainConnector')

describe('Fuzz: RPC response handling', function () {
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

    // Helper to run mining loop for N iterations then break
    async function runLoopIterations(miner, iterations) {
        let loopCount = 0
        miner.sleep.callsFake(async () => {
            loopCount++
            if (loopCount >= iterations) {
                miner.keepMining = false
                throw new Error('__LOOP_BREAK__')
            }
        })
        try { await miner.start() } catch (e) {
            if (e.message !== '__LOOP_BREAK__') throw e
        }
    }

    // ─── getRawMempool response fuzzing ─────────────────────────────

    describe('getRawMempool returns unexpected types', function () {
        const fuzzedResponses = [
            ['null', null],
            ['undefined', undefined],
            ['empty string', ''],
            ['number zero', 0],
            ['boolean false', false],
            ['boolean true', true],
            ['empty object', {}],
            ['string array-like', '["txid1"]'],
            ['number', 42],
            ['nested array', [['txid1']]],
        ]

        for (const [label, response] of fuzzedResponses) {
            it(`survives getRawMempool returning ${label}`, async function () {
                connectorStub.getRawMempool.resolves(response)
                // Should not crash — loop should continue gracefully
                await runLoopIterations(miner, 3)
            })
        }

        it('survives getRawMempool returning random values', async function () {
            await fc.assert(
                fc.asyncProperty(fc.anything(), async (response) => {
                    connectorStub.getRawMempool.resolves(response)
                    let loopCount = 0
                    miner.sleep.callsFake(async () => {
                        loopCount++
                        if (loopCount >= 2) {
                            miner.keepMining = false
                            throw new Error('__LOOP_BREAK__')
                        }
                    })
                    try { await miner.start() } catch (e) {
                        if (e.message !== '__LOOP_BREAK__') throw e
                    }
                }),
                { numRuns: 100 }
            )
        })
    })

    describe('getRawMempool throws errors', function () {
        it('survives random error messages', async function () {
            await fc.assert(
                fc.asyncProperty(fc.string(), async (errorMsg) => {
                    connectorStub.getRawMempool.rejects(new Error(errorMsg))
                    let loopCount = 0
                    miner.sleep.callsFake(async () => {
                        loopCount++
                        if (loopCount >= 2) {
                            miner.keepMining = false
                            throw new Error('__LOOP_BREAK__')
                        }
                    })
                    try { await miner.start() } catch (e) {
                        if (e.message !== '__LOOP_BREAK__') throw e
                    }
                }),
                { numRuns: 100 }
            )
        })

        it('survives non-Error throws', async function () {
            const throwValues = [null, undefined, 42, 'string error', { code: 500 }, ['arr']]
            for (const val of throwValues) {
                connectorStub.getRawMempool.rejects(val)
                await runLoopIterations(miner, 2)
            }
        })
    })

    describe('getRawMempool with invalid txid entries', function () {
        it('handles arrays with non-string elements', async function () {
            const fuzzedArrays = [
                [null],
                [undefined],
                [42],
                [true],
                [{}],
                [[]],
                [null, 'valid_txid', undefined],
                ['', '', ''],
            ]

            for (const arr of fuzzedArrays) {
                connectorStub.getRawMempool.resolves(arr)
                // The mining loop only checks .length, doesn't inspect elements
                // So these should all trigger mining timer logic without crash
                await runLoopIterations(miner, 3)
            }
        })

        it('handles extremely large mempool arrays', async function () {
            // Array of 10000 fake txids
            const largeMempoolArray = Array.from({ length: 10000 }, (_, i) => 'txid_' + i)
            connectorStub.getRawMempool.resolves(largeMempoolArray)
            await runLoopIterations(miner, 3)
        })
    })

    // ─── getRawMempool size fluctuations ─────────────────────────────

    describe('getRawMempool fluctuating sizes', function () {
        it('handles mempool growing then shrinking', async function () {
            let callCount = 0
            connectorStub.getRawMempool.callsFake(async () => {
                callCount++
                if (callCount <= 2) return ['tx1', 'tx2', 'tx3']
                if (callCount <= 4) return ['tx1']
                return []
            })
            await runLoopIterations(miner, 6)
        })

        it('handles rapid empty/full alternation', async function () {
            let callCount = 0
            connectorStub.getRawMempool.callsFake(async () => {
                callCount++
                return callCount % 2 === 0 ? ['tx1'] : []
            })
            await runLoopIterations(miner, 10)
        })

        it('handles random mempool sizes', async function () {
            await fc.assert(
                fc.asyncProperty(
                    fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 3, maxLength: 10 }),
                    async (sizes) => {
                        let callIdx = 0
                        connectorStub.getRawMempool.callsFake(async () => {
                            const size = sizes[callIdx % sizes.length]
                            callIdx++
                            return Array.from({ length: size }, (_, i) => 'tx_' + i)
                        })

                        let loopCount = 0
                        miner.sleep.callsFake(async () => {
                            loopCount++
                            if (loopCount >= sizes.length + 1) {
                                miner.keepMining = false
                                throw new Error('__LOOP_BREAK__')
                            }
                        })
                        try { await miner.start() } catch (e) {
                            if (e.message !== '__LOOP_BREAK__') throw e
                        }
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    // ─── generateToAddress response fuzzing ──────────────────────────

    describe('generateToAddress returns unexpected values', function () {
        it('survives generateToAddress throwing for various errors', async function () {
            const clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false })

            // Set very short timers so mining triggers quickly
            miner.maxTimeToMineTxs = 1
            miner.addedTimeToMineTxs = 1

            connectorStub.getRawMempool.resolves(['txid1'])
            connectorStub.generateToAddress.rejects(new Error('block generation failed'))

            let loopCount = 0
            miner.sleep.callsFake(async () => {
                loopCount++
                clock.tick(10)
                if (loopCount >= 5) {
                    miner.keepMining = false
                    throw new Error('__LOOP_BREAK__')
                }
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // Mining loop should have continued despite generateToAddress failures
            assert.ok(loopCount >= 2, 'Loop should have continued after generate failure')
            clock.restore()
        })
    })

    // ─── getBalance response fuzzing ────────────────────────────────

    describe('getBalance returns edge-case values during prepareWallet', function () {
        const balanceEdgeCases = [
            ['exactly zero', 0],
            ['negative', -1],
            ['very small positive', 0.00000001],
            ['very large', 999999999],
        ]

        for (const [label, balance] of balanceEdgeCases) {
            it(`handles getBalance returning ${label}`, async function () {
                connectorStub.getBalance.resolves(balance)

                let loopCount = 0
                miner.sleep.callsFake(async () => {
                    loopCount++
                    if (loopCount >= 2) {
                        miner.keepMining = false
                        throw new Error('__LOOP_BREAK__')
                    }
                })

                try { await miner.start() } catch (e) {
                    if (e.message !== '__LOOP_BREAK__') throw e
                }

                if (balance <= 0) {
                    // Should have tried to mine initial blocks
                    assert.ok(connectorStub.generateToAddress.called,
                        'Should mine blocks when balance <= 0')
                }
            })
        }
    })

    // ─── getBlockchainInfo response fuzzing ──────────────────────────

    describe('getBlockchainInfo returns unexpected values during prepareWallet', function () {
        it('handles missing blocks field', async function () {
            connectorStub.getBalance.resolves(0)
            connectorStub.getBlockchainInfo.resolves({})

            let loopCount = 0
            miner.sleep.callsFake(async () => {
                loopCount++
                if (loopCount >= 2) {
                    miner.keepMining = false
                    throw new Error('__LOOP_BREAK__')
                }
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // blocks=undefined, so blocks<=100 is false (undefined<=100 is false)
            // Should mine 1 block (the else branch)
            assert.ok(connectorStub.generateToAddress.called)
        })

        it('handles blocks field as various types', async function () {
            const cases = [null, undefined, 'abc', -1, 0, 50, 100, 101, NaN, Infinity]

            for (const blocksValue of cases) {
                connectorStub.getBalance.resolves(0)
                connectorStub.getBlockchainInfo.resolves({ blocks: blocksValue })
                connectorStub.generateToAddress.resetHistory()

                let loopCount = 0
                miner.sleep.callsFake(async () => {
                    loopCount++
                    if (loopCount >= 2) {
                        miner.keepMining = false
                        throw new Error('__LOOP_BREAK__')
                    }
                })

                try { await miner.start() } catch (e) {
                    if (e.message !== '__LOOP_BREAK__') throw e
                }
            }
        })
    })

    // ─── getWalletInfo / wallet setup fuzzing ───────────────────────

    describe('wallet setup with fuzzed responses', function () {
        it('handles getWalletInfo throwing then loadWallet succeeding', async function () {
            connectorStub.getWalletInfo.rejects(new Error('no wallet'))
            connectorStub.loadWallet.resolves({ name: 'test' })

            let loopCount = 0
            miner.sleep.callsFake(async () => {
                loopCount++
                if (loopCount >= 2) {
                    miner.keepMining = false
                    throw new Error('__LOOP_BREAK__')
                }
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert.ok(connectorStub.loadWallet.calledOnce)
            assert.ok(connectorStub.createWallet.notCalled)
        })

        it('handles getWalletInfo throwing and loadWallet throwing', async function () {
            connectorStub.getWalletInfo.rejects(new Error('no wallet'))
            connectorStub.loadWallet.rejects(new Error('no file'))

            let loopCount = 0
            miner.sleep.callsFake(async () => {
                loopCount++
                if (loopCount >= 2) {
                    miner.keepMining = false
                    throw new Error('__LOOP_BREAK__')
                }
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert.ok(connectorStub.createWallet.calledOnce)
        })

        it('handles getWalletInfo returning null', async function () {
            connectorStub.getWalletInfo.resolves(null)

            let loopCount = 0
            miner.sleep.callsFake(async () => {
                loopCount++
                if (loopCount >= 2) {
                    miner.keepMining = false
                    throw new Error('__LOOP_BREAK__')
                }
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // null walletInfo triggers wallet load/create path
            assert.ok(connectorStub.loadWallet.called || connectorStub.createWallet.called)
        })
    })

    // ─── sendFundsToAddress response fuzzing ────────────────────────

    describe('sendFundsToAddress with arbitrary inputs', function () {
        it('passes through valid address and amount to connector', async function () {
            await fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 1 }),
                    fc.double({ min: 0.00000001, max: 1e8, noNaN: true }),
                    async (address, amount) => {
                        connectorStub.sendToAddress.resolves('txid_ok')
                        const result = await miner.sendFundsToAddress(address, amount)
                        assert.strictEqual(result, 'txid_ok')
                        assert.ok(connectorStub.sendToAddress.calledWith(address, amount))
                        connectorStub.sendToAddress.resetHistory()
                    }
                ),
                { numRuns: 200 }
            )
        })

        it('rejects invalid inputs without reaching connector', async function () {
            await fc.assert(
                fc.asyncProperty(fc.anything(), fc.anything(), async (address, amount) => {
                    const isValidAddr = typeof address === 'string' && address.length > 0
                    const isValidAmt = typeof amount === 'number' && isFinite(amount) && amount > 0
                    if (!isValidAddr || !isValidAmt) {
                        connectorStub.sendToAddress.resetHistory()
                        try {
                            await miner.sendFundsToAddress(address, amount)
                        } catch(e) {
                            assert.ok(e.message.includes('Invalid'))
                        }
                        assert.strictEqual(connectorStub.sendToAddress.callCount, 0)
                    }
                    connectorStub.sendToAddress.resetHistory()
                }),
                { numRuns: 200 }
            )
        })

        it('propagates connector errors for valid inputs', async function () {
            connectorStub.sendToAddress.rejects(new Error('insufficient funds'))
            await assert.rejects(
                () => miner.sendFundsToAddress('addr', 1),
                /insufficient funds/
            )
        })
    })
})
