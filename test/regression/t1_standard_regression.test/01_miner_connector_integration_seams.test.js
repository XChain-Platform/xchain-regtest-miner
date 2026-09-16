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
// Section B: Integration Seam Regression (Miner↔Connector Sequences)
// ═══════════════════════════════════════════════════════════════════════

let XChainRegtestMiner, miner, connector, callLog

function registerIntegrationHooks() {
    beforeEach(function () {
        callLog = []

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
            setTxFee: sinon.stub().resolves(true),
            setWalletName: sinon.stub(),
        }

        sinon.stub(BlockchainConnector.prototype, 'constructor')
        delete require.cache[require.resolve('../../../src/XChainRegtestMiner')]
        XChainRegtestMiner = require('../../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        miner.connector = connector

        sinon.stub(miner, 'sleep').resolves()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    afterEach(function () {
        sinon.restore()
        delete require.cache[require.resolve('../../../src/XChainRegtestMiner')]
    })
}

function registerMiningLoopHooks() {
    beforeEach(function () {
        sinon.stub(miner, 'prepareWallet').resolves()
        miner.walletAddress = 'bcrt1qtest'
        miner.maxTimeToMineTxs = 50
        miner.addedTimeToMineTxs = 30
    })
}

// The timer only requests shutdown; settling is the start() promise
// resolving, which is the loop stating it has left the while. The
// fixed "give it one more cycle" 20ms grace period could resolve mid-cycle,
// letting the assertions read a still-moving callCount and leaking a
// live loop into the next test. (Same helper, same fix, as
// test/integration/miner_connector.test.js.)
function runLoopWithTimeout(timeoutMs) {
    return new Promise(async (resolve) => {
        const timer = setTimeout(() => {
            miner._shutdown = true
        }, timeoutMs)

        miner.sleep.callsFake(async () => {
            return new Promise(r => setTimeout(r, 5))
        })

        try {
            await miner.start()
        } catch (e) {
            // Loop exited
        }

        clearTimeout(timer)
        resolve()
    })
}

describe('T1 Regression: Miner↔Connector Integration Seams', function () {
    registerIntegrationHooks()

    // ─── REG-T1-B01: Fresh node, full create+mine sequence ──────────

    describe('REG-T1-B01: prepareWallet call sequences', function () {
        it('fresh node: probe fails→loadWallet→createWallet→getNewAddress→getBalance→generateToAddress(101)→getBalance', async function () {
            let probeCalls = 0
            connector.getNewAddress.callsFake(async () => {
                callLog.push('getNewAddress')
                probeCalls++
                if (probeCalls <= 10) throw new Error('No wallet loaded')
                return 'bcrt1qtest'
            })
            connector.getBalance.onFirstCall().callsFake(async () => {
                callLog.push('getBalance')
                return 0
            })

            await miner.prepareWallet()

            assert.deepStrictEqual(callLog, [
                ...Array(10).fill('getNewAddress'),   // bounded probe retries
                'loadWallet(xchain_regtest_wallet)',
                'createWallet(xchain_regtest_wallet)',
                'getNewAddress',
                'getBalance',
                'generateToAddress(101)',
                'getBalance',                          // post-mining readiness re-poll
            ])
        })

        it('existing wallet: probe fails→loadWallet→getNewAddress→getBalance', async function () {
            let probeCalls = 0
            connector.getNewAddress.callsFake(async () => {
                callLog.push('getNewAddress')
                probeCalls++
                if (probeCalls <= 10) throw new Error('No wallet loaded')
                return 'bcrt1qtest'
            })
            connector.loadWallet.callsFake(async (name) => {
                callLog.push(`loadWallet(${name})`)
                return { name }
            })

            await miner.prepareWallet()

            assert.deepStrictEqual(callLog, [
                ...Array(10).fill('getNewAddress'),
                'loadWallet(xchain_regtest_wallet)',
                'getNewAddress',
                'getBalance',
            ])
            assert.strictEqual(connector.createWallet.callCount, 0)
            assert.strictEqual(connector.generateToAddress.callCount, 0)
        })
    })
})

describe('T1 Regression: Miner↔Connector Integration Seams', function () {
    registerIntegrationHooks()

    describe('REG-T1-B01: prepareWallet call sequences', function () {
        it('loaded + funded: getNewAddress→getBalance (minimal calls)', async function () {
            await miner.prepareWallet()

            assert.deepStrictEqual(callLog, [
                'getNewAddress',
                'getBalance',
            ])
        })

        it('loaded, empty balance, aged chain → still mines to maturity depth (101)', async function () {
            connector.getBalance.onFirstCall().callsFake(async () => {
                callLog.push('getBalance')
                return 0
            })
            connector.getBlockchainInfo.callsFake(async () => {
                callLog.push('getBlockchainInfo')
                return { blocks: 150 }
            })

            await miner.prepareWallet()

            assert.ok(callLog.includes('generateToAddress(101)'))
        })

        it('stores wallet address and balance', async function () {
            connector.getWalletInfo.resolves({ walletname: 'w' })
            connector.getNewAddress.resolves('bcrt1qspecific')
            connector.getBalance.resolves(123.45)

            await miner.prepareWallet()

            assert.strictEqual(miner.walletAddress, 'bcrt1qspecific')
            assert.strictEqual(miner.balance, 123.45)
        })
    })
})

describe('T1 Regression: Miner↔Connector Integration Seams', function () {
    registerIntegrationHooks()

    // ─── REG-T1-B02: Mining loop integration ───────────────────────

    describe('REG-T1-B02: Mining loop integration sequences', function () {
        registerMiningLoopHooks()

        it('mines when mempool has transactions and timer expires', async function () {
            connector.getRawMempool.resolves(['txid1'])
            await runLoopWithTimeout(200)
            assert.ok(connector.generateToAddress.callCount >= 1)
        })

        it('no mining with empty mempool', async function () {
            connector.getRawMempool.resolves([])
            await runLoopWithTimeout(100)
            assert.strictEqual(connector.generateToAddress.callCount, 0)
        })

        it('recovers from getRawMempool errors', async function () {
            let callCount = 0
            connector.getRawMempool.callsFake(async () => {
                callCount++
                if (callCount <= 3) throw new Error('Connection lost')
                return ['txid1']
            })
            await runLoopWithTimeout(300)
            assert.ok(callCount > 3, 'Should have retried after errors')
        })

        it('recovers from generateToAddress errors', async function () {
            connector.getRawMempool.resolves(['txid1'])
            let genCount = 0
            connector.generateToAddress.callsFake(async () => {
                genCount++
                if (genCount === 1) throw new Error('Block generation failed')
                return ['blockhash']
            })
            await runLoopWithTimeout(300)
            assert.ok(genCount >= 2, 'Should have retried block generation')
        })
    })
})

describe('T1 Regression: Miner↔Connector Integration Seams', function () {
    registerIntegrationHooks()

    // ─── REG-T1-B03: sendFundsToAddress delegation ─────────────────

    describe('REG-T1-B03: sendFundsToAddress delegation', function () {
        it('passes through to connector.sendToAddress', async function () {
            connector.sendToAddress.resolves('txid_result')
            const result = await miner.sendFundsToAddress('bcrt1qaddr', 2.5)
            assert.strictEqual(result, 'txid_result')
            assert(connector.sendToAddress.calledWith('bcrt1qaddr', 2.5))
        })
    })

    // ─── REG-T1-B04: generateBlocks delegation ─────────────────────

    describe('REG-T1-B04: generateBlocks delegation', function () {
        it('passes count and wallet address to connector', async function () {
            miner.walletAddress = 'bcrt1qreward'
            await miner.generateBlocks(10)
            assert(connector.generateToAddress.calledWith(10, 'bcrt1qreward'))
        })

        it('logs plural message for multiple blocks', async function () {
            miner.walletAddress = 'addr'
            await miner.generateBlocks(3)
            assert(console.log.calledWithMatch(/3 new blocks have been generated/))
        })

        it('logs singular message for one block', async function () {
            miner.walletAddress = 'addr'
            await miner.generateBlocks(1)
            assert(console.log.calledWithMatch(/A new block has been generated/))
        })
    })
})
