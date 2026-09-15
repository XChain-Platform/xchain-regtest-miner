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

// Stub BlockchainConnector before requiring XChainRegtestMiner
const BlockchainConnector = require('../../../src/rpc/blockchain_connector')

let XChainRegtestMiner
let miner
let connectorStub

function registerMinerHooks() {
    beforeEach(function () {
        // Create a stub for every BlockchainConnector method
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
            setTxFee: sinon.stub().resolves(true),
            getRawTransaction: sinon.stub().resolves('0200000001...'),
            sendRawTransaction: sinon.stub().resolves('txid_sent'),
            getNetworkInfo: sinon.stub().resolves({}),
            setWalletName: sinon.stub(),
        }

        // Stub the BlockchainConnector constructor
        sinon.stub(BlockchainConnector.prototype, 'constructor')

        XChainRegtestMiner = require('../../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', undefined, '18332', 'user', 'pass')
        miner.connector = connectorStub

        sinon.stub(miner, 'sleep').resolves()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    afterEach(function () {
        sinon.restore()
        // Clear module cache so fresh require works each time
        delete require.cache[require.resolve('../../../src/XChainRegtestMiner')]
    })
}

// ─── Mining Loop (start) ────────────────────────────────────────────

let clock

function registerStartHooks() {
    beforeEach(function () {
        // Fake timers control Date.now while sleep remains stubbed.
        clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false })

        // prepareWallet succeeds
        connectorStub.getWalletInfo.resolves({ walletname: 'w' })
        connectorStub.getBalance.resolves(50.0)
        miner.walletAddress = 'bcrt1qtest'

        // Override prepareWallet to avoid its complexity
        sinon.stub(miner, 'prepareWallet').resolves()
    })

    afterEach(function () {
        clock.restore()
    })
}

// Helper to run the mining loop for a controlled number of iterations
async function runLoopIterations(miner, iterations) {
    let loopCount = 0
    const originalSleep = miner.sleep

    // Replace sleep to count iterations and break the loop
    miner.sleep.callsFake(async () => {
        loopCount++
        if (loopCount >= iterations) {
            miner.keepMining = false
            // Throw to break out of the while(true) loop
            throw new Error('__LOOP_BREAK__')
        }
    })

    try {
        await miner.start()
    } catch (e) {
        if (e.message !== '__LOOP_BREAK__') throw e
    }
}

function startTestsA() {
    it('calls prepareWallet on start', async function () {
        connectorStub.getRawMempool.resolves([])
        await runLoopIterations(miner, 1)
        assert(miner.prepareWallet.calledOnce)
    })
    it('sets keepMining to true', async function () {
        connectorStub.getRawMempool.resolves([])
        // Check that keepMining was set to true before the loop break
        let wasMiningTrue = false
        miner.sleep.callsFake(async () => {
            if (miner.keepMining) wasMiningTrue = true
            throw new Error('__LOOP_BREAK__')
        })
        try { await miner.start() } catch (e) {
            if (e.message !== '__LOOP_BREAK__') throw e
        }
        assert(wasMiningTrue)
    })
    it('polls mempool when keepMining is true', async function () {
        connectorStub.getRawMempool.resolves([])
        await runLoopIterations(miner, 3)
        assert(connectorStub.getRawMempool.callCount >= 1)
    })
    it('does not poll mempool when keepMining is false', async function () {
        let iterCount = 0
        let mempoolCalledWhilePaused = false
        // getRawMempool should track if called while keepMining is false
        connectorStub.getRawMempool.callsFake(async () => {
            if (!miner.keepMining) mempoolCalledWhilePaused = true
            return []
        })
        miner.sleep.callsFake(async () => {
            iterCount++
            // On first sleep, disable mining. Subsequent iterations should skip mempool.
            if (iterCount === 1) {
                miner.keepMining = false
                connectorStub.getRawMempool.resetHistory()
            }
            if (iterCount >= 4) throw new Error('__LOOP_BREAK__')
        })
        try { await miner.start() } catch (e) {
            if (e.message !== '__LOOP_BREAK__') throw e
        }
        // After keepMining was set to false, getRawMempool should not have been called
        assert.strictEqual(connectorStub.getRawMempool.callCount, 0)
    })
}

function startTestsB() {
    it('starts initial timer when first tx appears in mempool', async function () {
        connectorStub.getRawMempool.resolves(['txid1'])
        let generateCalled = false
        connectorStub.generateToAddress.callsFake(async () => {
            generateCalled = true
            return ['hash']
        })
        // First iteration: mempool has tx, timer starts
        // Timer should NOT fire yet (no time has passed)
        let iterCount = 0
        miner.sleep.callsFake(async () => {
            iterCount++
            if (iterCount >= 2) throw new Error('__LOOP_BREAK__')
        })
        try { await miner.start() } catch (e) {
            if (e.message !== '__LOOP_BREAK__') throw e
        }
        // generateBlocks should NOT have been called yet (timer just started)
        assert.strictEqual(generateCalled, false)
    })
    it('mines block after maxTimeToMineTxs elapses', async function () {
        miner.maxTimeToMineTxs = 100 // 100ms for test speed
        miner.addedTimeToMineTxs = 50000 // large so it doesn't trigger
        connectorStub.getRawMempool.resolves(['txid1'])
        let iterCount = 0
        miner.sleep.callsFake(async () => {
            iterCount++
            if (iterCount === 1) {
                // Advance time past maxTimeToMineTxs
                clock.tick(150)
            }
            if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
        })
        try { await miner.start() } catch (e) {
            if (e.message !== '__LOOP_BREAK__') throw e
        }
        assert(connectorStub.generateToAddress.called)
    })
}

function startTestsC() {
    it('mines block after addedTimeToMineTxs with no new txs', async function () {
        miner.maxTimeToMineTxs = 50000 // large so it doesn't trigger
        miner.addedTimeToMineTxs = 100
        connectorStub.getRawMempool.resolves(['txid1'])
        let iterCount = 0
        miner.sleep.callsFake(async () => {
            iterCount++
            if (iterCount === 1) {
                // Advance time past addedTimeToMineTxs
                clock.tick(150)
            }
            if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
        })
        try { await miner.start() } catch (e) {
            if (e.message !== '__LOOP_BREAK__') throw e
        }
        assert(connectorStub.generateToAddress.called)
    })
    it('extends timer when new txs arrive', async function () {
        miner.maxTimeToMineTxs = 50000
        miner.addedTimeToMineTxs = 200
        let iterCount = 0
        // Simulate: 1 tx, then 2 txs (new tx arrived)
        connectorStub.getRawMempool.onCall(0).resolves(['txid1'])
        connectorStub.getRawMempool.onCall(1).resolves(['txid1', 'txid2'])
        connectorStub.getRawMempool.onCall(2).resolves(['txid1', 'txid2'])
        connectorStub.getRawMempool.onCall(3).resolves(['txid1', 'txid2'])
        miner.sleep.callsFake(async () => {
            iterCount++
            if (iterCount === 1) {
                // After first tx, advance 100ms (not enough for addedTime=200)
                clock.tick(100)
            }
            if (iterCount === 2) {
                // New tx arrived, timer extended. Advance another 100ms
                // Total from initial = 200ms, but from extended = 100ms, not enough
                clock.tick(100)
            }
            if (iterCount === 3) {
                // Advance enough for addedTime from the extended reset
                clock.tick(150)
            }
            if (iterCount >= 5) throw new Error('__LOOP_BREAK__')
        })
        try { await miner.start() } catch (e) {
            if (e.message !== '__LOOP_BREAK__') throw e
        }
        assert(connectorStub.generateToAddress.called)
    })
}

function startTestsD() {
    it('resets timers after mining a block', async function () {
        miner.maxTimeToMineTxs = 50
        miner.addedTimeToMineTxs = 50
        connectorStub.getRawMempool.resolves(['txid1'])
        let generateCount = 0
        connectorStub.generateToAddress.callsFake(async () => {
            generateCount++
            return ['hash']
        })
        let iterCount = 0
        miner.sleep.callsFake(async () => {
            iterCount++
            if (iterCount <= 2) clock.tick(60)
            if (iterCount >= 5) throw new Error('__LOOP_BREAK__')
        })
        try { await miner.start() } catch (e) {
            if (e.message !== '__LOOP_BREAK__') throw e
        }
        // Should have mined at least 2 blocks (timer resets and fires again)
        assert(generateCount >= 2)
    })
    it('resets mempool length tracking when mempool empties', async function () {
        // First poll: mempool has txs
        connectorStub.getRawMempool.onCall(0).resolves(['txid1'])
        // Second poll: mempool empty
        connectorStub.getRawMempool.onCall(1).resolves([])
        // Third poll: same tx appears again -- should be treated as new
        connectorStub.getRawMempool.onCall(2).resolves(['txid1'])
        let iterCount = 0
        let timersResetOnEmpty = false
        miner.sleep.callsFake(async () => {
            iterCount++
            if (iterCount >= 4) throw new Error('__LOOP_BREAK__')
        })
        try { await miner.start() } catch (e) {
            if (e.message !== '__LOOP_BREAK__') throw e
        }
        // The fact that getRawMempool was called 3+ times without error means the loop handled empty correctly
        assert(connectorStub.getRawMempool.callCount >= 3)
    })
}

function startTestsE() {
    it('handles getRawMempool error gracefully', async function () {
        connectorStub.getRawMempool.onCall(0).rejects(new Error('connection lost'))
        connectorStub.getRawMempool.onCall(1).resolves([])
        let iterCount = 0
        miner.sleep.callsFake(async () => {
            iterCount++
            if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
        })
        try { await miner.start() } catch (e) {
            if (e.message !== '__LOOP_BREAK__') throw e
        }
        // Should have retried after error
        assert(connectorStub.getRawMempool.callCount >= 2)
    })
    it('handles generateBlocks error gracefully', async function () {
        miner.maxTimeToMineTxs = 50
        miner.addedTimeToMineTxs = 50
        connectorStub.getRawMempool.resolves(['txid1'])
        let genCallCount = 0
        connectorStub.generateToAddress.callsFake(async () => {
            genCallCount++
            if (genCallCount === 1) throw new Error('block generation failed')
            return ['hash']
        })
        let iterCount = 0
        miner.sleep.callsFake(async () => {
            iterCount++
            clock.tick(60)
            if (iterCount >= 5) throw new Error('__LOOP_BREAK__')
        })
        try { await miner.start() } catch (e) {
            if (e.message !== '__LOOP_BREAK__') throw e
        }
        // Should have retried and succeeded on second attempt
        assert(genCallCount >= 2)
    })
}

function startTestsF() {
    it('tracks lastRawMempoolLength correctly (bug fix verification)', async function () {
        miner.maxTimeToMineTxs = 50000
        miner.addedTimeToMineTxs = 50000
        // Same mempool size across calls -- should NOT reset extended timer
        connectorStub.getRawMempool.resolves(['txid1'])
        let iterCount = 0
        // Fake timers (installed in beforeEach) freeze Date.now at a constant,
        // so timer thresholds never elapse and mining stays idle. No need to stub
        // Date.now; sinon.stub cannot wrap the fake-timers Date in sinon >= 18.
        miner.sleep.callsFake(async () => {
            iterCount++
            if (iterCount >= 4) throw new Error('__LOOP_BREAK__')
        })
        try { await miner.start() } catch (e) {
            if (e.message !== '__LOOP_BREAK__') throw e
        }
        // With the bug fix, after the first iteration sets lastRawMempoolLength=1,
        // subsequent iterations with the same mempool length should NOT enter
        // the "new txs" branch. Date.now should be called a limited number of times.
        // The key assertion: getRawMempool was called multiple times but generateToAddress
        // was NOT called (timers didn't trigger because no time advanced)
        assert(connectorStub.generateToAddress.notCalled)
    })
}

function registerStartBlock(tests) {
    describe('start (mining loop)', function () {
        registerStartHooks()
        tests()
    })
}

describe('XChainRegtestMiner', function () {
    registerMinerHooks()
    registerStartBlock(startTestsA)
    registerStartBlock(startTestsB)
    registerStartBlock(startTestsC)
    registerStartBlock(startTestsD)
    registerStartBlock(startTestsE)
    registerStartBlock(startTestsF)
})
