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

    // ─── setMiningTime with arbitrary values ────────────────────────

    // setMiningTime throws (rather than silently no-opping) on invalid input
    // as of uuid:24c35056: a returned {error} sentinel let the api.js controller
    // report "ok" on rejected input. These property tests assert the new
    // throw-on-invalid / resolve-on-valid contract.
    describe('setMiningTime with arbitrary values', function () {
        it('only accepts positive integers within bounds; rejects (throws) otherwise', async function () {
            const MIN = 1000
            const MAX = 3600000
            await fc.assert(
                fc.asyncProperty(fc.anything(), fc.anything(), async (maxTime, txAddedTime) => {
                    const origMax = miner.maxTimeToMineTxs
                    const origAdded = miner.addedTimeToMineTxs

                    const isValid = Number.isInteger(maxTime) && Number.isInteger(txAddedTime) &&
                        maxTime >= MIN && maxTime <= MAX && txAddedTime >= MIN && txAddedTime <= MAX

                    if (isValid) {
                        await miner.setMiningTime(maxTime, txAddedTime)
                        assert.strictEqual(miner.maxTimeToMineTxs, maxTime)
                        assert.strictEqual(miner.addedTimeToMineTxs, txAddedTime)
                    } else {
                        await assert.rejects(() => miner.setMiningTime(maxTime, txAddedTime))
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

        it('never crashes the process regardless of input types (including non-stringifiable objects)', async function () {
            await fc.assert(
                fc.asyncProperty(fc.anything(), fc.anything(), async (maxTime, txAddedTime) => {
                    // String() wrapping in the console.log path prevents a TypeError
                    // from a non-callable toString; the call settles either by
                    // resolving (valid input) or by throwing our own Error (invalid
                    // input), never by an unrelated crash.
                    try {
                        await miner.setMiningTime(maxTime, txAddedTime)
                    } catch (err) {
                        assert.ok(err instanceof Error)
                    }
                    miner.maxTimeToMineTxs = 30000
                    miner.addedTimeToMineTxs = 5000
                }),
                { numRuns: 1000 }
            )
        })

        it('handles objects with non-callable toString by throwing our own Error, not a TypeError', async function () {
            // Previously this caused an unrelated TypeError; String() wrapping fixed
            // that, and invalid input now throws our own descriptive Error.
            await assert.rejects(() => miner.setMiningTime({ toString: 0 }, {}), /Invalid mining times/)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })
    })

    // ─── Integer boundary values ────────────────────────────────────

    describe('setMiningTime integer edge cases', function () {
        const acceptedCases = [
            [1000, 1000],               // MIN boundary
            [3600000, 3600000],          // MAX boundary
            [30000, 5000],              // defaults
            [1000, 3600000],            // min/max mix
            [3600000, 1000],            // max/min mix
        ]

        for (const [maxTime, txAddedTime] of acceptedCases) {
            it(`accepts (${maxTime}, ${txAddedTime}) without throwing`, async function () {
                await miner.setMiningTime(maxTime, txAddedTime)
                assert.strictEqual(miner.maxTimeToMineTxs, maxTime)
                assert.strictEqual(miner.addedTimeToMineTxs, txAddedTime)
            })
        }

        const rejectedEdgeCases = [
            [0, 0],
            [-1, -1],
            [-2147483648, -2147483648],  // INT32_MIN
            [Number.MIN_SAFE_INTEGER, Number.MIN_SAFE_INTEGER],
            [0, Number.MAX_SAFE_INTEGER],
            [Number.MAX_SAFE_INTEGER, 0],
            [-1, 1000],
            [1000, -1],
            [1, 1],                       // below MIN_MINING_TIME
            [999, 999],                   // just below MIN_MINING_TIME
            [3600001, 3600001],           // just above MAX_MINING_TIME
            [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER], // way above MAX_MINING_TIME
        ]

        for (const [maxTime, txAddedTime] of rejectedEdgeCases) {
            it(`rejects (${maxTime}, ${txAddedTime}) and preserves defaults`, async function () {
                await assert.rejects(() => miner.setMiningTime(maxTime, txAddedTime))
                assert.strictEqual(miner.maxTimeToMineTxs, 30000)
                assert.strictEqual(miner.addedTimeToMineTxs, 5000)
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
                await assert.rejects(() => miner.setMiningTime(maxTime, txAddedTime))
                assert.strictEqual(miner.maxTimeToMineTxs, 30000)
                assert.strictEqual(miner.addedTimeToMineTxs, 5000)
            })
        }
    })

    // ─── setDefaultMiningTime always restores defaults ──────────────

    describe('setDefaultMiningTime after arbitrary setMiningTime', function () {
        it('always restores defaults regardless of prior state', async function () {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: 1 }),
                    fc.integer({ min: 1 }),
                    async (maxTime, txAddedTime) => {
                        // maxTime/txAddedTime may fall outside [MIN_MINING_TIME,
                        // MAX_MINING_TIME] and throw; setDefaultMiningTime() must
                        // still restore defaults either way.
                        try {
                            await miner.setMiningTime(maxTime, txAddedTime)
                        } catch (err) {
                            assert.ok(err instanceof Error)
                        }
                        await miner.setDefaultMiningTime()
                        assert.strictEqual(miner.maxTimeToMineTxs, 30000)
                        assert.strictEqual(miner.addedTimeToMineTxs, 5000)
                    }
                ),
                { numRuns: 500 }
            )
        })
    })

    // ─── Rapid sequential setMiningTime calls ───────────────────────

    describe('rapid sequential setMiningTime calls', function () {
        it('last valid write wins with random positive integer sequences', async function () {
            await fc.assert(
                fc.asyncProperty(
                    fc.array(fc.tuple(fc.integer({ min: 1000, max: 3600000 }), fc.integer({ min: 1000, max: 3600000 })), { minLength: 1, maxLength: 50 }),
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

    // ─── Zero/negative timers now rejected ──────────────────────────

    describe('zero/negative timers are rejected', function () {
        it('setMiningTime(0, 5000) is rejected', async function () {
            await assert.rejects(() => miner.setMiningTime(0, 5000))
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('setMiningTime(-1000, -1000) is rejected', async function () {
            await assert.rejects(() => miner.setMiningTime(-1000, -1000))
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('setMiningTime(1, 0) is rejected (both must be positive)', async function () {
            await assert.rejects(() => miner.setMiningTime(1, 0))
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })
    })
})
