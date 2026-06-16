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
 * T2 Regression Tests — Full Regression (E2E)
 *
 * End-to-end regression tests against a StatefulMockNode that simulates
 * a real Bitcoin Core regtest node. Validates the complete pipeline:
 * wallet lifecycle, mempool monitoring, block generation, and API
 * interactions with real (but fast) async behavior.
 *
 * Target runtime: < 10 minutes
 * Trigger: nightly; before releases; after dependency upgrades
 */

const assert = require('assert')
const sinon = require('sinon')
const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
const StatefulMockNode = require('../e2e/helpers/StatefulMockNode')

describe('T2 Regression: Full E2E Pipeline', function () {
    let node

    before(async function () {
        node = new StatefulMockNode()
        await node.start()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    after(async function () {
        sinon.restore()
        await node.stop()
    })

    function createMiner() {
        return new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')
    }

    async function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    async function waitFor(conditionFn, timeoutMs = 5000) {
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
            if (conditionFn()) return true
            await sleep(20)
        }
        return false
    }

    // ═══════════════════════════════════════════════════════════════════
    // REG-T2-001: Wallet Lifecycle — Fresh Start
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T2-001: Wallet lifecycle — fresh start', function () {
        beforeEach(function () {
            node.reset()
        })

        it('creates wallet and mines 101 blocks on fresh node', async function () {
            const miner = createMiner()
            await miner.prepareWallet()

            assert.strictEqual(node.wallet.exists, true)
            assert.strictEqual(node.wallet.loaded, true)
            assert.strictEqual(node.wallet.name, 'xchain_regtest_wallet')
            assert.strictEqual(node.height, 101)
            assert.strictEqual(node.callsFor('createwallet').length, 1)
            assert.deepStrictEqual(node.callsFor('generatetoaddress')[0].params[0], 101)
            assert.ok(miner.walletAddress)
            assert.ok(miner.walletAddress.startsWith('bcrt'))

            const balance = await miner.connector.getBalance()
            assert.ok(balance > 0)
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // REG-T2-002: Wallet Lifecycle — Restart (already loaded)
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T2-002: Wallet lifecycle — restart', function () {
        beforeEach(function () {
            node.reset()
            node._rpc_createwallet(['xchain_regtest_wallet'])
            node._rpc_generatetoaddress([110, 'bcrt1qseed'])
            node.calls = []
        })

        it('skips creation when wallet is already loaded', async function () {
            const heightBefore = node.height
            const miner = createMiner()
            await miner.prepareWallet()

            assert.strictEqual(node.callsFor('createwallet').length, 0)
            assert.strictEqual(node.callsFor('loadwallet').length, 0)
            assert.strictEqual(node.height, heightBefore)
            assert.strictEqual(node.callsFor('generatetoaddress').length, 0)
            assert.ok(miner.walletAddress)
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // REG-T2-003: Wallet Lifecycle — Exists but unloaded
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T2-003: Wallet lifecycle — exists but unloaded', function () {
        beforeEach(function () {
            node.reset()
            node.wallet = { exists: true, loaded: false, name: 'xchain_regtest_wallet' }
            // Seed blocks and balance
            for (let i = 0; i < 110; i++) {
                node.height++
                node.pendingRewards.push({ height: node.height, amount: 5000000000 })
                node.blocks.push({ hash: node._generateHash(), height: node.height, txids: [], previousHash: '00' })
            }
            node._matureCoinbases()
            node.calls = []
        })

        it('loads wallet without creating it', async function () {
            const miner = createMiner()
            await miner.prepareWallet()

            assert.strictEqual(node.callsFor('loadwallet').length, 1)
            assert.strictEqual(node.callsFor('createwallet').length, 0)
            assert.ok(miner.walletAddress)
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // REG-T2-004: Mining Loop — Mempool Detection and Block Generation
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T2-004: Mining loop — mempool detection', function () {
        let miner, startPromise

        beforeEach(function () {
            node.reset()
            node._rpc_createwallet(['xchain_regtest_wallet'])
            node._rpc_generatetoaddress([110, 'bcrt1qseed'])
            node.calls = []

            miner = createMiner()

            // Fast polling
            const originalSleep = miner.sleep.bind(miner)
            miner.sleep = async (ms) => {
                if (miner._shutdown) throw new Error('__E2E_SHUTDOWN__')
                await originalSleep(10)
            }
        })

        afterEach(async function () {
            miner._shutdown = true
            if (startPromise) {
                try { await startPromise } catch (e) {
                    if (e.message !== '__E2E_SHUTDOWN__') throw e
                }
            }
            if (miner && miner._sigTermHandler) {
                process.removeListener('SIGTERM', miner._sigTermHandler)
            }
        })

        it('detects mempool transaction and mines a block', async function () {
            miner.maxTimeToMineTxs = 200
            miner.addedTimeToMineTxs = 80

            startPromise = miner.start().catch(e => {
                if (e.message !== '__E2E_SHUTDOWN__') throw e
            })

            // Wait for mining loop to start
            const started = await waitFor(() => miner.keepMining, 3000)
            assert.ok(started, 'Mining loop did not start')

            const heightBefore = node.height
            node.injectMempoolTx('txid_reg_001')

            // Wait for the miner to mine a block
            const mined = await waitFor(() => node.height > heightBefore, 3000)
            assert.ok(mined, 'Miner did not mine the transaction')

            // Transaction should be cleared from mempool
            assert.strictEqual(node.mempool.length, 0)
        })

        it('does not mine when mempool is empty', async function () {
            miner.maxTimeToMineTxs = 100
            miner.addedTimeToMineTxs = 50

            startPromise = miner.start().catch(e => {
                if (e.message !== '__E2E_SHUTDOWN__') throw e
            })

            await waitFor(() => miner.keepMining, 3000)

            const heightBefore = node.height
            await sleep(300)

            assert.strictEqual(node.height, heightBefore,
                'Should not mine with empty mempool')
        })

        it('mines multiple blocks across timer resets', async function () {
            miner.maxTimeToMineTxs = 150
            miner.addedTimeToMineTxs = 80

            startPromise = miner.start().catch(e => {
                if (e.message !== '__E2E_SHUTDOWN__') throw e
            })

            await waitFor(() => miner.keepMining, 3000)

            const heightBefore = node.height

            // Inject tx, wait for it to be mined, then inject another
            node.injectMempoolTx('txid_multi_001')
            const firstMined = await waitFor(() => node.height > heightBefore, 3000)
            assert.ok(firstMined, 'First transaction not mined')

            const heightAfterFirst = node.height
            node.injectMempoolTx('txid_multi_002')
            const secondMined = await waitFor(() => node.height > heightAfterFirst, 3000)
            assert.ok(secondMined, 'Second transaction not mined')
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // REG-T2-005: Mining Loop — Pause/Resume via keepMining
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T2-005: Mining loop — pause and resume', function () {
        let miner, startPromise

        beforeEach(function () {
            node.reset()
            node._rpc_createwallet(['xchain_regtest_wallet'])
            node._rpc_generatetoaddress([110, 'bcrt1qseed'])
            node.calls = []

            miner = createMiner()
            miner.maxTimeToMineTxs = 100
            miner.addedTimeToMineTxs = 50

            const originalSleep = miner.sleep.bind(miner)
            miner.sleep = async (ms) => {
                if (miner._shutdown) throw new Error('__E2E_SHUTDOWN__')
                await originalSleep(10)
            }
        })

        afterEach(async function () {
            miner._shutdown = true
            if (startPromise) {
                try { await startPromise } catch (e) {
                    if (e.message !== '__E2E_SHUTDOWN__') throw e
                }
            }
            if (miner && miner._sigTermHandler) {
                process.removeListener('SIGTERM', miner._sigTermHandler)
            }
        })

        it('pauses mining and resumes with continueMining', async function () {
            startPromise = miner.start().catch(e => {
                if (e.message !== '__E2E_SHUTDOWN__') throw e
            })
            await waitFor(() => miner.keepMining, 3000)

            // Pause mining
            miner.keepMining = false
            const heightBefore = node.height
            node.injectMempoolTx('txid_pause_001')
            await sleep(300)
            assert.strictEqual(node.height, heightBefore,
                'Should not mine while paused')

            // Resume mining
            await miner.continueMining()
            const mined = await waitFor(() => node.height > heightBefore, 3000)
            assert.ok(mined, 'Should mine after resuming')
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // REG-T2-006: Mining Timer Override
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T2-006: Mining timer override via setMiningTime', function () {
        let miner, startPromise

        beforeEach(function () {
            node.reset()
            node._rpc_createwallet(['xchain_regtest_wallet'])
            node._rpc_generatetoaddress([110, 'bcrt1qseed'])
            node.calls = []

            miner = createMiner()

            const originalSleep = miner.sleep.bind(miner)
            miner.sleep = async (ms) => {
                if (miner._shutdown) throw new Error('__E2E_SHUTDOWN__')
                await originalSleep(10)
            }
        })

        afterEach(async function () {
            miner._shutdown = true
            if (startPromise) {
                try { await startPromise } catch (e) {
                    if (e.message !== '__E2E_SHUTDOWN__') throw e
                }
            }
            if (miner && miner._sigTermHandler) {
                process.removeListener('SIGTERM', miner._sigTermHandler)
            }
        })

        it('setMiningTime changes timer behavior', async function () {
            // Start with very long timers
            miner.maxTimeToMineTxs = 60000
            miner.addedTimeToMineTxs = 60000

            startPromise = miner.start().catch(e => {
                if (e.message !== '__E2E_SHUTDOWN__') throw e
            })
            await waitFor(() => miner.keepMining, 3000)

            const heightBefore = node.height
            node.injectMempoolTx('txid_timer_001')
            await sleep(200)
            // Long timers — should not have mined yet
            assert.strictEqual(node.height, heightBefore,
                'Should not mine with 60s timers in 200ms')

            // Override to fast timers
            await miner.setMiningTime(1000, 1000)

            // Now it should mine within ~1s
            const mined = await waitFor(() => node.height > heightBefore, 3000)
            assert.ok(mined, 'Should mine after timer override')
        })

        it('setDefaultMiningTime restores defaults', async function () {
            await miner.setMiningTime(5000, 2000)
            assert.strictEqual(miner.maxTimeToMineTxs, 5000)
            assert.strictEqual(miner.addedTimeToMineTxs, 2000)

            await miner.setDefaultMiningTime()
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // REG-T2-007: send_funds via Connector
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T2-007: send_funds creates a real transaction', function () {
        beforeEach(function () {
            node.reset()
            node._rpc_createwallet(['xchain_regtest_wallet'])
            node._rpc_generatetoaddress([110, 'bcrt1qseed'])
            node.calls = []
        })

        it('send_funds produces a transaction in the mempool', async function () {
            const miner = createMiner()
            await miner.prepareWallet()

            const address = await miner.connector.getNewAddress()
            const txid = await miner.sendFundsToAddress(address, 1.0)

            assert.ok(txid, 'Should return a txid')
            assert.ok(node.mempool.length > 0, 'Transaction should be in mempool')
            assert.ok(node.mempool.some(m => m.txid === txid),
                'The specific txid should be in the mempool')
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // REG-T2-008: Error Resilience — Mining loop survives RPC errors
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T2-008: Mining loop survives transient RPC errors', function () {
        let miner, startPromise

        beforeEach(function () {
            node.reset()
            node._rpc_createwallet(['xchain_regtest_wallet'])
            node._rpc_generatetoaddress([110, 'bcrt1qseed'])
            node.calls = []

            miner = createMiner()

            const originalSleep = miner.sleep.bind(miner)
            miner.sleep = async (ms) => {
                if (miner._shutdown) throw new Error('__E2E_SHUTDOWN__')
                await originalSleep(10)
            }
        })

        afterEach(async function () {
            miner._shutdown = true
            if (startPromise) {
                try { await startPromise } catch (e) {
                    if (e.message !== '__E2E_SHUTDOWN__') throw e
                }
            }
            if (miner && miner._sigTermHandler) {
                process.removeListener('SIGTERM', miner._sigTermHandler)
            }
        })

        it('recovers from transient RPC errors and mines', async function () {
            startPromise = miner.start().catch(e => {
                if (e.message !== '__E2E_SHUTDOWN__') throw e
            })
            await waitFor(() => miner.keepMining, 3000)

            // Inject RPC errors
            const realHandler = node._rpc_getrawmempool.bind(node)
            let errorCount = 0
            node._rpc_getrawmempool = function () {
                errorCount++
                if (errorCount <= 3) {
                    const err = new Error('Connection lost')
                    err.rpcCode = -1
                    throw err
                }
                return realHandler()
            }

            await sleep(200)

            // Restore and inject a transaction
            node._rpc_getrawmempool = realHandler
            miner.maxTimeToMineTxs = 300
            miner.addedTimeToMineTxs = 80
            const heightBefore = node.height
            node.injectMempoolTx('txid_resilience_001')

            const mined = await waitFor(() => node.height > heightBefore, 3000)
            assert.ok(mined, 'Miner should recover from RPC errors and mine')
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // REG-T2-009: Chain State Progression
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T2-009: Chain state progresses correctly', function () {
        beforeEach(function () {
            node.reset()
        })

        it('blockchain height and balance increase after mining', async function () {
            const miner = createMiner()
            await miner.prepareWallet()

            const heightAfterSetup = node.height
            assert.strictEqual(heightAfterSetup, 101)

            // Mine additional blocks
            await miner.generateBlocks(10)
            assert.strictEqual(node.height, 111)

            // Balance should have increased
            const balance = await miner.connector.getBalance()
            assert.ok(balance > 0)
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // REG-T2-010: SIGTERM Graceful Shutdown
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T2-010: Graceful shutdown via _shutdown flag', function () {
        beforeEach(function () {
            node.reset()
            node._rpc_createwallet(['xchain_regtest_wallet'])
            node._rpc_generatetoaddress([110, 'bcrt1qseed'])
            node.calls = []
        })

        it('mining loop exits when _shutdown is set', async function () {
            const miner = createMiner()

            const originalSleep = miner.sleep.bind(miner)
            miner.sleep = async (ms) => {
                if (miner._shutdown) throw new Error('__E2E_SHUTDOWN__')
                await originalSleep(10)
            }

            const startPromise = miner.start().catch(e => {
                if (e.message !== '__E2E_SHUTDOWN__') throw e
            })
            await waitFor(() => miner.keepMining, 3000)

            miner._shutdown = true

            // Should exit within a short time
            await Promise.race([
                startPromise,
                sleep(2000).then(() => { throw new Error('Loop did not exit in time') }),
            ])

            if (miner._sigTermHandler) {
                process.removeListener('SIGTERM', miner._sigTermHandler)
            }
        })
    })
})
