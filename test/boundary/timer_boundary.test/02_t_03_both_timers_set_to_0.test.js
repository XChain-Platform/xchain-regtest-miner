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

    // ─── T-03: Both timers = 0 ─────────────────────────────────────────

    describe('T-03: both timers set to 0', function () {
        it('mines on the very next poll after first tx detected', async function () {
            miner.maxTimeToMineTxs = 0
            miner.addedTimeToMineTxs = 0

            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert(connectorStub.generateToAddress.called,
                'Should mine on next poll with both timers at 0')
        })
    })
})
