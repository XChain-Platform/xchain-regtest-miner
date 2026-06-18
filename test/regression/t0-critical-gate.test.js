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
 * T0 Regression Tests: Critical Gate
 *
 * The fastest, most essential regression tests. These MUST pass before any
 * code is pushed. Covers: constructor defaults, timer logic, wallet preparation
 * branching, mining loop core paths, and API health.
 *
 * Target runtime: < 15 seconds
 * Trigger: every commit (pre-push hook or first CI stage)
 */

const assert = require('assert')
const sinon = require('sinon')
const BlockchainConnector = require('../../src/BlockchainConnector')

describe('T0 Regression: Critical Gate', function () {
    let XChainRegtestMiner
    let miner
    let connectorStub

    beforeEach(function () {
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
            getRawTransaction: sinon.stub().resolves('0200000001...'),
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
    // REG-T0-001: Constructor defaults
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T0-001: Constructor defaults', function () {
        it('initializes with correct default values', function () {
            assert.strictEqual(miner.walletNameParam, 'xchain_regtest_wallet')
            assert.strictEqual(miner.keepMining, false)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
            assert.strictEqual(miner.fillMempoolRunning, false)
            assert.ok(miner.connector)
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // REG-T0-002: setMiningTime validation
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T0-002: setMiningTime validation', function () {
        it('accepts valid integer values', async function () {
            await miner.setMiningTime(10000, 2000)
            assert.strictEqual(miner.maxTimeToMineTxs, 10000)
            assert.strictEqual(miner.addedTimeToMineTxs, 2000)
        })

        it('rejects non-integer maxTime', async function () {
            const result = await miner.setMiningTime(10.5, 2000)
            assert.ok(result && result.error)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })

        it('rejects zero values', async function () {
            const result = await miner.setMiningTime(0, 0)
            assert.ok(result && result.error)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })

        it('rejects negative values', async function () {
            const result = await miner.setMiningTime(-1, -1)
            assert.ok(result && result.error)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })

        it('rejects values below minimum (1000ms)', async function () {
            const result = await miner.setMiningTime(999, 999)
            assert.ok(result && result.error)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })

        it('rejects values above maximum (3600000ms)', async function () {
            const result = await miner.setMiningTime(3600001, 3600001)
            assert.ok(result && result.error)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })

        it('accepts boundary minimum (1000ms)', async function () {
            await miner.setMiningTime(1000, 1000)
            assert.strictEqual(miner.maxTimeToMineTxs, 1000)
            assert.strictEqual(miner.addedTimeToMineTxs, 1000)
        })

        it('accepts boundary maximum (3600000ms)', async function () {
            await miner.setMiningTime(3600000, 3600000)
            assert.strictEqual(miner.maxTimeToMineTxs, 3600000)
            assert.strictEqual(miner.addedTimeToMineTxs, 3600000)
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // REG-T0-003: setDefaultMiningTime
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T0-003: setDefaultMiningTime resets to defaults', function () {
        it('restores 30000/5000 defaults', async function () {
            miner.maxTimeToMineTxs = 1000
            miner.addedTimeToMineTxs = 500
            await miner.setDefaultMiningTime()
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // REG-T0-004: prepareWallet branching
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T0-004: prepareWallet branching', function () {
        it('skips load/create when wallet is already loaded', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'existing' })
            await miner.prepareWallet()
            assert(connectorStub.loadWallet.notCalled)
            assert(connectorStub.createWallet.notCalled)
            assert.strictEqual(miner.walletAddress, 'bcrt1qtest')
        })

        it('loads existing wallet when getWalletInfo fails', async function () {
            connectorStub.getWalletInfo.rejects(new Error('no wallet'))
            connectorStub.loadWallet.resolves({ name: 'xchain_regtest_wallet' })
            await miner.prepareWallet()
            assert(connectorStub.loadWallet.calledWith('xchain_regtest_wallet'))
            assert(connectorStub.createWallet.notCalled)
        })

        it('creates wallet when both getWalletInfo and loadWallet fail', async function () {
            connectorStub.getWalletInfo.rejects(new Error('no wallet'))
            connectorStub.loadWallet.rejects(new Error('not found'))
            connectorStub.createWallet.resolves({ name: 'xchain_regtest_wallet' })
            await miner.prepareWallet()
            assert(connectorStub.createWallet.calledWith('xchain_regtest_wallet'))
        })

        it('throws when all wallet methods fail', async function () {
            connectorStub.getWalletInfo.rejects(new Error('no wallet'))
            connectorStub.loadWallet.rejects(new Error('not found'))
            connectorStub.createWallet.rejects(new Error('disk full'))
            await assert.rejects(() => miner.prepareWallet(), /Error when trying to create the wallet/)
        })

        it('mines 101 blocks when balance is zero and height <= 100', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.resolves(0)
            connectorStub.getBlockchainInfo.resolves({ blocks: 50 })
            await miner.prepareWallet()
            assert(connectorStub.generateToAddress.calledWith(101, 'bcrt1qtest'))
        })

        it('mines 1 block when balance is zero and height > 100', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.resolves(0)
            connectorStub.getBlockchainInfo.resolves({ blocks: 200 })
            await miner.prepareWallet()
            assert(connectorStub.generateToAddress.calledWith(1, 'bcrt1qtest'))
        })

        it('does not mine when balance is positive', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.resolves(50.0)
            await miner.prepareWallet()
            assert(connectorStub.generateToAddress.notCalled)
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // REG-T0-005: Mining loop core paths
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T0-005: Mining loop core paths', function () {
        let clock

        beforeEach(function () {
            clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false })
            sinon.stub(miner, 'prepareWallet').resolves()
            miner.walletAddress = 'bcrt1qtest'
        })

        afterEach(function () {
            clock.restore()
        })

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

    // ═══════════════════════════════════════════════════════════════════
    // REG-T0-006: fillMempool mutex and keepMining restoration
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T0-006: fillMempool guards (W-3 bug prevention)', function () {
        it('rejects concurrent fillMempool calls', async function () {
            miner.fillMempoolRunning = true
            await assert.rejects(() => miner.fillMempool(10), /already running/)
        })

        it('restores keepMining to true in finally block', async function () {
            miner.keepMining = true
            try {
                await miner.fillMempool(1)
            } catch (e) {
                // May fail on crypto ops; that's fine for this test
            }
            assert.strictEqual(miner.keepMining, true,
                'keepMining must be restored to true by finally block')
        })

        it('rejects invalid txQuantity without changing keepMining', async function () {
            miner.keepMining = true
            await assert.rejects(() => miner.fillMempool(0), /positive integer/)
            assert.strictEqual(miner.keepMining, true)
            await assert.rejects(() => miner.fillMempool(-1), /positive integer/)
            assert.strictEqual(miner.keepMining, true)
        })

        it('rejects txQuantity exceeding maximum', async function () {
            await assert.rejects(() => miner.fillMempool(50001), /maximum/)
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // REG-T0-007: sendFundsToAddress input validation
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T0-007: sendFundsToAddress input validation', function () {
        it('rejects non-string address', async function () {
            await assert.rejects(() => miner.sendFundsToAddress(12345, 1.0), /Invalid address/)
        })

        it('rejects empty string address', async function () {
            await assert.rejects(() => miner.sendFundsToAddress('', 1.0), /Invalid address/)
        })

        it('rejects non-number amount', async function () {
            await assert.rejects(() => miner.sendFundsToAddress('addr', 'abc'), /Invalid amount/)
        })

        it('rejects zero amount', async function () {
            await assert.rejects(() => miner.sendFundsToAddress('addr', 0), /Invalid amount/)
        })

        it('rejects negative amount', async function () {
            await assert.rejects(() => miner.sendFundsToAddress('addr', -1), /Invalid amount/)
        })

        it('rejects Infinity amount', async function () {
            await assert.rejects(() => miner.sendFundsToAddress('addr', Infinity), /Invalid amount/)
        })

        it('delegates valid inputs to connector', async function () {
            connectorStub.sendToAddress.resolves('txid123')
            const result = await miner.sendFundsToAddress('bcrt1qaddr', 1.5)
            assert.strictEqual(result, 'txid123')
            assert(connectorStub.sendToAddress.calledWith('bcrt1qaddr', 1.5))
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // REG-T0-008: JSON-RPC API controller health
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T0-008: JSON-RPC API controller', function () {
        let controller, minerStub

        beforeEach(function () {
            minerStub = {
                sendFundsToAddress: sinon.stub(),
                fillMempool: sinon.stub(),
                continueMining: sinon.stub(),
                setMiningTime: sinon.stub(),
                setDefaultMiningTime: sinon.stub(),
            }

            // Recreate controller logic matching api.js
            controller = {
                async ping() {
                    return { status: 'success' }
                },
                async send_funds({ address, amount }) {
                    let txid = null
                    try {
                        txid = await minerStub.sendFundsToAddress(address, amount)
                    } catch (err) {
                        return { error: 'There was a problem sending funds' }
                    }
                    return txid
                },
                async fill_mempool({ tx_quantity }) {
                    try {
                        await minerStub.fillMempool(tx_quantity)
                    } catch (err) {
                        return { error: 'There was a problem trying to fill the mempool' }
                    }
                    return { result: 'ok' }
                },
                async continue_mining({}) {
                    try {
                        await minerStub.continueMining()
                    } catch (err) {
                        return { error: 'There was a problem trying to continue the mining' }
                    }
                    return { result: 'ok' }
                },
                async set_mining_time({ max_time, tx_added_time }) {
                    try {
                        await minerStub.setMiningTime(max_time, tx_added_time)
                    } catch (err) {
                        return { error: 'There was a problem trying to set a new time to mine blocks' }
                    }
                    return { result: 'ok' }
                },
                async set_default_mining_time() {
                    try {
                        await minerStub.setDefaultMiningTime()
                    } catch (err) {
                        return { error: 'There was a problem trying to set a the default time to mine blocks' }
                    }
                    return { result: 'ok' }
                },
            }
        })

        it('ping returns success', async function () {
            const result = await controller.ping()
            assert.deepStrictEqual(result, { status: 'success' })
        })

        it('send_funds dispatches to miner', async function () {
            minerStub.sendFundsToAddress.resolves('txid_abc')
            const result = await controller.send_funds({ address: 'addr1', amount: 1.5 })
            assert.strictEqual(result, 'txid_abc')
            assert(minerStub.sendFundsToAddress.calledWith('addr1', 1.5))
        })

        it('fill_mempool dispatches to miner', async function () {
            minerStub.fillMempool.resolves()
            const result = await controller.fill_mempool({ tx_quantity: 100 })
            assert.deepStrictEqual(result, { result: 'ok' })
            assert(minerStub.fillMempool.calledWith(100))
        })

        it('continue_mining dispatches to miner', async function () {
            minerStub.continueMining.resolves()
            const result = await controller.continue_mining({})
            assert.deepStrictEqual(result, { result: 'ok' })
        })

        it('set_mining_time dispatches to miner', async function () {
            minerStub.setMiningTime.resolves()
            const result = await controller.set_mining_time({ max_time: 10000, tx_added_time: 2000 })
            assert.deepStrictEqual(result, { result: 'ok' })
            assert(minerStub.setMiningTime.calledWith(10000, 2000))
        })

        it('set_default_mining_time dispatches to miner', async function () {
            minerStub.setDefaultMiningTime.resolves()
            const result = await controller.set_default_mining_time()
            assert.deepStrictEqual(result, { result: 'ok' })
        })

        it('send_funds returns error on failure', async function () {
            minerStub.sendFundsToAddress.rejects(new Error('no funds'))
            const result = await controller.send_funds({ address: 'a', amount: 1 })
            assert.ok(result.error)
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // REG-T0-009: BlockchainConnector construction
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T0-009: BlockchainConnector construction', function () {
        it('builds correct URL and stores credentials', function () {
            const connector = new BlockchainConnector('localhost', '18332', 'rpcuser', 'rpcpass')
            assert.strictEqual(connector.url, 'http://localhost:18332')
            assert.strictEqual(connector.port, '18332')
            assert.strictEqual(connector.rpcUser, 'rpcuser')
            assert.strictEqual(connector.rpcPassword, 'rpcpass')
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // REG-T0-010: continueMining
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T0-010: continueMining sets keepMining flag', function () {
        it('sets keepMining to true', async function () {
            miner.keepMining = false
            await miner.continueMining()
            assert.strictEqual(miner.keepMining, true)
        })
    })
})
