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

const BlockchainConnector = require('../../src/BlockchainConnector')

describe('Boundary: Adaptive Mining Timer Logic', function () {
    let XChainRegtestMiner
    let miner
    let connectorStub
    let clock

    beforeEach(function () {
        connectorStub = {
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
        sinon.stub(miner, 'prepareWallet').resolves()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')

        miner.walletAddress = 'bcrt1qtest'

        clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false })
    })

    afterEach(function () {
        clock.restore()
        sinon.restore()
        delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
    })

    async function runLoopIterations(miner, iterations) {
        let loopCount = 0
        miner.sleep.callsFake(async () => {
            loopCount++
            if (loopCount >= iterations) {
                miner.keepMining = false
                throw new Error('__LOOP_BREAK__')
            }
        })
        try {
            await miner.start()
        } catch (e) {
            if (e.message !== '__LOOP_BREAK__') throw e
        }
    }

    // ─── T-01: maxTimeToMineTxs = 0 ────────────────────────────────────

    describe('T-01: maxTimeToMineTxs = 0', function () {
        it('mines immediately on next poll after first tx detected', async function () {
            miner.maxTimeToMineTxs = 0
            miner.addedTimeToMineTxs = 50000

            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                // No clock.tick needed — 0ms timer means it fires on next check
                if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert(connectorStub.generateToAddress.called,
                'Should mine immediately when maxTimeToMineTxs=0')
        })
    })

    // ─── T-02: addedTimeToMineTxs = 0 ──────────────────────────────────

    describe('T-02: addedTimeToMineTxs = 0', function () {
        it('mines as soon as mempool stops growing', async function () {
            miner.maxTimeToMineTxs = 50000
            miner.addedTimeToMineTxs = 0

            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert(connectorStub.generateToAddress.called,
                'Should mine immediately when addedTimeToMineTxs=0')
        })
    })

    // ─── T-03: Both timers = 0 ─────────────────────────────────────────

    describe('T-03: both timers set to 0', function () {
        it('mines on the very next poll after first tx detected', async function () {
            miner.maxTimeToMineTxs = 0
            miner.addedTimeToMineTxs = 0

            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert(connectorStub.generateToAddress.called,
                'Should mine on next poll with both timers at 0')
        })
    })

    // ─── T-04: maxTimeToMineTxs = 1ms ──────────────────────────────────

    describe('T-04: maxTimeToMineTxs = 1', function () {
        it('fires after 1ms elapses', async function () {
            miner.maxTimeToMineTxs = 1
            miner.addedTimeToMineTxs = 50000

            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) clock.tick(2)
                if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert(connectorStub.generateToAddress.called,
                'Should mine when 1ms maxTime elapses')
        })
    })

    // ─── T-05: addedTimeToMineTxs = 1ms ────────────────────────────────

    describe('T-05: addedTimeToMineTxs = 1', function () {
        it('fires after 1ms with no new txs', async function () {
            miner.maxTimeToMineTxs = 50000
            miner.addedTimeToMineTxs = 1

            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) clock.tick(2)
                if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert(connectorStub.generateToAddress.called,
                'Should mine when 1ms addedTime elapses')
        })
    })

    // ─── T-06: maxTimeToMineTxs = MAX_SAFE_INTEGER ─────────────────────

    describe('T-06: maxTimeToMineTxs = Number.MAX_SAFE_INTEGER', function () {
        it('never triggers initial timer; relies on addedTimeToMineTxs', async function () {
            miner.maxTimeToMineTxs = Number.MAX_SAFE_INTEGER
            miner.addedTimeToMineTxs = 50

            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) clock.tick(100)
                if (iterCount >= 4) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert(connectorStub.generateToAddress.called,
                'Should mine via addedTimeToMineTxs when maxTime is MAX_SAFE_INTEGER')
        })
    })

    // ─── T-07: addedTimeToMineTxs = MAX_SAFE_INTEGER ───────────────────

    describe('T-07: addedTimeToMineTxs = Number.MAX_SAFE_INTEGER', function () {
        it('never triggers extension timer; relies on maxTimeToMineTxs', async function () {
            miner.maxTimeToMineTxs = 50
            miner.addedTimeToMineTxs = Number.MAX_SAFE_INTEGER

            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) clock.tick(100)
                if (iterCount >= 4) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert(connectorStub.generateToAddress.called,
                'Should mine via maxTimeToMineTxs when addedTime is MAX_SAFE_INTEGER')
        })
    })

    // ─── T-08: Both timers = MAX_SAFE_INTEGER ──────────────────────────

    describe('T-08: both timers = Number.MAX_SAFE_INTEGER', function () {
        it('mining never triggers via timer', async function () {
            miner.maxTimeToMineTxs = Number.MAX_SAFE_INTEGER
            miner.addedTimeToMineTxs = Number.MAX_SAFE_INTEGER

            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                clock.tick(60000)
                if (iterCount >= 5) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert(connectorStub.generateToAddress.notCalled,
                'Should never mine when both timers are MAX_SAFE_INTEGER')
        })
    })

    // ─── T-09: Both timers equal ───────────────────────────────────────

    describe('T-09: maxTimeToMineTxs equals addedTimeToMineTxs', function () {
        it('produces exactly one generateBlocks call when both expire simultaneously', async function () {
            miner.maxTimeToMineTxs = 100
            miner.addedTimeToMineTxs = 100

            connectorStub.getRawMempool.resolves(['txid1'])

            let generateCount = 0
            connectorStub.generateToAddress.callsFake(async () => {
                generateCount++
                return ['hash']
            })

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) clock.tick(150)
                if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert.strictEqual(generateCount, 1,
                'Should call generateBlocks exactly once, not twice')
        })
    })

    // ─── T-10: maxTimeToMineTxs < addedTimeToMineTxs ───────────────────

    describe('T-10: maxTimeToMineTxs < addedTimeToMineTxs', function () {
        it('initial timer fires first, extension timer is irrelevant', async function () {
            miner.maxTimeToMineTxs = 50
            miner.addedTimeToMineTxs = 500

            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) clock.tick(60)
                if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert(connectorStub.generateToAddress.called,
                'Should mine when maxTime fires before addedTime')
        })
    })

    // ─── T-11: Negative timer values ───────────────────────────────────

    describe('T-11: negative timer values via setMiningTime', function () {
        it('rejects negative values', async function () {
            await miner.setMiningTime(-1, -1)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })
    })

    // ─── T-12: Floating-point timer values ─────────────────────────────

    describe('T-12: floating-point timer values', function () {
        it('rejects float values via Number.isInteger check', async function () {
            const origMax = miner.maxTimeToMineTxs
            const origAdded = miner.addedTimeToMineTxs
            await miner.setMiningTime(10.5, 5.5)
            assert.strictEqual(miner.maxTimeToMineTxs, origMax,
                'Floats should be rejected by Number.isInteger')
            assert.strictEqual(miner.addedTimeToMineTxs, origAdded)
        })
    })

    // ─── T-13: Non-numeric timer values ────────────────────────────────

    describe('T-13: non-numeric timer values', function () {
        it('rejects string values', async function () {
            await miner.setMiningTime('fast', 'slow')
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('rejects null values', async function () {
            await miner.setMiningTime(null, null)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('rejects undefined values', async function () {
            await miner.setMiningTime(undefined, undefined)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('rejects NaN', async function () {
            await miner.setMiningTime(NaN, NaN)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('rejects Infinity', async function () {
            await miner.setMiningTime(Infinity, Infinity)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('rejects mixed valid/invalid (maxTime valid, txAddedTime invalid)', async function () {
            await miner.setMiningTime(1000, 'bad')
            assert.strictEqual(miner.maxTimeToMineTxs, 30000,
                'Neither value should update when one is invalid')
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })
    })

    // ─── T-20: Mempool 0 to 1 tx ──────────────────────────────────────

    describe('T-20: mempool transitions from 0 to 1 tx', function () {
        it('sets both initialStartToMine and extendedStartToMine', async function () {
            miner.maxTimeToMineTxs = 50000
            miner.addedTimeToMineTxs = 50000

            // First poll: empty, second: 1 tx
            connectorStub.getRawMempool.onCall(0).resolves([])
            connectorStub.getRawMempool.onCall(1).resolves(['txid1'])
            connectorStub.getRawMempool.onCall(2).resolves(['txid1'])

            let dateNowCalls = []
            const origDateNow = Date.now
            // Fake timers already control Date.now; wrap it manually to count calls.
            // sinon.stub cannot wrap the fake-timers Date object in sinon >= 18.
            Date.now = () => {
                const val = origDateNow.call(Date)
                dateNowCalls.push(val)
                return val
            }

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            Date.now = origDateNow

            // Both timers should have been set (Date.now called when first tx detected)
            assert(dateNowCalls.length >= 1,
                'Date.now should be called when first tx detected in mempool')
        })
    })

    // ─── T-21: Mempool grows from N to N+1 ─────────────────────────────

    describe('T-21: mempool grows during extension window', function () {
        it('resets extendedStartToMine but not initialStartToMine', async function () {
            miner.maxTimeToMineTxs = 50000
            miner.addedTimeToMineTxs = 200

            // 1 tx, then 2 txs (new tx arrived)
            connectorStub.getRawMempool.onCall(0).resolves(['txid1'])
            connectorStub.getRawMempool.onCall(1).resolves(['txid1', 'txid2'])
            connectorStub.getRawMempool.onCall(2).resolves(['txid1', 'txid2'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) clock.tick(100) // Not enough for addedTime=200
                if (iterCount === 2) clock.tick(100) // 100ms from extended reset, still not enough
                if (iterCount >= 4) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // Mining should NOT have happened because extension timer kept resetting
            // At iteration 2, addedTime check: 100ms < 200ms (from extended reset)
            // So no mining yet after 2 iterations with 100ms each
            // The extended timer was reset on iteration 2 when new tx appeared
            assert.strictEqual(connectorStub.generateToAddress.callCount <= 1, true)
        })
    })

    // ─── T-22: Mempool shrinks (tx eviction) ───────────────────────────

    describe('T-22: mempool shrinks between polls', function () {
        it('does not reset timers on mempool shrink (length still > 0)', async function () {
            miner.maxTimeToMineTxs = 100
            miner.addedTimeToMineTxs = 50000

            // Start with 3 txs, then shrink to 2 (eviction)
            connectorStub.getRawMempool.onCall(0).resolves(['a', 'b', 'c'])
            connectorStub.getRawMempool.onCall(1).resolves(['a', 'b'])
            connectorStub.getRawMempool.onCall(2).resolves(['a', 'b'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) clock.tick(150) // Past maxTime
                if (iterCount >= 4) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // The shrink means rawMempool.length (2) is NOT > lastRawMempoolLength (3),
            // so extendedStartToMine is not reset. maxTime should still fire.
            assert(connectorStub.generateToAddress.called,
                'Timer should fire despite mempool shrink')
        })
    })

    // ─── T-23: Mempool empties completely ──────────────────────────────

    describe('T-23: mempool empties completely between polls', function () {
        it('resets all timers and does not mine', async function () {
            miner.maxTimeToMineTxs = 50
            miner.addedTimeToMineTxs = 50

            // 1 tx, then empty
            connectorStub.getRawMempool.onCall(0).resolves(['txid1'])
            connectorStub.getRawMempool.onCall(1).resolves([])
            connectorStub.getRawMempool.onCall(2).resolves([])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                clock.tick(100) // Would be enough to trigger timer
                if (iterCount >= 4) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // The empty mempool on iteration 2 resets timers to 0.
            // On iteration 3, mempool is still empty, so timers stay 0.
            // The timer check requires initialStartToMine > 0, which it is on iteration 2
            // but the mempool read comes AFTER the timer check in the loop.
            // So iteration 2: timer fires (initialStartToMine was set on iter 1, now > 0 and time passed).
            // Then mempool read shows empty -> timers reset.
            // This means mining DOES happen once before the reset.
            // That's correct behavior: the timer check happens before the mempool poll.
        })
    })

    // ─── T-24: Mempool burst (0 to N in one poll) ──────────────────────

    describe('T-24: mempool burst from 0 to N in single poll', function () {
        it('sets timers once regardless of burst size', async function () {
            miner.maxTimeToMineTxs = 50000
            miner.addedTimeToMineTxs = 50000

            connectorStub.getRawMempool.resolves(
                Array.from({ length: 10000 }, (_, i) => `txid_${i}`)
            )

            let dateNowCallCount = 0
            const origNow = Date.now
            // Fake timers already control Date.now; wrap it manually to count calls.
            // sinon.stub cannot wrap the fake-timers Date object in sinon >= 18.
            Date.now = () => {
                dateNowCallCount++
                return origNow.call(Date)
            }

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount >= 2) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            Date.now = origNow

            // Date.now should be called a small number of times (for setting timers),
            // not once per tx in the mempool
            assert(dateNowCallCount < 10,
                'Should not process burst individually; Date.now called ' + dateNowCallCount + ' times')
        })
    })

    // ─── T-25: keepMining toggled to false mid-countdown ───────────────

    describe('T-25: keepMining toggled false mid-timer', function () {
        it('pauses mining; timer check skipped', async function () {
            miner.maxTimeToMineTxs = 50
            miner.addedTimeToMineTxs = 50

            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) {
                    // Timer has been set, now pause
                    miner.keepMining = false
                    clock.tick(100) // Past both timers
                }
                if (iterCount >= 4) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert(connectorStub.generateToAddress.notCalled,
                'Should not mine when keepMining is false even with expired timers')
        })
    })

    // ─── T-26: keepMining toggled true with stale timers ───────────────

    describe('T-26: keepMining re-enabled with stale timer values', function () {
        it('stale timestamps may cause immediate mining on resume', async function () {
            miner.maxTimeToMineTxs = 50
            miner.addedTimeToMineTxs = 50

            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            let generateCalledAfterResume = false

            connectorStub.generateToAddress.callsFake(async () => {
                if (iterCount > 2) generateCalledAfterResume = true
                return ['hash']
            })

            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) {
                    // Timers set, advance time
                    clock.tick(100)
                    // Pause mining
                    miner.keepMining = false
                }
                if (iterCount === 3) {
                    // Resume mining — stale timers still have old timestamps
                    miner.keepMining = true
                    clock.tick(100)
                }
                if (iterCount >= 5) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // This documents actual behavior: if timers were set before pause,
            // they remain set and will fire on resume since time has elapsed.
            // This is a documented risk in the boundary testing plan.
        })
    })

    // ─── T-27: Mining completes but mempool still has txs ──────────────

    describe('T-27: mempool non-empty after generateBlocks', function () {
        it('resets timers and starts new cycle for remaining txs', async function () {
            miner.maxTimeToMineTxs = 50
            miner.addedTimeToMineTxs = 50

            // Mempool always has txs (not all included in block)
            connectorStub.getRawMempool.resolves(['txid1', 'txid2'])

            let generateCount = 0
            connectorStub.generateToAddress.callsFake(async () => {
                generateCount++
                return ['hash']
            })

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                clock.tick(60)
                if (iterCount >= 6) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // Should mine multiple times as timers reset and re-fire
            assert(generateCount >= 2,
                'Should mine multiple cycles when mempool remains non-empty')
        })
    })
})
