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

function reconsiderBlockTestsA() {
    it('calls connector.reconsiderBlock with the hash', async function () {
        connectorStub.reconsiderBlock = sinon.stub().resolves(true)
        const result = await miner.reconsiderBlock('deadbeef')
        assert.strictEqual(result, true)
        assert(connectorStub.reconsiderBlock.calledWith('deadbeef'))
    })

    it('rejects when blockHash is not a string', async function () {
        connectorStub.reconsiderBlock = sinon.stub().resolves(true)
        await assert.rejects(() => miner.reconsiderBlock(''), /blockHash must be a non-empty string/)
    })

    // The reorg primitives must not overlap an in-flight generateToAddress.
    // invalidateBlock self-guarded; reconsiderBlock relied on the caller having
    // invalidated first, so a standalone reconsider (or one after continue_mining)
    // could race a mine into the node's chain re-evaluation.
    // Asserted through the barrier's own effects rather than by spying on
    // pauseMining: reconsiderBlock takes a refcounted reorg pause (so two
    // concurrent reconsiders cannot stall each other) and a method spy would
    // only be re-asserting which private helper is in fashion.
    it('takes the mine-barrier before reaching the node', async function () {
        let releaseInFlightMine
        miner._generateQueue = new Promise((resolve) => { releaseInFlightMine = resolve })
        miner.keepMining = true

        let miningWhenRpcRan = null
        connectorStub.reconsiderBlock = sinon.stub().callsFake(async () => {
            miningWhenRpcRan = miner.keepMining
            return true
        })

        const run = miner.reconsiderBlock('deadbeef')
        await new Promise((resolve) => setImmediate(resolve))
        assert(connectorStub.reconsiderBlock.notCalled,
            'the RPC must wait behind the in-flight mine')
        assert.strictEqual(miner.keepMining, false, 'the pause is claimed before the barrier')

        releaseInFlightMine()
        await run
        assert(connectorStub.reconsiderBlock.calledOnce)
        assert.strictEqual(miningWhenRpcRan, false, 'auto-mining must be off during the RPC')
    })
}

function reconsiderBlockTestsB() {
    it('restores auto-mining when it was running (reorg sequence ends here)', async function () {
        connectorStub.reconsiderBlock = sinon.stub().resolves(true)
        miner.keepMining = true
        await miner.reconsiderBlock('deadbeef')
        assert.strictEqual(miner.keepMining, true, 'a standalone reconsider must not silently stall the miner')
    })

    it('leaves mining paused when it was already paused (invalidate → mine → reconsider)', async function () {
        connectorStub.reconsiderBlock = sinon.stub().resolves(true)
        miner.keepMining = false
        await miner.reconsiderBlock('deadbeef')
        assert.strictEqual(miner.keepMining, false, 'the documented flow resumes via continueMining()')
    })

    it('restores mining state even when the node RPC throws', async function () {
        connectorStub.reconsiderBlock = sinon.stub().rejects(new Error('node down'))
        miner.keepMining = true
        await assert.rejects(() => miner.reconsiderBlock('deadbeef'), /node down/)
        assert.strictEqual(miner.keepMining, true)
    })
}

describe('XChainRegtestMiner', function () {
    registerMinerHooks()
    describe('reconsiderBlock', reconsiderBlockTestsA)
    describe('reconsiderBlock', reconsiderBlockTestsB)
})
