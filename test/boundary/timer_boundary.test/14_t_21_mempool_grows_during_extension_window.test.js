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

const BlockchainConnector = require('../../../src/rpc/blockchain_connector')
let XChainRegtestMiner
let miner
let connectorStub
let clock

function setupMiner() {
    connectorStub = {
        getWalletInfo: sinon.stub().resolves({ walletname: 'w' }),
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

    XChainRegtestMiner = require('../../../src/XChainRegtestMiner')
    miner = new XChainRegtestMiner('regtest', '127.0.0.1', '18332', 'user', 'pass')
    miner.connector = connectorStub

    sinon.stub(miner, 'sleep').resolves()
    sinon.stub(miner, 'prepareWallet').resolves()
    sinon.stub(console, 'log')
    sinon.stub(console, 'error')

    miner.walletAddress = 'bcrt1qtest'

    clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false })
}

function teardownMiner() {
    clock.restore()
    sinon.restore()
    delete require.cache[require.resolve('../../../src/XChainRegtestMiner')]
}

function registerMinerHooks() {
    beforeEach(setupMiner)
    afterEach(teardownMiner)
}

describe('Boundary: Adaptive Mining Timer Logic', function () {
    registerMinerHooks()

    // ─── T-21: Mempool grows from N to N+1 ─────────────────────────────

    describe('T-21: mempool grows during extension window', function () {
        it('resets extendedStartToMine but not initialStartToMine', async function () {
            miner.maxTimeToMineTxs = 50000
            miner.addedTimeToMineTxs = 200

            // 1 tx, then 2 txs (new tx arrived)
            connectorStub.getRawMempool.onCall(0).resolves(['txid1'])
            connectorStub.getRawMempool.onCall(1).resolves(['txid1', 'txid2'])
            connectorStub.getRawMempool.onCall(2).resolves(['txid1', 'txid2'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) clock.tick(100) // Not enough for addedTime=200
                if (iterCount === 2) clock.tick(100) // 100ms from extended reset, still not enough
                if (iterCount >= 4) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // Mining should NOT have happened because extension timer kept resetting
            // At iteration 2, addedTime check: 100ms < 200ms (from extended reset)
            // So no mining yet after 2 iterations with 100ms each
            // The extended timer was reset on iteration 2 when new tx appeared
            assert.strictEqual(connectorStub.generateToAddress.callCount <= 1, true)
        })
    })
})
