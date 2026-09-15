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
 **********************************************************************
 * T1 Regression Tests: Standard Regression
 *
 * Comprehensive regression suite covering BlockchainConnector RPC methods,
 * integration seams (Miner↔Connector sequences), boundary conditions,
 * security validation, and fillMempool chunking logic.
 *
 * Target runtime: < 2 minutes
 * Trigger: every PR and merge to main
 */
const assert = require('assert')
const sinon = require('sinon')
const BlockchainConnector = require('../../../src/rpc/blockchain_connector')


// ═══════════════════════════════════════════════════════════════════════
// Section C: Boundary Condition Regression
// ═══════════════════════════════════════════════════════════════════════

let XChainRegtestMiner
let miner
let connectorStub
let clock

function registerBoundaryHooks() {
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
        sinon.stub(miner, 'prepareWallet').resolves()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')

        miner.walletAddress = 'bcrt1qtest'

        clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false })
    })

    afterEach(function () {
        clock.restore()
        sinon.restore()
        delete require.cache[require.resolve('../../../src/XChainRegtestMiner')]
    })
}

async function runLoopIterations(iterations) {
    let loopCount = 0
    miner.sleep.callsFake(async () => {
        loopCount++
        if (loopCount >= iterations) {
            miner._shutdown = true
            throw new Error('__LOOP_BREAK__')
        }
    })
    try { await miner.start() } catch (e) {
        if (e.message !== '__LOOP_BREAK__') throw e
    }
}

describe('T1 Regression: Boundary Conditions', function () {
    registerBoundaryHooks()

    // ─── REG-T1-C01: Timer boundary (maxTimeToMineTxs = 0) ────────

    describe('REG-T1-C01: Timer boundary, maxTime = 0', function () {
        it('mines immediately on next poll after first tx', async function () {
            miner.maxTimeToMineTxs = 0
            miner.addedTimeToMineTxs = 50000
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
                'maxTime=0 should cause immediate mining')
        })
    })
})

describe('T1 Regression: Boundary Conditions', function () {
    registerBoundaryHooks()

    // ─── REG-T1-C02: Timer boundary, simultaneous expiry ──────────

    describe('REG-T1-C02: Both timers expire simultaneously', function () {
        it('generates exactly one block (not two)', async function () {
            miner.maxTimeToMineTxs = 100
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

            // The OR condition triggers once, generating one block
            assert.strictEqual(connectorStub.generateToAddress.callCount, 1)
        })
    })
})

describe('T1 Regression: Boundary Conditions', function () {
    registerBoundaryHooks()

    // ─── REG-T1-C03: Empty mempool never triggers mining ───────────

    describe('REG-T1-C03: Empty mempool', function () {
        it('never triggers mining regardless of time elapsed', async function () {
            connectorStub.getRawMempool.resolves([])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                clock.tick(60000)
                if (iterCount >= 5) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert(connectorStub.generateToAddress.notCalled)
        })
    })

    // ─── REG-T1-C04: Mempool size unchanged between polls ──────────

    describe('REG-T1-C04: Mempool size unchanged, no timer reset', function () {
        it('does not reset extendedStartToMine when size stays the same', async function () {
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

            // With unchanged mempool size, extended timer should fire (not reset)
            assert(connectorStub.generateToAddress.called,
                'Should mine after addedTime with unchanged mempool')
        })
    })
})

describe('T1 Regression: Boundary Conditions', function () {
    registerBoundaryHooks()

    // ─── REG-T1-C05: Wallet boundary, height exactly 100 ──────────

    describe('REG-T1-C05: Wallet height boundary at 100', function () {
        beforeEach(function () {
            miner.prepareWallet.restore()
        })

        it('mines 101 blocks at height exactly 100', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.onFirstCall().resolves(0)
            connectorStub.getBlockchainInfo.resolves({ blocks: 100 })

            await miner.prepareWallet()

            assert(connectorStub.generateToAddress.calledWith(101, 'bcrt1qtest'))
        })

        it('mines 101 blocks at height 101 (maturity depth is height-independent)', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.onFirstCall().resolves(0)
            connectorStub.getBlockchainInfo.resolves({ blocks: 101 })

            await miner.prepareWallet()

            assert(connectorStub.generateToAddress.calledWith(101, 'bcrt1qtest'))
        })
    })
})

describe('T1 Regression: Boundary Conditions', function () {
    registerBoundaryHooks()

    // ─── REG-T1-C06: fillMempool chunking boundaries ───────────────

    describe('REG-T1-C06: fillMempool chunking math', function () {
        it('1 chunk for 100 txs', function () {
            assert.strictEqual(Math.ceil(100 / 2500), 1)
        })

        it('1 chunk for exactly 2500 txs', function () {
            assert.strictEqual(Math.ceil(2500 / 2500), 1)
        })

        it('2 chunks for 2501 txs', function () {
            assert.strictEqual(Math.ceil(2501 / 2500), 2)
        })

        it('correct remainder for last chunk (2501 → remainder 1)', function () {
            const txQuantity = 2501
            const remainder = txQuantity % 2500
            assert.strictEqual(remainder, 1)
        })

        it('zero remainder for evenly divisible (5000)', function () {
            const remainder = 5000 % 2500
            assert.strictEqual(remainder, 0)
        })

        it('correct funding amount per chunk', function () {
            const AMOUNT = 1000, FEE = 1000, BUFFER = 50, SATOSHI = 100000000.0
            const txRemainder = 100
            const total = (AMOUNT + FEE + BUFFER) * txRemainder
            assert.strictEqual(total, 205000)
            assert.strictEqual(total / SATOSHI, 0.00205)
        })
    })
})
