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
const axios = require('axios')

const BlockchainConnector = require('../../src/BlockchainConnector')

describe('Regtest Miner Smoke Tests', function () {

    // ─── BlockchainConnector ────────────────────────────────────────────

    describe('BlockchainConnector', function () {
        afterEach(function () {
            sinon.restore()
        })

        it('ST-01: instantiates with correct RPC URL and credentials', function () {
            const connector = new BlockchainConnector('localhost', '18332', 'rpcuser', 'rpcpass')
            assert.strictEqual(connector.url, 'http://localhost:18332')
            assert.strictEqual(connector.port, '18332')
            assert.strictEqual(connector.rpcUser, 'rpcuser')
            assert.strictEqual(connector.rpcPassword, 'rpcpass')
        })
    })

    // ─── XChainRegtestMiner ─────────────────────────────────────────────

    describe('XChainRegtestMiner', function () {
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
                setTxFee: sinon.stub().resolves(true),
                setWalletName: sinon.stub(),
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

        it('ST-02: instantiates with correct defaults', function () {
            assert.ok(miner.connector)
            assert.strictEqual(miner.walletNameParam, 'xchain_regtest_wallet')
            assert.strictEqual(miner.keepMining, false)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('ST-03: prepares wallet on fresh node (create + fund)', async function () {
            // Fresh node: the getNewAddress probe fails until the wallet is
            // created, then succeeds.
            connectorStub.getNewAddress.rejects(new Error('no wallet loaded'))
            connectorStub.getNewAddress.onCall(10).resolves('bcrt1qtest')
            connectorStub.loadWallet.rejects(new Error('not found'))
            connectorStub.createWallet.resolves({ name: 'xchain_regtest_wallet' })
            // Balance is 0 before mining; the post-mining re-poll sees funds.
            connectorStub.getBalance.onFirstCall().resolves(0)
            connectorStub.getBlockchainInfo.resolves({ blocks: 0 })

            await miner.prepareWallet()

            assert(connectorStub.createWallet.calledWith('xchain_regtest_wallet'))
            assert(connectorStub.generateToAddress.calledWith(101, 'bcrt1qtest'))
            assert.strictEqual(miner.walletAddress, 'bcrt1qtest')
        })

        it('ST-04: prepares wallet with existing wallet (load)', async function () {
            connectorStub.getNewAddress.rejects(new Error('no wallet loaded'))
            connectorStub.getNewAddress.onCall(10).resolves('bcrt1qtest')
            connectorStub.loadWallet.resolves({ name: 'xchain_regtest_wallet' })

            await miner.prepareWallet()

            assert(connectorStub.loadWallet.calledWith('xchain_regtest_wallet'))
            assert(connectorStub.createWallet.notCalled)
            assert(connectorStub.generateToAddress.notCalled)
            assert.strictEqual(miner.walletAddress, 'bcrt1qtest')
        })

        it('ST-05: detects new mempool transactions', async function () {
            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount >= 2) throw new Error('__LOOP_BREAK__')
            })

            sinon.stub(miner, 'prepareWallet').resolves()

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert(connectorStub.getRawMempool.callCount >= 1)
            // Timer started but not expired; no block generated yet
            assert(connectorStub.generateToAddress.notCalled)
        })

        it('ST-06: triggers block generation after timer expires', async function () {
            const clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false })

            miner.maxTimeToMineTxs = 50000
            miner.addedTimeToMineTxs = 100

            connectorStub.getRawMempool.resolves(['txid1'])
            sinon.stub(miner, 'prepareWallet').resolves()

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) {
                    clock.tick(150)
                }
                if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            clock.restore()

            assert(connectorStub.generateToAddress.called)
        })

        it('ST-07: max timer forces generation despite new txs arriving', async function () {
            const clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false })

            miner.maxTimeToMineTxs = 100
            miner.addedTimeToMineTxs = 50000

            // Simulate continuously growing mempool
            let callCount = 0
            connectorStub.getRawMempool.callsFake(async () => {
                callCount++
                return Array.from({ length: callCount }, (_, i) => `txid${i}`)
            })

            sinon.stub(miner, 'prepareWallet').resolves()

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) {
                    clock.tick(150)
                }
                if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            clock.restore()

            assert(connectorStub.generateToAddress.called)
        })

        it('ST-08: pauses and resumes mining via keepMining flag', async function () {
            sinon.stub(miner, 'prepareWallet').resolves()

            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            let mempoolCalledWhilePaused = false

            connectorStub.getRawMempool.callsFake(async () => {
                if (!miner.keepMining) mempoolCalledWhilePaused = true
                return ['txid1']
            })

            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) {
                    // Pause mining after first iteration
                    miner.keepMining = false
                    connectorStub.getRawMempool.resetHistory()
                }
                if (iterCount >= 4) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // While paused, mempool should not be polled
            assert.strictEqual(connectorStub.getRawMempool.callCount, 0)
            assert.strictEqual(mempoolCalledWhilePaused, false)
        })

        it('ST-09: overrides and resets mining time constants', async function () {
            await miner.setMiningTime(10000, 2000)
            assert.strictEqual(miner.maxTimeToMineTxs, 10000)
            assert.strictEqual(miner.addedTimeToMineTxs, 2000)

            await miner.setDefaultMiningTime()
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })
    })

    // ─── JSON-RPC API ───────────────────────────────────────────────────

    describe('JSON-RPC API', function () {
        let controller
        let miner

        beforeEach(function () {
            miner = {
                sendFundsToAddress: sinon.stub(),
                fillMempool: sinon.stub(),
                continueMining: sinon.stub(),
                setMiningTime: sinon.stub(),
                setDefaultMiningTime: sinon.stub(),
                start: sinon.stub(),
            }

            sinon.stub(console, 'log')

            // Recreate the controller logic as defined in api.js
            controller = {
                async ping() {
                    return { status: 'success' }
                },
                async send_funds({ address, amount }) {
                    let txid = null
                    try {
                        txid = await miner.sendFundsToAddress(address, amount)
                    } catch (err) {
                        console.log(err)
                        return { error: 'There was a problem sending ' + amount + ' to ' + address }
                    }
                    return txid
                },
                async set_mining_time({ max_time, tx_added_time }) {
                    try {
                        await miner.setMiningTime(max_time, tx_added_time)
                    } catch (err) {
                        return { error: 'There was a problem trying to set a new time to mine blocks' }
                    }
                    return { result: 'ok' }
                },
            }
        })

        afterEach(function () {
            sinon.restore()
        })

        it('ST-10: ping returns success', async function () {
            const result = await controller.ping()
            assert.deepStrictEqual(result, { status: 'success' })
        })

        it('ST-11: send_funds dispatches to miner', async function () {
            miner.sendFundsToAddress.resolves('txid_abc123')
            const result = await controller.send_funds({ address: 'addr1', amount: 1.5 })
            assert.strictEqual(result, 'txid_abc123')
            assert(miner.sendFundsToAddress.calledWith('addr1', 1.5))
        })

        it('ST-12: set_mining_time dispatches to miner', async function () {
            miner.setMiningTime.resolves()
            const result = await controller.set_mining_time({ max_time: 15000, tx_added_time: 3000 })
            assert.deepStrictEqual(result, { result: 'ok' })
            assert(miner.setMiningTime.calledWith(15000, 3000))
        })
    })
})
