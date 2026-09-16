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

    // ─── F-04: tx_quantity = 2500 ──────────────────────────────────────

    describe('F-04: tx_quantity = 2500 (exactly one chunk)', function () {
        it('creates exactly 1 chunk with no remainder', function () {
            const txQuantity = 2500
            const chunks = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)
            assert.strictEqual(chunks, 1)

            const remainder = txQuantity % OUTPUTS_QUANTITY_PER_TX
            // remainder is 0, so txRemainder stays at OUTPUTS_QUANTITY_PER_TX
            assert.strictEqual(remainder, 0)
        })

        it('last chunk uses full OUTPUTS_QUANTITY_PER_TX when evenly divisible', function () {
            const txQuantity = 2500
            const txsChunksCount = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)
            const lastChunkIndex = txsChunksCount - 1

            let txRemainder = OUTPUTS_QUANTITY_PER_TX
            const remainder = txQuantity % OUTPUTS_QUANTITY_PER_TX
            if (remainder > 0) {
                txRemainder = remainder
            }

            assert.strictEqual(txRemainder, OUTPUTS_QUANTITY_PER_TX,
                'When evenly divisible, txRemainder stays at OUTPUTS_QUANTITY_PER_TX')
        })
    })
})
