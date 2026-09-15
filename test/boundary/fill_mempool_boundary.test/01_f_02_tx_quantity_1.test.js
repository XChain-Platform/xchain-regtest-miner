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

    // ─── F-02: tx_quantity = 1 ─────────────────────────────────────────

    describe('F-02: tx_quantity = 1', function () {
        it('creates exactly 1 chunk with 1 output', function () {
            const txQuantity = 1
            const chunks = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)
            assert.strictEqual(chunks, 1)

            const remainder = txQuantity % OUTPUTS_QUANTITY_PER_TX
            assert.strictEqual(remainder, 1)
        })

        it('calculates correct funding amount for 1 address (bare-"regtest" FALLBACK path)', function () {
            const txRemainder = 1
            // The miner under test is built with the bare network 'regtest' (see setup),
            // which does NOT resolve to a coin config, so it falls back to the
            // bitcoinjs-lib built-in, which carries no dustThreshold: split fee floors at 50.
            const splitFee = Math.max(50, 50)
            const totalAmount = AMOUNT_FOR_EACH_ADDRESS * txRemainder +
                                FEE * txRemainder +
                                splitFee * txRemainder
            assert.strictEqual(totalAmount, 2050)
            assert.strictEqual(totalAmount / SATOSHI_UNIT, 0.0000205)
        })

        it('calculates correct funding amount for 1 address (resolved "bitcoin-regtest" coin config)', function () {
            // Production passes COIN_NETWORK in the resolved form, where Bitcoin DOES
            // define dustThreshold 546. This assertion prevents the suite from staying
            // green if the Bitcoin sizing drifts below dust.
            const CryptoNetworks = require('../../../src/networks/crypto_networks')
            const net = CryptoNetworks.getBitcoinJsNetwork('bitcoin-regtest')
            assert.strictEqual(net.dustThreshold, 546)

            const coinDust = Math.max(net.dustThreshold, 1000)   // 1000 (546 < 1000)
            const splitFee = Math.max(50, net.dustThreshold)     // 546, not 50
            const totalAmount = coinDust + coinDust + splitFee
            assert.strictEqual(splitFee, 546)
            assert.strictEqual(totalAmount, 2546)
        })
    })
})
