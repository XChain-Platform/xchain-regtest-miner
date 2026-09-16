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
const BlockchainConnector = require('../../src/rpc/blockchain_connector')
const { RPC_RESPONSES } = require('./helpers/fixtures')

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
    delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
    XChainRegtestMiner = require('../../src/XChainRegtestMiner')
    miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
    miner.connector = connector

    sinon.stub(miner, 'sleep').resolves()
    sinon.stub(console, 'log')
    sinon.stub(console, 'error')
}

function restoreMiner() {
    sinon.restore()
    delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
}

// Helper: make the getNewAddress probe fail through all retry
// attempts, then succeed once the wallet has been loaded/created.
function probeFailsThenSucceeds() {
    let probeCalls = 0
    connector.getNewAddress.callsFake(async () => {
        callLog.push('getNewAddress')
        probeCalls++
        if (probeCalls <= 10) throw new Error('No wallet loaded')
        return 'bcrt1qtest'
    })
}

describe('Seam B: XChainRegtestMiner ↔ BlockchainConnector sequences', function () {
    beforeEach(createMiner)
    afterEach(restoreMiner)

    // ─── prepareWallet Sequences ────────────────────────────────────────

    describe('prepareWallet call sequences', function () {
        it('B-1: fresh node, full create+mine sequence', async function () {
            // Probe fails, loadWallet fails, createWallet succeeds
            // balance = 0 → mine 101 blocks, then the re-poll sees funds
            probeFailsThenSucceeds()
            connector.getBalance
                .onFirstCall().callsFake(async () => { callLog.push('getBalance'); return 0 })

            await miner.prepareWallet()

            assert.deepStrictEqual(callLog, [
                ...Array(10).fill('getNewAddress'),   // bounded probe retries
                'loadWallet(xchain_regtest_wallet)',
                'createWallet(xchain_regtest_wallet)',
                'setWalletName(xchain_regtest_wallet)',
                'getNewAddress',
                'getBalance',
                'generateToAddress(101)',
                'getBalance',                          // post-mining readiness re-poll
                'setTxFee',
            ])
        })

        it('B-2: wallet exists but unloaded, load succeeds, no mining', async function () {
            probeFailsThenSucceeds()
            connector.loadWallet.callsFake(async (name) => {
                callLog.push(`loadWallet(${name})`)
                return { name }
            })

            await miner.prepareWallet()

            assert.deepStrictEqual(callLog, [
                ...Array(10).fill('getNewAddress'),
                'loadWallet(xchain_regtest_wallet)',
                'setWalletName(xchain_regtest_wallet)',
                'getNewAddress',
                'getBalance',
                'setTxFee',
            ])
            assert.strictEqual(connector.createWallet.callCount, 0)
            assert.strictEqual(connector.generateToAddress.callCount, 0)
        })
    })
})

describe('Seam B: XChainRegtestMiner ↔ BlockchainConnector sequences', function () {
    beforeEach(createMiner)
    afterEach(restoreMiner)

    describe('prepareWallet call sequences', function () {
        it('B-3: wallet already loaded and funded, minimal calls', async function () {
            await miner.prepareWallet()

            assert.deepStrictEqual(callLog, [
                'getNewAddress',
                'getBalance',
                'setTxFee',
            ])
            assert.strictEqual(connector.loadWallet.callCount, 0)
            assert.strictEqual(connector.createWallet.callCount, 0)
            assert.strictEqual(connector.generateToAddress.callCount, 0)
        })

        it('B-4: wallet loaded, empty balance, aged chain, still mines to maturity depth', async function () {
            connector.getBalance
                .onFirstCall().callsFake(async () => { callLog.push('getBalance'); return 0 })
            connector.getBlockchainInfo.callsFake(async () => {
                callLog.push('getBlockchainInfo')
                return { blocks: 150 }
            })

            await miner.prepareWallet()

            // Chain height no longer matters: fewer blocks would only add an
            // immature coinbase, so the miner always mines 101.
            assert.ok(callLog.includes('generateToAddress(101)'),
                'Should mine 101 blocks even at height > 100')
        })

        it('B-5: empty balance, height exactly 100, mines 101 blocks', async function () {
            connector.getBalance
                .onFirstCall().callsFake(async () => { callLog.push('getBalance'); return 0 })
            connector.getBlockchainInfo.callsFake(async () => {
                callLog.push('getBlockchainInfo')
                return { blocks: 100 }
            })

            await miner.prepareWallet()

            assert.ok(callLog.includes('generateToAddress(101)'),
                'Should mine 101 blocks at height <= 100')
        })
    })
})

describe('Seam B: XChainRegtestMiner ↔ BlockchainConnector sequences', function () {
    beforeEach(createMiner)
    afterEach(restoreMiner)

    describe('prepareWallet call sequences', function () {
        it('B-8: all wallet methods fail, throws', async function () {
            connector.getNewAddress.callsFake(async () => {
                callLog.push('getNewAddress')
                throw new Error('No wallet loaded')
            })
            connector.createWallet.callsFake(async () => {
                callLog.push('createWallet(xchain_regtest_wallet)')
                throw new Error('Disk full')
            })

            await assert.rejects(
                () => miner.prepareWallet(),
                /Could not create wallet/
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

})
