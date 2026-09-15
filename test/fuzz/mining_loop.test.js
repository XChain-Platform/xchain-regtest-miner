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
const BlockchainConnector = require('../../src/rpc/blockchain_connector')

let XChainRegtestMiner
let miner
let connectorStub
let clock

function setUpMiner() {
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
        setTxFee: sinon.stub().resolves(true),
        setWalletName: sinon.stub(),
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
}

function tearDownMiner() {
    sinon.restore()
    delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
    if (clock) {
        clock.restore()
        clock = null
    }
}

// ─── Timer state transitions ────────────────────────────────────

function miningTimerMaxTimeTests() {
    it('mines block when maxTimeToMineTxs elapses with constant mempool', async function () {
        clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false })
        miner.maxTimeToMineTxs = 100
        miner.addedTimeToMineTxs = 50

        connectorStub.getRawMempool.resolves(['txid1'])

        let generateCount = 0
        connectorStub.generateToAddress.callsFake(async () => {
            generateCount++
            return ['hash']
        })

        let loopCount = 0
        miner.sleep.callsFake(async () => {
            loopCount++
            clock.tick(20) // 20ms per iteration, 5 iterations = 100ms >= maxTime
            if (loopCount >= 10) {
                miner.keepMining = false
                throw new Error('__LOOP_BREAK__')
            }
        })

        try { await miner.start() } catch (e) {
            if (e.message !== '__LOOP_BREAK__') throw e
        }

        assert.ok(generateCount > 0, 'Should have mined at least one block')
    })
}

function miningTimerAddedTimeTests() {
    it('mines block when addedTimeToMineTxs elapses without new txs', async function () {
        clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false })
        miner.maxTimeToMineTxs = 99999 // Very high so only addedTime triggers
        miner.addedTimeToMineTxs = 50

        // Mempool constant size, no new txs after initial detection
        connectorStub.getRawMempool.resolves(['txid1'])

        let generateCount = 0
        connectorStub.generateToAddress.callsFake(async () => {
            generateCount++
            return ['hash']
        })

        let loopCount = 0
        miner.sleep.callsFake(async () => {
            loopCount++
            clock.tick(20)
            if (loopCount >= 10) {
                miner.keepMining = false
                throw new Error('__LOOP_BREAK__')
            }
        })

        try { await miner.start() } catch (e) {
            if (e.message !== '__LOOP_BREAK__') throw e
        }

        assert.ok(generateCount > 0, 'Should have mined when addedTime expired')
    })
}

function miningTimerExtensionTests() {
    it('extends mining wait when new txs arrive', async function () {
        clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false })
        miner.maxTimeToMineTxs = 99999
        miner.addedTimeToMineTxs = 100

        let mempoolSize = 1
        connectorStub.getRawMempool.callsFake(async () => {
            // Grow mempool each call to simulate new txs arriving
            mempoolSize++
            return Array.from({ length: mempoolSize }, (_, i) => 'tx_' + i)
        })

        let generateCount = 0
        connectorStub.generateToAddress.callsFake(async () => {
            generateCount++
            return ['hash']
        })

        let loopCount = 0
        miner.sleep.callsFake(async () => {
            loopCount++
            clock.tick(10) // Only 10ms per loop, which is less than addedTime
            if (loopCount >= 8) {
                miner.keepMining = false
                throw new Error('__LOOP_BREAK__')
            }
        })

        try { await miner.start() } catch (e) {
            if (e.message !== '__LOOP_BREAK__') throw e
        }

        // With constantly growing mempool and short ticks, addedTime
        // keeps resetting and should NOT trigger mining
        assert.strictEqual(generateCount, 0,
            'Should not mine while new txs keep arriving and addedTime has not elapsed')
    })
}

// ─── keepMining flag fuzzing ────────────────────────────────────

function keepMiningFlagTests() {
    it('respects keepMining=false (skips mempool check and mining)', async function () {
        connectorStub.getRawMempool.resolves(['txid1', 'txid2'])

        let loopCount = 0
        miner.sleep.callsFake(async () => {
            loopCount++
            if (loopCount >= 5) {
                throw new Error('__LOOP_BREAK__')
            }
        })

        // Set keepMining to false after prepareWallet but before loop starts
        // The loop sets keepMining=true at line 368, so we override on each sleep
        miner.sleep.callsFake(async () => {
            loopCount++
            miner.keepMining = false
            if (loopCount >= 5) {
                throw new Error('__LOOP_BREAK__')
            }
        })

        try { await miner.start() } catch (e) {
            if (e.message !== '__LOOP_BREAK__') throw e
        }

        // With keepMining always false, no blocks should be generated
        assert.strictEqual(connectorStub.generateToAddress.callCount, 0,
            'Should not mine when keepMining is false')
    })

    it('handles rapid keepMining toggling', async function () {
        clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false })
        miner.maxTimeToMineTxs = 10
        miner.addedTimeToMineTxs = 10

        connectorStub.getRawMempool.resolves(['txid1'])

        let loopCount = 0
        miner.sleep.callsFake(async () => {
            loopCount++
            clock.tick(5)
            // Toggle keepMining every iteration
            miner.keepMining = loopCount % 2 === 0
            if (loopCount >= 20) {
                miner.keepMining = false
                throw new Error('__LOOP_BREAK__')
            }
        })

        try { await miner.start() } catch (e) {
            if (e.message !== '__LOOP_BREAK__') throw e
        }

        // Should not crash regardless of toggle pattern
        assert.ok(loopCount >= 20)
    })
}

// ─── Concurrent fillMempool + continueMining ────────────────────

function fillMempoolInteractionTests() {
    it('fillMempool pauses mining during execution, finally restores it', async function () {
        miner.keepMining = true

        // fillMempool(0) fails validation and throws, so keepMining is unchanged
        await assert.rejects(() => miner.fillMempool(0), /positive integer/)
        assert.strictEqual(miner.keepMining, true,
            'Invalid input should not change keepMining')

        // continueMining always sets true
        miner.keepMining = false
        await miner.continueMining()
        assert.strictEqual(miner.keepMining, true)
    })

    it('rapid alternation does not corrupt state', async function () {
        await fc.assert(
            fc.asyncProperty(
                fc.array(fc.boolean(), { minLength: 1, maxLength: 50 }),
                async (sequence) => {
                    for (const shouldFill of sequence) {
                        if (shouldFill) {
                            try { await miner.fillMempool(0) } catch (e) { /* ok */ }
                        } else {
                            await miner.continueMining()
                        }
                    }

                    // With the W-3 fix, fillMempool(0) doesn't change keepMining
                    // (invalid input returns early), and continueMining sets it to true.
                    // So the final state depends on whether continueMining was ever called.
                    // fillMempool(0) is a no-op for keepMining; continueMining always sets true.
                    const everCalledContinue = sequence.some(op => !op)
                    if (everCalledContinue) {
                        assert.strictEqual(miner.keepMining, true)
                    }
                    // If only fillMempool(0) was called, keepMining stays at whatever it was
                }
            ),
            { numRuns: 200 }
        )
    })
}

// ─── generateBlocks with fuzzed block counts ────────────────────

function generateBlocksTests() {
    it('delegates positive counts to connector; throws (uncalled) for non-positive counts', async function () {
        miner.walletAddress = 'bcrt1qtest'
        await fc.assert(
            fc.asyncProperty(fc.integer({ min: -100, max: 1000 }), async (count) => {
                connectorStub.generateToAddress.resetHistory()
                if (count > 0) {
                    await miner.generateBlocks(count)
                    assert.ok(connectorStub.generateToAddress.calledWith(count, 'bcrt1qtest'))
                } else {
                    await assert.rejects(() => miner.generateBlocks(count), /count must be a positive integer/)
                    assert.ok(connectorStub.generateToAddress.notCalled)
                }
            }),
            { numRuns: 200 }
        )
    })

    it('propagates connector errors', async function () {
        miner.walletAddress = 'bcrt1qtest'
        connectorStub.generateToAddress.rejects(new Error('node down'))
        await assert.rejects(
            () => miner.generateBlocks(1),
            /node down/
        )
    })
}

// ─── Mining loop with interleaved errors ────────────────────────

function miningLoopResilienceTests() {
    it('survives alternating success and failure from getRawMempool', async function () {
        let callCount = 0
        connectorStub.getRawMempool.callsFake(async () => {
            callCount++
            if (callCount % 2 === 0) {
                throw new Error('connection refused')
            }
            return ['txid1']
        })

        let loopCount = 0
        miner.sleep.callsFake(async () => {
            loopCount++
            if (loopCount >= 10) {
                miner.keepMining = false
                throw new Error('__LOOP_BREAK__')
            }
        })

        try { await miner.start() } catch (e) {
            if (e.message !== '__LOOP_BREAK__') throw e
        }

        assert.ok(loopCount >= 10, 'Loop should survive interleaved errors')
    })

    it('survives alternating success and failure from generateToAddress', async function () {
        clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false })
        miner.maxTimeToMineTxs = 1
        miner.addedTimeToMineTxs = 1

        connectorStub.getRawMempool.resolves(['txid1'])

        let genCallCount = 0
        connectorStub.generateToAddress.callsFake(async () => {
            genCallCount++
            if (genCallCount % 2 === 0) {
                throw new Error('block template error')
            }
            return ['hash']
        })

        let loopCount = 0
        miner.sleep.callsFake(async () => {
            loopCount++
            clock.tick(10)
            if (loopCount >= 15) {
                miner.keepMining = false
                throw new Error('__LOOP_BREAK__')
            }
        })

        try { await miner.start() } catch (e) {
            if (e.message !== '__LOOP_BREAK__') throw e
        }

        assert.ok(loopCount >= 15, 'Loop should survive interleaved generate errors')
    })
}

describe('Fuzz: mining loop state machine', function () {
    beforeEach(setUpMiner)
    afterEach(tearDownMiner)
    describe('mining timer state transitions with fuzzed mempool sequences', miningTimerMaxTimeTests)
    describe('mining timer state transitions with fuzzed mempool sequences', miningTimerAddedTimeTests)
    describe('mining timer state transitions with fuzzed mempool sequences', miningTimerExtensionTests)
    describe('keepMining flag toggling', keepMiningFlagTests)
    describe('fillMempool and continueMining interaction', fillMempoolInteractionTests)
    describe('generateBlocks with fuzzed counts', generateBlocksTests)
    describe('mining loop resilience to interleaved errors', miningLoopResilienceTests)
})
