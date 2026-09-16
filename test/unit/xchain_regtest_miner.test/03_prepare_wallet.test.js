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

// Stub BlockchainConnector before requiring XChainRegtestMiner
const BlockchainConnector = require('../../../src/rpc/blockchain_connector')

let XChainRegtestMiner
let miner
let connectorStub

function registerMinerHooks() {
    beforeEach(function () {
        // Create a stub for every BlockchainConnector method
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
            getRawTransaction: sinon.stub().resolves('0200000001...'),
            sendRawTransaction: sinon.stub().resolves('txid_sent'),
            getNetworkInfo: sinon.stub().resolves({}),
            setWalletName: sinon.stub(),
        }

        // Stub the BlockchainConnector constructor
        sinon.stub(BlockchainConnector.prototype, 'constructor')

        XChainRegtestMiner = require('../../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', undefined, '18332', 'user', 'pass')
        miner.connector = connectorStub

        sinon.stub(miner, 'sleep').resolves()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    afterEach(function () {
        sinon.restore()
        // Clear module cache so fresh require works each time
        delete require.cache[require.resolve('../../../src/XChainRegtestMiner')]
    })
}

// ─── prepareWallet ──────────────────────────────────────────────────

// Helper: a getNewAddress stub whose probe attempts all fail (exhausting
// the PROBE_MAX_ATTEMPTS=10 retry loop so prepareWallet falls through to the
// load/create path), then resolves for the post-load address fetch.
function probeAlwaysFails(addr = 'bcrt1qnew') {
    let calls = 0
    return sinon.stub().callsFake(async () => {
        calls++
        if (calls <= 10) throw new Error('wallet not ready')
        return addr
    })
}

function prepareWalletTestsA() {
    it('skips load/create when wallet is already loaded', async function () {
        connectorStub.getWalletInfo.resolves({ walletname: 'existing' })
        await miner.prepareWallet()
        assert(connectorStub.loadWallet.notCalled)
        assert(connectorStub.createWallet.notCalled)
        assert.strictEqual(miner.walletAddress, 'bcrt1qtest')
    })

    it('loads the named wallet when the getNewAddress probe never succeeds', async function () {
        connectorStub.getNewAddress = probeAlwaysFails()
        connectorStub.loadWallet.resolves({ name: 'xchain_regtest_wallet' })
        await miner.prepareWallet()
        assert(connectorStub.loadWallet.calledWith('xchain_regtest_wallet'))
        assert(connectorStub.createWallet.notCalled)
    })

    it('creates the wallet when the probe fails and loadWallet fails', async function () {
        connectorStub.getNewAddress = probeAlwaysFails()
        connectorStub.loadWallet.rejects(new Error('not found'))
        connectorStub.createWallet.resolves({ name: 'xchain_regtest_wallet' })
        await miner.prepareWallet()
        assert(connectorStub.createWallet.calledWith('xchain_regtest_wallet'))
    })

    it('throws when the probe fails and both load and create fail', async function () {
        connectorStub.getNewAddress = sinon.stub().rejects(new Error('wallet not ready'))
        connectorStub.loadWallet.rejects(new Error('not found'))
        connectorStub.createWallet.rejects(new Error('disk full'))
        await assert.rejects(() => miner.prepareWallet(), /Could not create wallet/)
    })

    it('gets a new address after wallet is ready', async function () {
        connectorStub.getWalletInfo.resolves({ walletname: 'w' })
        await miner.prepareWallet()
        assert(connectorStub.getNewAddress.calledOnce)
        assert.strictEqual(miner.walletAddress, 'bcrt1qtest')
    })
}

function prepareWalletTestsB() {
    it('mines 101 blocks when balance is zero and height <= 100', async function () {
        connectorStub.getWalletInfo.resolves({ walletname: 'w' })
        connectorStub.getBalance.onFirstCall().resolves(0)
        connectorStub.getBlockchainInfo.resolves({ blocks: 50 })
        await miner.prepareWallet()
        assert(connectorStub.generateToAddress.calledWith(101, 'bcrt1qtest'))
    })

    it('mines 101 blocks when balance is zero and height > 100 (coinbase maturity)', async function () {
        connectorStub.getWalletInfo.resolves({ walletname: 'w' })
        connectorStub.getBalance.onFirstCall().resolves(0)
        connectorStub.getBlockchainInfo.resolves({ blocks: 200 })
        await miner.prepareWallet()
        assert(connectorStub.generateToAddress.calledWith(101, 'bcrt1qtest'))
    })

    it('does not mine when balance is positive', async function () {
        connectorStub.getWalletInfo.resolves({ walletname: 'w' })
        connectorStub.getBalance.resolves(50.0)
        await miner.prepareWallet()
        assert(connectorStub.generateToAddress.notCalled)
    })

    it('mines 101 blocks at exactly height 100', async function () {
        connectorStub.getWalletInfo.resolves({ walletname: 'w' })
        connectorStub.getBalance.onFirstCall().resolves(0)
        connectorStub.getBlockchainInfo.resolves({ blocks: 100 })
        await miner.prepareWallet()
        assert(connectorStub.generateToAddress.calledWith(101, 'bcrt1qtest'))
    })

    it('mines 101 blocks at height 101 (coinbase maturity)', async function () {
        connectorStub.getWalletInfo.resolves({ walletname: 'w' })
        connectorStub.getBalance.onFirstCall().resolves(0)
        connectorStub.getBlockchainInfo.resolves({ blocks: 101 })
        await miner.prepareWallet()
        assert(connectorStub.generateToAddress.calledWith(101, 'bcrt1qtest'))
    })
}

function prepareWalletTestsC() {
    it('treats a never-succeeding probe as no wallet loaded (falls through to loadWallet)', async function () {
        connectorStub.getNewAddress = probeAlwaysFails()
        connectorStub.loadWallet.resolves({ name: 'w' })
        await miner.prepareWallet()
        assert(connectorStub.loadWallet.calledOnce)
    })

    it('retries the getNewAddress probe while a legacy daemon\'s wallet is still loading', async function () {
        // Dogecoin v1.14 accepts RPC requests before its wallet has
        // finished loading; the first few getNewAddress calls reject
        // with a wallet-not-ready error. The retry loop should ride out
        // the brief window without falling through to createWallet
        // (which v1.14 doesn't implement).
        const probe = sinon.stub()
        probe.onCall(0).rejects(new Error('Wallet file not specified'))
        probe.onCall(1).rejects(new Error('Wallet file not specified'))
        probe.onCall(2).rejects(new Error('Wallet file not specified'))
        probe.onCall(3).resolves('dogecoin_regtest_addr')
        connectorStub.getNewAddress = probe

        await miner.prepareWallet()
        assert.strictEqual(probe.callCount, 4, 'probe should retry until it succeeds')
        assert(connectorStub.createWallet.notCalled, 'createWallet must not be reached on a legacy daemon')
        assert.strictEqual(miner.walletAddress, 'dogecoin_regtest_addr')
    })
}

describe('XChainRegtestMiner', function () {
    registerMinerHooks()
    describe('prepareWallet', prepareWalletTestsA)
    describe('prepareWallet', prepareWalletTestsB)
    describe('prepareWallet', prepareWalletTestsC)
})
