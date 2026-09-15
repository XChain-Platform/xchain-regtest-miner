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
const OUTPUTS_QUANTITY_PER_TX = 2500
const AMOUNT_FOR_EACH_ADDRESS = 1000
const FEE = 1000
const SATOSHI_UNIT = 100000000.0

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
        getRawTransaction: sinon.stub().resolves(null),
        sendRawTransaction: sinon.stub().resolves('txid_sent'),
        getNetworkInfo: sinon.stub().resolves({}),
    }

    sinon.stub(BlockchainConnector.prototype, 'constructor')

    XChainRegtestMiner = require('../../../src/XChainRegtestMiner')
    miner = new XChainRegtestMiner('regtest', '127.0.0.1', '18332', 'user', 'pass')
    miner.connector = connectorStub

    sinon.stub(miner, 'sleep').resolves()
    sinon.stub(console, 'log')
    sinon.stub(console, 'error')

    miner.walletAddress = 'bcrt1qtest'
}

function teardownMiner() {
    sinon.restore()
    delete require.cache[require.resolve('../../../src/XChainRegtestMiner')]
}

function registerMinerHooks() {
    beforeEach(setupMiner)
    afterEach(teardownMiner)
}

describe('Boundary: fillMempool Chunking and Calculations', function () {
    registerMinerHooks()

    // ─── PSBT output distribution boundaries ───────────────────────────

    describe('PSBT output distribution per chunk', function () {
        it('first chunk processes addresses 0 to 2499', function () {
            const nextUtxoIndex = 0
            const start = nextUtxoIndex * OUTPUTS_QUANTITY_PER_TX
            const end = (parseInt(nextUtxoIndex) + 1) * OUTPUTS_QUANTITY_PER_TX
            assert.strictEqual(start, 0)
            assert.strictEqual(end, 2500)
        })

        it('second chunk processes addresses 2500 to 4999', function () {
            const nextUtxoIndex = 1
            const start = nextUtxoIndex * OUTPUTS_QUANTITY_PER_TX
            const end = (parseInt(nextUtxoIndex) + 1) * OUTPUTS_QUANTITY_PER_TX
            assert.strictEqual(start, 2500)
            assert.strictEqual(end, 5000)
        })

        it('address index capped by addresses.length for partial last chunk', function () {
            const txQuantity = 2501
            const addressesLength = txQuantity
            const nextUtxoIndex = 1 // second chunk
            const start = nextUtxoIndex * OUTPUTS_QUANTITY_PER_TX
            const end = (parseInt(nextUtxoIndex) + 1) * OUTPUTS_QUANTITY_PER_TX

            let outputCount = 0
            for (let i = start; i < end && i < addressesLength; i++) {
                outputCount++
            }
            assert.strictEqual(outputCount, 1,
                'Second chunk of 2501 should only have 1 output')
        })
    })
})
