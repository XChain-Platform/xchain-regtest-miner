// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.
//
// : walletReady is set once, as prepareWallet's last statement, and no
// reorg path ever re-evaluates it. A simulated reorg deep enough to disconnect
// the matured coinbase therefore left ping/status reporting a fund-capable
// wallet while send_funds could no longer succeed, with nothing in the exported
// state contradicting it.
//
// The fix does NOT flip walletReady, because the container health probe reads it
// as startup-completion () and would report the miner degraded for the
// whole of every deliberate drill. It re-reads the balance at both reorg termini
// and exports wallet_balance / wallet_funded, so the drill has an honest live
// signal and the stale flag is no longer the only thing on offer.
//
// The control below pins the half that is deliberately unchanged: wallet_ready
// stays true across the invalidate. A run that flipped it would mean the
// semantics call had been made without the operator, not that the fix improved.

const assert = require('assert')
const sinon = require('sinon')

const BlockchainConnector = require('../../src/BlockchainConnector')

describe('reorg wallet-funds refresh ()', function () {
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
            setTxFee: sinon.stub().resolves(true),
            invalidateBlock: sinon.stub().resolves('invalidated'),
            reconsiderBlock: sinon.stub().resolves('reconsidered'),
        }

        XChainRegtestMiner = require('../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        miner.connector = connectorStub

        sinon.stub(miner, 'sleep').resolves()
        sinon.stub(console, 'log')

        // Post-startup state: prepared wallet, observed funds, mining running.
        miner.walletAddress = 'bcrt1qtest'
        miner.walletReady = true
        miner.balance = 50.0
        miner.keepMining = true
    })

    afterEach(function () {
        sinon.restore()
        delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
    })

    it('reports the wallet unfunded once an invalidate strands the balance at 0', async function () {
        connectorStub.getBalance.resolves(0)

        const result = await miner.invalidateBlock('deadbeef')

        assert.strictEqual(result, 'invalidated')
        assert.strictEqual(miner.getStatus().wallet_balance, 0)
        assert.strictEqual(miner.getStatus().wallet_funded, false)
    })

    it('leaves wallet_ready true across the invalidate (the health probe reads it as startup-completion)', async function () {
        connectorStub.getBalance.resolves(0)

        await miner.invalidateBlock('deadbeef')

        assert.strictEqual(miner.getStatus().wallet_ready, true)
    })

    it('reports the wallet funded again once reconsider re-settles the chain', async function () {
        connectorStub.getBalance.resolves(0)
        await miner.invalidateBlock('deadbeef')
        assert.strictEqual(miner.getStatus().wallet_funded, false)

        connectorStub.getBalance.resolves(50.0)
        const result = await miner.reconsiderBlock('deadbeef')

        assert.strictEqual(result, 'reconsidered')
        assert.strictEqual(miner.getStatus().wallet_balance, 50.0)
        assert.strictEqual(miner.getStatus().wallet_funded, true)
    })

    it('still resolves the reorg RPC when the balance re-read throws', async function () {
        connectorStub.getBalance.rejects(new Error('node unreachable'))

        const result = await miner.invalidateBlock('deadbeef')

        assert.strictEqual(result, 'invalidated')
        // Unknown is not funded: a failed read must not read as a healthy wallet.
        assert.strictEqual(miner.getStatus().wallet_balance, null)
        assert.strictEqual(miner.getStatus().wallet_funded, false)
    })

    it('restores prior auto-mining state after reconsider, refresh included', async function () {
        connectorStub.getBalance.resolves(50.0)

        await miner.reconsiderBlock('deadbeef')

        assert.strictEqual(miner.keepMining, true)
    })

    it('reports unfunded before prepareWallet has ever read a balance', function () {
        const fresh = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        assert.strictEqual(fresh.getStatus().wallet_balance, null)
        assert.strictEqual(fresh.getStatus().wallet_funded, false)
    })
})
