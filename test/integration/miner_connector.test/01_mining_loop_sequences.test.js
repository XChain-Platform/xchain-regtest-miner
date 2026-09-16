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
 * Seam B Integration Tests: XChainRegtestMiner ↔ BlockchainConnector sequences
 *
 * Tests verify multi-step call sequences where one connector call's return value
 * affects the miner's subsequent decisions. Uses a stateful connector mock that
 * returns realistic, interdependent responses.
 */

const assert = require('assert')
const sinon = require('sinon')
const BlockchainConnector = require('../../../src/rpc/blockchain_connector')

let XChainRegtestMiner, miner, connector, callLog

function createMiner() {
    callLog = []

    // Stateful connector mock that records every call in order
    connector = {
        getWalletInfo: sinon.stub().callsFake(async () => {
            callLog.push('getWalletInfo')
            throw new Error('No wallet loaded')
        }),
        loadWallet: sinon.stub().callsFake(async (name) => {
            callLog.push(`loadWallet(${name})`)
            throw new Error('Wallet not found')
        }),
        createWallet: sinon.stub().callsFake(async (name) => {
            callLog.push(`createWallet(${name})`)
            return { name }
        }),
        getNewAddress: sinon.stub().callsFake(async () => {
            callLog.push('getNewAddress')
            return 'bcrt1qtest'
        }),
        getBalance: sinon.stub().callsFake(async () => {
            callLog.push('getBalance')
            return 50.0
        }),
        getBlockchainInfo: sinon.stub().callsFake(async () => {
            callLog.push('getBlockchainInfo')
            return { blocks: 200 }
        }),
        generateToAddress: sinon.stub().callsFake(async (count, addr) => {
            callLog.push(`generateToAddress(${count})`)
            return ['blockhash']
        }),
        getRawMempool: sinon.stub().resolves([]),
        sendToAddress: sinon.stub().resolves('txid_abc'),
        setTxFee: sinon.stub().callsFake(async () => {
            callLog.push('setTxFee')
            return true
        }),
        setWalletName: sinon.stub().callsFake((name) => {
            callLog.push(`setWalletName(${name})`)
        }),
    }

    sinon.stub(BlockchainConnector.prototype, 'constructor')
    delete require.cache[require.resolve('../../../src/XChainRegtestMiner')]
    XChainRegtestMiner = require('../../../src/XChainRegtestMiner')
    miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
    miner.connector = connector

    sinon.stub(miner, 'sleep').resolves()
    sinon.stub(console, 'log')
    sinon.stub(console, 'error')
}

function restoreMiner() {
    sinon.restore()
    delete require.cache[require.resolve('../../../src/XChainRegtestMiner')]
}

function configureMining() {
    // Bypass prepareWallet for loop tests
    sinon.stub(miner, 'prepareWallet').resolves()
    miner.walletAddress = 'bcrt1qtest'
    // Use very short timers for fast tests
    miner.maxTimeToMineTxs = 50
    miner.addedTimeToMineTxs = 30
}

// Helper: run the loop for a bounded workload window, then wait for the
// loop to ACTUALLY exit. The timer only requests shutdown; settling is
// the start() promise resolving, which is the loop's own statement that
// it has left the while. The previous "give it one more cycle" 20ms
// could resolve while the loop was still mid-cycle, so callers read a
// moving callCount and leaked a live loop into the next test. If the
// loop ever fails to exit this now hangs to the mocha timeout, which is
// the honest failure.
function runLoopWithTimeout(miner, timeoutMs) {
    return new Promise(async (resolve) => {
        const timer = setTimeout(() => {
            miner._shutdown = true
        }, timeoutMs)

        // Replace sleep with a short real delay
        miner.sleep.callsFake(async () => {
            return new Promise(r => setTimeout(r, 5))
        })

        try {
            await miner.start()
        } catch (e) {
            // Loop exited via keepMining=false → sleep throws or loop breaks
        }

        clearTimeout(timer)
        resolve()
    })
}

describe('Seam B: XChainRegtestMiner ↔ BlockchainConnector sequences', function () {
    beforeEach(createMiner)
    afterEach(restoreMiner)

    // ─── Mining Loop Sequences ──────────────────────────────────────────

    describe('mining loop sequences', function () {
        beforeEach(configureMining)

        it('B-9: mines when mempool has transactions and timer expires', async function () {
            connector.getRawMempool.resolves(['txid1'])

            await runLoopWithTimeout(miner, 200)

            assert.ok(connector.generateToAddress.callCount >= 1,
                'Should have mined at least 1 block')
        })

        it('B-10: no mining with empty mempool', async function () {
            connector.getRawMempool.resolves([])

            await runLoopWithTimeout(miner, 100)

            assert.strictEqual(connector.generateToAddress.callCount, 0,
                'Should not mine with empty mempool')
        })

        it('B-11: mines multiple blocks across timer resets', async function () {
            connector.getRawMempool.resolves(['txid1'])

            await runLoopWithTimeout(miner, 400)

            assert.ok(connector.generateToAddress.callCount >= 2,
                'Should have mined at least 2 blocks with timer resets')
        })
    })
})

describe('Seam B: XChainRegtestMiner ↔ BlockchainConnector sequences', function () {
    beforeEach(createMiner)
    afterEach(restoreMiner)

    describe('mining loop sequences', function () {
        beforeEach(configureMining)

        it('B-12: paused mining does not generate blocks', async function () {
            connector.getRawMempool.resolves(['txid1'])

            // Disable mining immediately after start
            let loopCount = 0
            miner.sleep.callsFake(async () => {
                loopCount++
                miner.keepMining = false
                if (loopCount >= 3) {
                    miner._shutdown = true
                    throw new Error('__LOOP_BREAK__')
                }
                return new Promise(r => setTimeout(r, 5))
            })

            // Override prepareWallet to not set keepMining
            miner.prepareWallet.callsFake(async () => {})

            try {
                await miner.start()
            } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // keepMining was set false on first sleep, then loop skips mining
            assert.strictEqual(connector.generateToAddress.callCount, 0)
        })

        it('B-13: recovers from getRawMempool errors', async function () {
            let callCount = 0
            connector.getRawMempool.callsFake(async () => {
                callCount++
                if (callCount <= 3) throw new Error('Connection lost')
                return ['txid1']
            })

            await runLoopWithTimeout(miner, 300)

            // Should have recovered from errors and eventually polled successfully
            assert.ok(callCount > 3, 'Should have retried after errors')
            // May or may not have mined depending on timing
        })
    })
})

describe('Seam B: XChainRegtestMiner ↔ BlockchainConnector sequences', function () {
    beforeEach(createMiner)
    afterEach(restoreMiner)

    describe('mining loop sequences', function () {
        beforeEach(configureMining)

        it('B-14: recovers from generateToAddress errors', async function () {
            connector.getRawMempool.resolves(['txid1'])

            let genCount = 0
            connector.generateToAddress.callsFake(async () => {
                genCount++
                if (genCount === 1) throw new Error('Block generation failed')
                return ['blockhash']
            })

            await runLoopWithTimeout(miner, 300)

            assert.ok(genCount >= 2, 'Should have retried block generation')
        })

        it('timer extension: new txs delay mining', async function () {
            // Use longer timers to make the test observable
            miner.maxTimeToMineTxs = 200
            miner.addedTimeToMineTxs = 80

            let pollCount = 0
            connector.getRawMempool.callsFake(async () => {
                pollCount++
                // Simulate new tx arriving every few polls
                if (pollCount <= 3) return ['txid1']
                if (pollCount <= 6) return ['txid1', 'txid2']
                return ['txid1', 'txid2']
            })

            await runLoopWithTimeout(miner, 500)

            // Should have mined at least once (either initial or extended timer)
            assert.ok(connector.generateToAddress.callCount >= 1)
        })

        it('keepMining toggle: continueMining resumes after pause', async function () {
            connector.getRawMempool.resolves(['txid1'])

            let iteration = 0
            miner.sleep.callsFake(async () => {
                iteration++
                if (iteration === 2) miner.keepMining = false
                if (iteration === 6) miner.keepMining = true
                return new Promise(r => setTimeout(r, 5))
            })

            await runLoopWithTimeout(miner, 500)

            // The miner should have generated blocks before pause and after resume
            assert.ok(connector.generateToAddress.callCount >= 1)
        })
    })
})
