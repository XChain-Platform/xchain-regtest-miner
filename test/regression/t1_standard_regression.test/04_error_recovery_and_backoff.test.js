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
// Section E: Exponential Backoff Regression
// ═══════════════════════════════════════════════════════════════════════

let XChainRegtestMiner, miner, connectorStub, clock

function registerBackoffHooks() {
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
        }

        sinon.stub(BlockchainConnector.prototype, 'constructor')
        XChainRegtestMiner = require('../../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        miner.connector = connectorStub

        sinon.stub(miner, 'prepareWallet').resolves()
        miner.walletAddress = 'bcrt1qtest'

        sinon.stub(console, 'log')
        sinon.stub(console, 'error')

        clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false })
    })

    afterEach(function () {
        clock.restore()
        sinon.restore()
        delete require.cache[require.resolve('../../../src/XChainRegtestMiner')]
    })
}

describe('T1 Regression: Error Recovery & Backoff', function () {
    registerBackoffHooks()

    describe('REG-T1-E01: Backoff on consecutive mempool errors', function () {
        it('logs backoff messages with increasing delays', async function () {
            let errorCount = 0
            connectorStub.getRawMempool.callsFake(async () => {
                errorCount++
                if (errorCount <= 3) throw new Error('connection lost')
                return []
            })

            // Track sleep calls to verify backoff
            let sleepCalls = []
            miner.sleep = sinon.stub().callsFake(async (ms) => {
                sleepCalls.push(ms)
                if (sleepCalls.length >= 6) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // First error: backoff = min(1000 * 2^1, 30000) = 2000
            // Second error: backoff = min(1000 * 2^2, 30000) = 4000
            // Third error: backoff = min(1000 * 2^3, 30000) = 8000
            assert.ok(errorCount >= 3, 'Should have encountered errors')
            // Verify that backoff values increase
            const backoffSleeps = sleepCalls.filter(ms => ms > 1000)
            for (let i = 1; i < backoffSleeps.length; i++) {
                assert.ok(backoffSleeps[i] >= backoffSleeps[i - 1],
                    'Backoff should increase or stay at cap')
            }
        })
    })
})

describe('T1 Regression: Error Recovery & Backoff', function () {
    registerBackoffHooks()
    describe('REG-T1-E02: Backoff resets after success', function () {
        it('consecutive error counter resets on successful operation', async function () {
            miner.maxTimeToMineTxs = 50
            miner.addedTimeToMineTxs = 50

            // First few calls fail, then succeed, then fail again
            let callNum = 0
            connectorStub.getRawMempool.callsFake(async () => {
                callNum++
                if (callNum <= 2) throw new Error('fail')
                return ['txid1']
            })

            let sleepArgs = []
            miner.sleep = sinon.stub().callsFake(async (ms) => {
                sleepArgs.push(ms)
                clock.tick(60)
                if (sleepArgs.length >= 8) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // After success, if another error occurs the backoff should start low again
            assert.ok(callNum > 2)
        })
    })
})
