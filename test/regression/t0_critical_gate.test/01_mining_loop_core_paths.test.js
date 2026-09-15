/*********************************************************************
 *
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC – https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 *
 **********************************************************************/

const assert = require('assert')
const sinon = require('sinon')
const BlockchainConnector = require('../../../src/rpc/blockchain_connector')

let XChainRegtestMiner
let miner
let connectorStub
let clock

function setUpMiner() {
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
        setWalletName: sinon.stub(),
        getRawTransaction: sinon.stub().resolves('0200000001...'),
        sendRawTransaction: sinon.stub().resolves('txid_sent'),
    }

    sinon.stub(BlockchainConnector.prototype, 'constructor')
    XChainRegtestMiner = require('../../../src/XChainRegtestMiner')
    miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
    miner.connector = connectorStub
    sinon.stub(miner, 'sleep').resolves()
    sinon.stub(console, 'log')
    sinon.stub(console, 'error')
}

function setUpClock() {
    clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false })
    sinon.stub(miner, 'prepareWallet').resolves()
    miner.walletAddress = 'bcrt1qtest'
}

function tearDownMiner() {
    clock.restore()
    sinon.restore()
    delete require.cache[require.resolve('../../../src/XChainRegtestMiner')]
}

function registerHooks() {
    beforeEach(setUpMiner)
    beforeEach(setUpClock)
    afterEach(tearDownMiner)
}

// Helper to run the mining loop for a controlled number of iterations
async function runLoopIterations(iterations) {
    let loopCount = 0
    miner.sleep.callsFake(async () => {
        loopCount++
        if (loopCount >= iterations) {
            miner._shutdown = true
            throw new Error('__LOOP_BREAK__')
        }
    })
    try {
        await miner.start()
    } catch (e) {
        if (e.message !== '__LOOP_BREAK__') throw e
    }
}

// ═══════════════════════════════════════════════════════════════════
// REG-T0-005: Mining loop core paths
// ═══════════════════════════════════════════════════════════════════

describe('T0 Regression: Critical Gate', function () {
    registerHooks()

    describe('REG-T0-005: Mining loop core paths', function () {
        it('calls prepareWallet and sets keepMining on start', async function () {
            connectorStub.getRawMempool.resolves([])
            let wasMiningTrue = false
            miner.sleep.callsFake(async () => {
                if (miner.keepMining) wasMiningTrue = true
                throw new Error('__LOOP_BREAK__')
            })
            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }
            assert(miner.prepareWallet.calledOnce)
            assert(wasMiningTrue)
        })

        it('detects new mempool transactions without mining immediately', async function () {
            connectorStub.getRawMempool.resolves(['txid1'])
            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount >= 2) throw new Error('__LOOP_BREAK__')
            })
            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }
            assert(connectorStub.getRawMempool.callCount >= 1)
            assert(connectorStub.generateToAddress.notCalled)
        })
    })
})

describe('T0 Regression: Critical Gate', function () {
    registerHooks()

    describe('REG-T0-005: Mining loop core paths', function () {
        it('mines block after maxTimeToMineTxs elapses', async function () {
            miner.maxTimeToMineTxs = 100
            miner.addedTimeToMineTxs = 50000
            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) clock.tick(150)
                if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }
            assert(connectorStub.generateToAddress.called)
        })
    })
})

describe('T0 Regression: Critical Gate', function () {
    registerHooks()

    describe('REG-T0-005: Mining loop core paths', function () {
        it('mines block after addedTimeToMineTxs with no new txs', async function () {
            miner.maxTimeToMineTxs = 50000
            miner.addedTimeToMineTxs = 100
            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) clock.tick(150)
                if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }
            assert(connectorStub.generateToAddress.called)
        })
    })
})

describe('T0 Regression: Critical Gate', function () {
    registerHooks()

    describe('REG-T0-005: Mining loop core paths', function () {
        it('does not poll mempool when keepMining is false', async function () {
            let iterCount = 0
            connectorStub.getRawMempool.callsFake(async () => {
                if (!miner.keepMining) throw new Error('polled while paused')
                return []
            })
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) {
                    miner.keepMining = false
                    connectorStub.getRawMempool.resetHistory()
                }
                if (iterCount >= 4) throw new Error('__LOOP_BREAK__')
            })
            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }
            assert.strictEqual(connectorStub.getRawMempool.callCount, 0)
        })
    })
})

describe('T0 Regression: Critical Gate', function () {
    registerHooks()

    describe('REG-T0-005: Mining loop core paths', function () {
        it('resets timers when mempool empties', async function () {
            connectorStub.getRawMempool.onCall(0).resolves(['txid1'])
            connectorStub.getRawMempool.onCall(1).resolves([])
            connectorStub.getRawMempool.onCall(2).resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount >= 4) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }
            assert(connectorStub.getRawMempool.callCount >= 3)
        })

        it('handles getRawMempool error gracefully and retries', async function () {
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
            assert(connectorStub.getRawMempool.callCount >= 2)
        })
    })
})

describe('T0 Regression: Critical Gate', function () {
    registerHooks()

    describe('REG-T0-005: Mining loop core paths', function () {
        it('handles generateBlocks error gracefully and retries', async function () {
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
            assert(genCallCount >= 2)
        })
    })
})
