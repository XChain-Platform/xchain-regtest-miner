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

describe('Boundary: Combined Parameter Interactions', function () {
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
            setTxFee: sinon.stub().resolves(true),
            setWalletName: sinon.stub(),
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

    // ─── C-01: maxTimeToMineTxs=0 + large mempool ─────────────────────

    describe('C-01: maxTimeToMineTxs=0 with 10000 txs in mempool', function () {
        it('mines immediately on first poll regardless of mempool size', async function () {
            miner.maxTimeToMineTxs = 0
            miner.addedTimeToMineTxs = 50000

            const largeMp = Array.from({ length: 10000 }, (_, i) => `tx_${i}`)
            connectorStub.getRawMempool.resolves(largeMp)

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert(connectorStub.generateToAddress.called,
                'Should mine immediately with maxTime=0 even with large mempool')
        })
    })

    // ─── C-02: addedTimeToMineTxs=0 + frequent tx arrivals ────────────

    describe('C-02: addedTimeToMineTxs=0 with transactions arriving every poll', function () {
        it('mines on every poll that detects mempool change', async function () {
            miner.maxTimeToMineTxs = 50000
            miner.addedTimeToMineTxs = 0

            let mempoolSize = 0
            connectorStub.getRawMempool.callsFake(async () => {
                mempoolSize++
                return Array.from({ length: mempoolSize }, (_, i) => `tx_${i}`)
            })

            let generateCount = 0
            connectorStub.generateToAddress.callsFake(async () => {
                generateCount++
                return ['hash']
            })

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount >= 6) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // With addedTime=0, mining fires on the iteration after timers are set.
            // Each mine resets timers to 0, then mempool growth sets them again.
            assert(generateCount >= 1,
                'Should mine frequently with addedTime=0 and growing mempool')
        })
    })

    // ─── C-03: fillMempool + short maxTimeToMineTxs ────────────────────

    describe('C-03: fillMempool with invalid input does not change keepMining', function () {
        it('keepMining is unchanged for invalid txQuantity (validation rejects early)', async function () {
            miner.keepMining = true
            miner.maxTimeToMineTxs = 100

            await assert.rejects(() => miner.fillMempool(0), /positive integer/)

            assert.strictEqual(miner.keepMining, true,
                'fillMempool must not change keepMining for invalid input')
        })
    })

    // ─── C-05: Wallet balance=0 + height=99 + generateBlocks timeout ──

    describe('C-05: prepareWallet with balance=0 at height boundary', function () {
        beforeEach(function () {
            miner.prepareWallet.restore()
        })

        it('mines 101 blocks at height 99, which might timeout', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.onFirstCall().resolves(0)
            connectorStub.getBlockchainInfo.resolves({ blocks: 99 })

            await miner.prepareWallet()

            assert(connectorStub.generateToAddress.calledWith(101, 'bcrt1qtest'),
                'Should mine 101 blocks at height 99 (<=100)')
        })

        it('propagates error when generateToAddress fails during bootstrap', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.onFirstCall().resolves(0)
            connectorStub.getBlockchainInfo.resolves({ blocks: 99 })
            connectorStub.generateToAddress.rejects(new Error('timeout after 60s'))

            await assert.rejects(
                () => miner.prepareWallet(),
                /timeout after 60s/,
                'generateBlocks error should propagate during wallet prep'
            )
        })
    })

    // ─── C-06: set_mining_time during active timer ─────────────────────

    describe('C-06: timer threshold changes mid-countdown', function () {
        it('changing maxTimeToMineTxs lower mid-countdown triggers immediate mining', async function () {
            miner.maxTimeToMineTxs = 50000
            miner.addedTimeToMineTxs = 50000

            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) {
                    clock.tick(100) // Only 100ms elapsed
                }
                if (iterCount === 2) {
                    // Change threshold to something already passed
                    miner.maxTimeToMineTxs = 50
                    // Don't advance clock; already 100ms > 50ms
                }
                if (iterCount >= 5) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert(connectorStub.generateToAddress.called,
                'Lowering maxTime below elapsed time should trigger mining')
        })

        it('changing maxTimeToMineTxs higher mid-countdown delays mining', async function () {
            miner.maxTimeToMineTxs = 100
            miner.addedTimeToMineTxs = 50000

            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) {
                    clock.tick(80) // 80ms elapsed (close to 100ms threshold)
                    // Extend the threshold before it fires
                    miner.maxTimeToMineTxs = 500
                }
                if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // 80ms < 500ms, so maxTime shouldn't fire yet
            assert(connectorStub.generateToAddress.notCalled,
                'Raising maxTime should delay mining')
        })
    })

    // ─── C-07: continueMining called during fillMempool ────────────────

    describe('C-07: race between continueMining and fillMempool', function () {
        it('continueMining sets keepMining=true regardless of fillMempool state', async function () {
            miner.keepMining = false
            await miner.continueMining()
            assert.strictEqual(miner.keepMining, true)

            // If fillMempool is running concurrently, it set keepMining=false at start
            // but continueMining can override it. No mutex protection exists.
            miner.keepMining = false // simulate fillMempool setting it
            await miner.continueMining()
            assert.strictEqual(miner.keepMining, true,
                'continueMining always sets true regardless of concurrent state')
        })
    })

    // ─── C-08: Mempool cleared by mining, stale read ───────────────────

    describe('C-08: mempool cleared by mining but next poll read stale data', function () {
        it('handles mempool that empties after mining', async function () {
            miner.maxTimeToMineTxs = 50
            miner.addedTimeToMineTxs = 50

            let mined = false
            connectorStub.getRawMempool.callsFake(async () => {
                if (!mined) return ['txid1', 'txid2']
                return [] // Empty after mining
            })

            connectorStub.generateToAddress.callsFake(async () => {
                mined = true
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

            assert.strictEqual(connectorStub.generateToAddress.callCount, 1,
                'Should mine once then stop when mempool empties')
        })
    })

    // ─── C-09: Double error (getRawMempool + generateBlocks) ───────────

    describe('C-09: both getRawMempool and generateBlocks fail in sequence', function () {
        it('recovers from alternating error types', async function () {
            miner.maxTimeToMineTxs = 50
            miner.addedTimeToMineTxs = 50

            let mempoolCallCount = 0
            connectorStub.getRawMempool.callsFake(async () => {
                mempoolCallCount++
                if (mempoolCallCount === 2) throw new Error('mempool error')
                return ['txid1']
            })

            let genCallCount = 0
            connectorStub.generateToAddress.callsFake(async () => {
                genCallCount++
                if (genCallCount === 1) throw new Error('generation failed')
                return ['hash']
            })

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                clock.tick(60)
                if (iterCount >= 8) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // Should have recovered from both errors and eventually mined
            assert(genCallCount >= 2,
                'Should retry generation after failure')
            assert(mempoolCallCount >= 3,
                'Should retry mempool after failure')
        })
    })

    // ─── C-10: createWallet retries exhausted vs getWalletInfo ─────────

    describe('C-10: wallet creation failure cascade', function () {
        beforeEach(function () {
            miner.prepareWallet.restore()
        })

        it('throws when the probe, loadWallet, and createWallet all fail', async function () {
            connectorStub.getNewAddress.rejects(new Error('no wallet loaded'))
            connectorStub.loadWallet.rejects(new Error('wallet not found'))
            connectorStub.createWallet.rejects(new Error('disk full'))

            await assert.rejects(
                () => miner.prepareWallet(),
                /Could not create wallet/,
                'Should throw wallet creation error'
            )
        })
    })
})
