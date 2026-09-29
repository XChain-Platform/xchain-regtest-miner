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

const OURS = 'xchain_regtest_wallet'

let XChainRegtestMiner
let miner
let connectorStub

function registerMinerHooks() {
    beforeEach(function () {
        connectorStub = {
            getWalletInfo: sinon.stub(),
            listWallets: sinon.stub().resolves(null),
            loadWallet: sinon.stub().resolves({ name: OURS }),
            createWallet: sinon.stub().resolves({ name: OURS }),
            getNewAddress: sinon.stub(),
            getBalance: sinon.stub().resolves(50.0),
            getBlockchainInfo: sinon.stub().resolves({ blocks: 200 }),
            generateToAddress: sinon.stub().resolves(['blockhash1']),
            sendToAddress: sinon.stub().resolves('txid_abc'),
            setTxFee: sinon.stub().resolves(true),
            setWalletName: sinon.stub(),
        }
        // The first address comes from the base-URL probe, the second from a pinned wallet.
        connectorStub.getNewAddress.onFirstCall().resolves('bcrt1qprobe')
        connectorStub.getNewAddress.resolves('bcrt1qours')

        XChainRegtestMiner = require('../../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('bitcoin-regtest', undefined, '18332', 'user', 'pass')
        miner.connector = connectorStub
        sinon.stub(miner, 'sleep').resolves()
        sinon.stub(console, 'log')
        sinon.stub(console, 'warn')
        sinon.stub(console, 'error')
    })

    afterEach(function () {
        sinon.restore()
        delete require.cache[require.resolve('../../../src/XChainRegtestMiner')]
    })
}

function probeSucceededTests() {
    it('pins its own wallet when the probe was answered by it', async function () {
        connectorStub.getWalletInfo.resolves({ walletname: OURS })
        await miner.prepareWallet()
        assert(connectorStub.setWalletName.calledOnceWith(OURS))
        assert(connectorStub.loadWallet.notCalled)
        assert(connectorStub.createWallet.notCalled)
        assert.strictEqual(miner.walletAddress, 'bcrt1qprobe')
    })

    it('loads and pins its own wallet when a foreign wallet answered the probe', async function () {
        connectorStub.getWalletInfo.resolves({ walletname: 'cosigner_test' })
        await miner.prepareWallet()
        assert(connectorStub.loadWallet.calledOnceWith(OURS))
        assert(connectorStub.setWalletName.calledOnceWith(OURS))
        assert(connectorStub.setWalletName.calledBefore(connectorStub.getNewAddress.secondCall))
        assert.strictEqual(miner.walletAddress, 'bcrt1qours', 'the foreign wallet address must be discarded')
    })

    it('treats Core\'s unnamed default wallet as foreign', async function () {
        connectorStub.getWalletInfo.resolves({ walletname: '' })
        await miner.prepareWallet()
        assert(connectorStub.loadWallet.calledOnceWith(OURS))
        assert.strictEqual(miner.walletAddress, 'bcrt1qours')
    })

    it('stays on the base URL when the daemon reports no wallet name (Dogecoin v1.14)', async function () {
        connectorStub.getWalletInfo.resolves({ walletversion: 130000, balance: 1 })
        await miner.prepareWallet()
        assert(connectorStub.setWalletName.notCalled)
        assert(connectorStub.loadWallet.notCalled)
        assert.strictEqual(miner.walletAddress, 'bcrt1qprobe')
    })

    it('keeps the probed address when wallet info cannot be read, with few retries', async function () {
        connectorStub.getWalletInfo.rejects(new Error('Error getting wallet info'))
        await miner.prepareWallet()
        assert.strictEqual(connectorStub.getWalletInfo.firstCall.args[0], 3)
        assert(connectorStub.setWalletName.notCalled)
        assert(connectorStub.loadWallet.notCalled)
        assert.strictEqual(miner.walletAddress, 'bcrt1qprobe')
    })
}

function alreadyLoadedTests() {
    it('treats its own wallet as loaded when loadwallet refuses because it already is', async function () {
        connectorStub.loadWallet.rejects(new Error('Error loading wallet'))
        connectorStub.listWallets.resolves(['cosigner_test', OURS])
        await miner.ensureWalletLoaded()
        assert(connectorStub.createWallet.notCalled)
        assert(connectorStub.setWalletName.calledOnceWith(OURS))
    })

    it('creates the wallet when loadwallet reports it not found, whatever listwallets says', async function () {
        connectorStub.loadWallet.rejects(loadError({ rpcCode: -18 }))
        connectorStub.listWallets.resolves(['cosigner_test'])
        await miner.ensureWalletLoaded()
        assert(connectorStub.createWallet.calledOnceWith(OURS))
    })

    it('retries the load instead of creating when the daemon cannot list wallets', async function () {
        connectorStub.loadWallet.onFirstCall().rejects(loadError({}))
        connectorStub.listWallets.rejects(new TypeError('listWallets is not a function'))
        await miner.ensureWalletLoaded()
        assert.strictEqual(connectorStub.loadWallet.callCount, 2)
        assert(connectorStub.createWallet.notCalled)
        assert(connectorStub.setWalletName.calledOnceWith(OURS))
    })
}

// The connector's fixed-message load error, classified the way loadWallet tags it.
function loadError({ rpcCode, timedOut } = {}) {
    const err = new Error('Error loading wallet')
    if (rpcCode !== undefined) err.rpcCode = rpcCode
    if (timedOut) err.timedOut = true
    return err
}

function loadClassificationTests() {
    it('treats -35 already loaded as loaded without asking listwallets', async function () {
        connectorStub.loadWallet.rejects(loadError({ rpcCode: -35 }))
        await miner.ensureWalletLoaded()
        assert(connectorStub.createWallet.notCalled)
        assert(connectorStub.listWallets.notCalled)
        assert(connectorStub.setWalletName.calledOnceWith(OURS))
    })

    it('treats a timed-out load as loaded once listwallets names the wallet', async function () {
        connectorStub.loadWallet.rejects(loadError({ timedOut: true }))
        connectorStub.listWallets.resolves([OURS])
        await miner.ensureWalletLoaded()
        assert(connectorStub.createWallet.notCalled)
        assert.strictEqual(connectorStub.loadWallet.callCount, 1)
    })

    it('rides out -28 warmup and loads on a later attempt without creating', async function () {
        connectorStub.loadWallet.onFirstCall().rejects(loadError({ rpcCode: -28 }))
        connectorStub.loadWallet.onSecondCall().rejects(loadError({ rpcCode: -28 }))
        connectorStub.listWallets.resolves([])
        await miner.ensureWalletLoaded()
        assert.strictEqual(connectorStub.loadWallet.callCount, 3)
        assert(connectorStub.createWallet.notCalled)
        assert(miner.sleep.calledWith(5000))
    })

    it('never creates over a load still in progress, and gives up with a clear error', async function () {
        // Core answers a second load of a wallet still loading with -4 "Wallet already loading".
        connectorStub.loadWallet.rejects(loadError({ rpcCode: -4 }))
        connectorStub.listWallets.resolves([])
        await assert.rejects(
            () => miner.ensureWalletLoaded(),
            /Could not load wallet 'xchain_regtest_wallet' on regtest node: the node never confirmed it loaded/
        )
        assert(connectorStub.createWallet.notCalled)
        assert.strictEqual(connectorStub.loadWallet.callCount, 30)
        assert(connectorStub.setWalletName.notCalled)
    })

    it('accepts a create that lost the race to another caller', async function () {
        connectorStub.loadWallet.rejects(loadError({ rpcCode: -18 }))
        connectorStub.createWallet.rejects(new Error('Error creating wallet'))
        connectorStub.listWallets.resolves([OURS])
        await miner.ensureWalletLoaded()
        assert(connectorStub.createWallet.calledOnce)
        assert(connectorStub.setWalletName.calledOnceWith(OURS))
    })

    it('fails fast with the create error when create fails and the wallet is not loaded', async function () {
        connectorStub.loadWallet.rejects(loadError({ rpcCode: -18 }))
        connectorStub.createWallet.rejects(new Error('Error creating wallet'))
        connectorStub.listWallets.resolves([])
        await assert.rejects(() => miner.ensureWalletLoaded(), /Could not create wallet/)
        assert(connectorStub.createWallet.calledOnce)
        assert.strictEqual(connectorStub.loadWallet.callCount, 1)
    })
}

describe('XChainRegtestMiner', function () {
    registerMinerHooks()
    describe('prepareWallet after a successful base-URL probe', probeSucceededTests)
    describe('ensureWalletLoaded with the wallet already loaded', alreadyLoadedTests)
    describe('ensureWalletLoaded load-failure classification', loadClassificationTests)
})
