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

function setUpMiner() {
    connectorStub = {
        getWalletInfo: sinon.stub().resolves({ walletname: 'test' }),
        loadWallet: sinon.stub().resolves(),
        createWallet: sinon.stub().resolves(),
        getNewAddress: sinon.stub().resolves('bcrt1qtest'),
        getBalance: sinon.stub().resolves(50.0),
        getBlockchainInfo: sinon.stub().resolves({ blocks: 200 }),
        generateToAddress: sinon.stub().resolves(['blockhash1']),
        getRawMempool: sinon.stub().resolves([]),
        sendToAddress: sinon.stub().resolves('txid_abc'),
        setTxFee: sinon.stub().resolves(true),
        setWalletName: sinon.stub(),
        getRawTransaction: sinon.stub().resolves('0200000001'),
        sendRawTransaction: sinon.stub().resolves('txid_sent'),
    }

    sinon.stub(BlockchainConnector.prototype, 'constructor')

    XChainRegtestMiner = require('../../../src/XChainRegtestMiner')
    miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
    miner.connector = connectorStub

    sinon.stub(miner, 'sleep').resolves()
    sinon.stub(console, 'log')
    sinon.stub(console, 'error')
}

function tearDownMiner() {
    sinon.restore()
    delete require.cache[require.resolve('../../../src/XChainRegtestMiner')]
    if (clock) {
        clock.restore()
        clock = null
    }
}

describe('Fuzz: mining loop state machine', function () {
    beforeEach(setUpMiner)
    afterEach(tearDownMiner)

    // ─── Mempool timer reset after mining ────────────────────────────

    describe('timer state resets after block generation', function () {
        it('resets all timer state after successful mining', async function () {
            clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false })
            miner.maxTimeToMineTxs = 50
            miner.addedTimeToMineTxs = 50

            let phase = 'filling' // filling -> mined -> verify
            let mempoolReturns = ['txid1']

            connectorStub.getRawMempool.callsFake(async () => {
                return mempoolReturns
            })

            let generateCount = 0
            connectorStub.generateToAddress.callsFake(async () => {
                generateCount++
                // After mining, empty the mempool
                mempoolReturns = []
                return ['hash']
            })

            let loopCount = 0
            miner.sleep.callsFake(async () => {
                loopCount++
                clock.tick(20)

                // After block is mined and mempool is empty, add new txs
                if (generateCount === 1 && loopCount > 5) {
                    mempoolReturns = ['txid_new']
                }

                if (loopCount >= 15) {
                    miner.keepMining = false
                    throw new Error('__LOOP_BREAK__')
                }
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // Should have mined at least 2 blocks (first batch + second batch)
            assert.ok(generateCount >= 2,
                `Expected at least 2 block generations, got ${generateCount}`)
        })
    })
})
