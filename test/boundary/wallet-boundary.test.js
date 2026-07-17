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

describe('Boundary: Wallet Preparation', function () {
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
            getRawTransaction: sinon.stub().resolves('0200000001...'),
            sendRawTransaction: sinon.stub().resolves('txid_sent'),
            getNetworkInfo: sinon.stub().resolves({}),
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

    // ─── W-01: Wallet loaded, balance > 0, height > 100 ───────────────

    describe('W-01: wallet loaded, balance > 0, height > 100', function () {
        it('takes no mining action', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.resolves(50.0)
            connectorStub.getBlockchainInfo.resolves({ blocks: 200 })

            await miner.prepareWallet()

            assert(connectorStub.generateToAddress.notCalled)
            assert(connectorStub.loadWallet.notCalled)
            assert(connectorStub.createWallet.notCalled)
        })
    })

    // ─── W-02: Wallet loaded, balance = 0, height = 0 ─────────────────

    describe('W-02: wallet loaded, balance = 0, height = 0', function () {
        it('mines 101 blocks for coinbase maturity', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            // First check sees 0; the post-mining re-poll must observe a
            // positive balance or prepareWallet refuses to mark ready.
            connectorStub.getBalance.onFirstCall().resolves(0)
            connectorStub.getBlockchainInfo.resolves({ blocks: 0 })

            await miner.prepareWallet()

            assert(connectorStub.generateToAddress.calledWith(101, 'bcrt1qtest'))
        })
    })

    // ─── W-03: Wallet loaded, balance = 0, height = 99 ────────────────

    describe('W-03: wallet loaded, balance = 0, height = 99', function () {
        it('mines 101 blocks (height < 100 branch)', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.onFirstCall().resolves(0)
            connectorStub.getBlockchainInfo.resolves({ blocks: 99 })

            await miner.prepareWallet()

            assert(connectorStub.generateToAddress.calledWith(101, 'bcrt1qtest'))
        })
    })

    // ─── W-04: Wallet loaded, balance = 0, height = 100 ───────────────

    describe('W-04: wallet loaded, balance = 0, height = 100', function () {
        it('mines 101 blocks (height <= 100, uses <= comparison)', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.onFirstCall().resolves(0)
            connectorStub.getBlockchainInfo.resolves({ blocks: 100 })

            await miner.prepareWallet()

            // Code checks: blockchainInfo["blocks"] <= 100
            // At exactly 100, this is true, so 101 blocks are mined
            assert(connectorStub.generateToAddress.calledWith(101, 'bcrt1qtest'),
                'Height exactly 100 should trigger 101-block mining')
        })
    })

    // ─── W-05: Wallet loaded, balance = 0, height = 101 ───────────────

    describe('W-05: wallet loaded, balance = 0, height = 101', function () {
        it('mines to maturity (101 blocks) and only reports ready once balance is observed positive', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBlockchainInfo.resolves({ blocks: 101 })
            connectorStub.getBalance.onCall(0).resolves(0)
            connectorStub.getBalance.onCall(1).resolves(0)
            connectorStub.getBalance.onCall(2).resolves(25.0)

            await miner.prepareWallet()

            assert(connectorStub.generateToAddress.calledWith(101, 'bcrt1qtest'),
                'a >100-block chain must mine to the same maturity depth as the fresh-chain branch')
            assert.strictEqual(miner.walletReady, true)
        })

        it('does not mark the wallet ready when balance stays 0 after mining to maturity', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBlockchainInfo.resolves({ blocks: 101 })
            connectorStub.getBalance.resolves(0)

            await assert.rejects(
                () => miner.prepareWallet(),
                /balance still 0/
            )
            assert.strictEqual(miner.walletReady, false)
        })
    })

    // ─── W-06: Wallet not loaded, exists on disk ───────────────────────

    describe('W-06: wallet not loaded, exists on disk', function () {
        it('loads wallet without creating', async function () {
            // No wallet usable yet: the getNewAddress probe fails through all
            // attempts, then succeeds once loadWallet has run.
            connectorStub.getNewAddress.rejects(new Error('no wallet loaded'))
            connectorStub.getNewAddress.onCall(10).resolves('bcrt1qtest')
            connectorStub.loadWallet.resolves({ name: 'xchain_regtest_wallet' })

            await miner.prepareWallet()

            assert(connectorStub.loadWallet.calledWith('xchain_regtest_wallet'))
            assert(connectorStub.createWallet.notCalled)
        })
    })

    // ─── W-07: Wallet not loaded, does not exist ───────────────────────

    describe('W-07: wallet not loaded, does not exist', function () {
        it('creates wallet after load fails', async function () {
            connectorStub.getNewAddress.rejects(new Error('no wallet loaded'))
            connectorStub.getNewAddress.onCall(10).resolves('bcrt1qtest')
            connectorStub.loadWallet.rejects(new Error('not found'))
            connectorStub.createWallet.resolves({ name: 'xchain_regtest_wallet' })

            await miner.prepareWallet()

            assert(connectorStub.createWallet.calledWith('xchain_regtest_wallet'))
        })
    })

    // ─── W-08: createWallet fails all retries ──────────────────────────

    describe('W-08: createWallet fails all retries', function () {
        it('throws wallet creation error', async function () {
            connectorStub.getNewAddress.rejects(new Error('no wallet loaded'))
            connectorStub.loadWallet.rejects(new Error('not found'))
            connectorStub.createWallet.rejects(new Error('disk full'))

            await assert.rejects(
                () => miner.prepareWallet(),
                /Could not create wallet/
            )
        })
    })

    // ─── W-09: getWalletInfo permanently fails ─────────────────────────

    describe('W-09: getNewAddress probe exhausts retries (not infinite loop)', function () {
        it('catches probe failure and proceeds to load/create flow', async function () {
            // The probe retries a bounded number of times, then falls through
            // to the load/create path instead of looping forever.
            connectorStub.getNewAddress.rejects(new Error('connection refused'))
            connectorStub.getNewAddress.onCall(10).resolves('bcrt1qtest')
            connectorStub.loadWallet.resolves({ name: 'w' })

            await miner.prepareWallet()

            // Should proceed to loadWallet
            assert(connectorStub.loadWallet.calledOnce)
        })
    })

    // ─── W-10: Balance at floating-point boundary ──────────────────────

    describe('W-10: balance at floating-point boundary', function () {
        it('treats very small positive balance as positive (no mining)', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.resolves(0.00000001) // 1 satoshi

            await miner.prepareWallet()

            // 0.00000001 > 0 is true, so balance <= 0 is false
            assert(connectorStub.generateToAddress.notCalled,
                '1 satoshi balance should prevent bootstrap mining')
        })

        it('treats exactly 0 as needing mining', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBlockchainInfo.resolves({ blocks: 200 })
            connectorStub.getBalance.onCall(0).resolves(0)
            connectorStub.getBalance.onCall(1).resolves(25.0)

            await miner.prepareWallet()

            assert(connectorStub.generateToAddress.called,
                'Balance exactly 0 should trigger mining')
        })

        it('treats negative balance (theoretical) as needing mining', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBlockchainInfo.resolves({ blocks: 200 })
            connectorStub.getBalance.onCall(0).resolves(-0.001) // Shouldn't happen, but boundary
            connectorStub.getBalance.onCall(1).resolves(25.0)

            await miner.prepareWallet()

            assert(connectorStub.generateToAddress.called,
                'Negative balance satisfies <= 0')
        })

        it('handles -0 correctly', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBlockchainInfo.resolves({ blocks: 200 })
            connectorStub.getBalance.onCall(0).resolves(-0)
            connectorStub.getBalance.onCall(1).resolves(25.0)

            await miner.prepareWallet()

            // -0 <= 0 is true in JavaScript
            assert(connectorStub.generateToAddress.called,
                '-0 satisfies <= 0 check')
        })
    })

    // ─── W-11: getWalletInfo returns null ──────────────────────────────

    describe('W-11: probe returns no usable address', function () {
        it('treats a failed probe as no wallet loaded', async function () {
            connectorStub.getNewAddress.rejects(new Error('no wallet loaded'))
            connectorStub.getNewAddress.onCall(10).resolves('bcrt1qtest')
            connectorStub.loadWallet.resolves({ name: 'w' })

            await miner.prepareWallet()

            // walletInfo == null is true, so it proceeds to load/create
            assert(connectorStub.loadWallet.calledOnce)
        })
    })

    // ─── Additional boundary: wallet address assignment ────────────────

    describe('walletAddress assignment', function () {
        it('sets walletAddress from getNewAddress result', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getNewAddress.resolves('bcrt1qspecific_addr')

            await miner.prepareWallet()

            assert.strictEqual(miner.walletAddress, 'bcrt1qspecific_addr')
        })

        it('propagates error when getNewAddress fails', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getNewAddress.rejects(new Error('address generation failed'))

            await assert.rejects(
                () => miner.prepareWallet(),
                /address generation failed/
            )
        })
    })
})
