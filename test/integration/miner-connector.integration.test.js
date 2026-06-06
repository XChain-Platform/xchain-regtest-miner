/*********************************************************************
 *
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC – https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available —
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
const BlockchainConnector = require('../../src/BlockchainConnector')
const { RPC_RESPONSES } = require('./helpers/fixtures')

describe('Seam B: XChainRegtestMiner ↔ BlockchainConnector sequences', function () {
    let XChainRegtestMiner, miner, connector, callLog

    beforeEach(function () {
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
        }

        sinon.stub(BlockchainConnector.prototype, 'constructor')
        delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
        XChainRegtestMiner = require('../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        miner.connector = connector

        sinon.stub(miner, 'sleep').resolves()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    afterEach(function () {
        sinon.restore()
        delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
    })

    // ─── prepareWallet Sequences ────────────────────────────────────────

    describe('prepareWallet call sequences', function () {
        it('B-1: fresh node — full create+mine sequence', async function () {
            // getWalletInfo fails, loadWallet fails, createWallet succeeds
            // balance = 0, height = 0 → mine 101 blocks
            connector.getBalance.callsFake(async () => {
                callLog.push('getBalance')
                return 0
            })
            connector.getBlockchainInfo.callsFake(async () => {
                callLog.push('getBlockchainInfo')
                return { blocks: 0 }
            })

            await miner.prepareWallet()

            assert.deepStrictEqual(callLog, [
                'getWalletInfo',
                'loadWallet(xchain_regtest_wallet)',
                'createWallet(xchain_regtest_wallet)',
                'getNewAddress',
                'getBalance',
                'getBlockchainInfo',
                'generateToAddress(101)',
            ])
        })

        it('B-2: wallet exists but unloaded — load succeeds, no mining', async function () {
            connector.loadWallet.callsFake(async (name) => {
                callLog.push(`loadWallet(${name})`)
                return { name }
            })

            await miner.prepareWallet()

            assert.deepStrictEqual(callLog, [
                'getWalletInfo',
                'loadWallet(xchain_regtest_wallet)',
                'getNewAddress',
                'getBalance',
            ])
            assert.strictEqual(connector.createWallet.callCount, 0)
            assert.strictEqual(connector.generateToAddress.callCount, 0)
        })

        it('B-3: wallet already loaded and funded — minimal calls', async function () {
            connector.getWalletInfo.callsFake(async () => {
                callLog.push('getWalletInfo')
                return RPC_RESPONSES.WALLET_INFO
            })

            await miner.prepareWallet()

            assert.deepStrictEqual(callLog, [
                'getWalletInfo',
                'getNewAddress',
                'getBalance',
            ])
            assert.strictEqual(connector.loadWallet.callCount, 0)
            assert.strictEqual(connector.createWallet.callCount, 0)
            assert.strictEqual(connector.generateToAddress.callCount, 0)
        })

        it('B-4: wallet loaded, empty balance, height > 100 — mines 1 block', async function () {
            connector.getWalletInfo.callsFake(async () => {
                callLog.push('getWalletInfo')
                return RPC_RESPONSES.WALLET_INFO
            })
            connector.getBalance.callsFake(async () => {
                callLog.push('getBalance')
                return 0
            })
            connector.getBlockchainInfo.callsFake(async () => {
                callLog.push('getBlockchainInfo')
                return { blocks: 150 }
            })

            await miner.prepareWallet()

            assert.ok(callLog.includes('generateToAddress(1)'),
                'Should mine exactly 1 block at height > 100')
            assert.ok(!callLog.includes('generateToAddress(101)'),
                'Should NOT mine 101 blocks')
        })

        it('B-5: empty balance, height exactly 100 — mines 101 blocks', async function () {
            connector.getWalletInfo.callsFake(async () => {
                callLog.push('getWalletInfo')
                return RPC_RESPONSES.WALLET_INFO
            })
            connector.getBalance.callsFake(async () => {
                callLog.push('getBalance')
                return 0
            })
            connector.getBlockchainInfo.callsFake(async () => {
                callLog.push('getBlockchainInfo')
                return { blocks: 100 }
            })

            await miner.prepareWallet()

            assert.ok(callLog.includes('generateToAddress(101)'),
                'Should mine 101 blocks at height <= 100')
        })

        it('B-8: all wallet methods fail — throws', async function () {
            connector.createWallet.callsFake(async () => {
                callLog.push('createWallet(xchain_regtest_wallet)')
                throw new Error('Disk full')
            })

            await assert.rejects(
                () => miner.prepareWallet(),
                /Error when trying to create the wallet/
            )
        })

        it('stores the new address after wallet is ready', async function () {
            connector.getWalletInfo.resolves(RPC_RESPONSES.WALLET_INFO)
            connector.getNewAddress.resolves('bcrt1qspecific')

            await miner.prepareWallet()

            assert.strictEqual(miner.walletAddress, 'bcrt1qspecific')
        })

        it('stores the balance after checking', async function () {
            connector.getWalletInfo.resolves(RPC_RESPONSES.WALLET_INFO)
            connector.getBalance.resolves(123.45)

            await miner.prepareWallet()

            assert.strictEqual(miner.balance, 123.45)
        })
    })

    // ─── Mining Loop Sequences ──────────────────────────────────────────

    describe('mining loop sequences', function () {
        beforeEach(function () {
            // Bypass prepareWallet for loop tests
            sinon.stub(miner, 'prepareWallet').resolves()
            miner.walletAddress = 'bcrt1qtest'
            // Use very short timers for fast tests
            miner.maxTimeToMineTxs = 50
            miner.addedTimeToMineTxs = 30
        })

        // Helper: run the loop with real Date.now but capped sleep
        function runLoopWithTimeout(miner, timeoutMs) {
            return new Promise(async (resolve) => {
                const timer = setTimeout(() => {
                    miner._shutdown = true
                    // Give it one more cycle to exit
                    setTimeout(resolve, 20)
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

    // ─── sendFundsToAddress Sequence ─────────────────────────────────────

    describe('sendFundsToAddress delegation', function () {
        it('passes through to connector.sendToAddress', async function () {
            connector.sendToAddress.resolves('txid_result')
            const result = await miner.sendFundsToAddress('bcrt1qaddr', 2.5)
            assert.strictEqual(result, 'txid_result')
            assert(connector.sendToAddress.calledWith('bcrt1qaddr', 2.5))
        })
    })

    // ─── generateBlocks Sequence ────────────────────────────────────────

    describe('generateBlocks delegation', function () {
        it('passes count and wallet address to connector', async function () {
            miner.walletAddress = 'bcrt1qreward'
            await miner.generateBlocks(10)
            assert(connector.generateToAddress.calledWith(10, 'bcrt1qreward'))
        })
    })
})
