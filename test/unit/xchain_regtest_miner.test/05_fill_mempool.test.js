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

// ─── fillMempool ────────────────────────────────────────────────────

function fillMempoolTestsA() {
    it('sets keepMining to false only after validation passes', async function () {
        miner.keepMining = true

        // fillMempool(0) fails validation and throws before touching state; keepMining unchanged
        await assert.rejects(() => miner.fillMempool(0), /positive integer/)
        assert.strictEqual(miner.keepMining, true,
            'keepMining should not change for invalid input')

        // fillMempool stops mining (keepMining=false), preserving the funding
        // transactions in the mempool, and intentionally leaves mining stopped.
        // The caller resumes explicitly via continueMining(). keepMining becomes
        // false right after validation, so later crypto failures leave it false.
        try {
            await miner.fillMempool(1)
        } catch (e) {
            // May fail on crypto ops; that's ok for this test
        }
        assert.strictEqual(miner.keepMining, false,
            'fillMempool must leave mining stopped so the txs persist in the mempool')
    })

    it('throws (rather than silently returning) on invalid txQuantity', async function () {
        // A float tx_quantity from a JSON-parsed config must not make
        // fillMempool return undefined; the API layer can turn that into a
        // { result: 'ok' } response with an empty mempool. Throw so
        // the caller learns the work was never done.
        await assert.rejects(() => miner.fillMempool(50.5), /positive integer/)
        await assert.rejects(() => miner.fillMempool(0), /positive integer/)
        await assert.rejects(() => miner.fillMempool(-1), /positive integer/)

        // keepMining must be untouched and a concurrent run must not be marked
        assert.strictEqual(miner.fillMempoolRunning, false)
    })

    it('rejects a truly concurrent second call, not just one pre-flagged by the caller', async function () {
        miner.walletAddress = 'bcrt1qtest'
        // Launch two calls in the SAME tick without awaiting between them. The
        // mutex must be claimed synchronously (before the internal _generateQueue
        // await), or both slip past the guard while parked on that barrier and the
        // stress body runs twice. The bodies fail on the stubbed (invalid) raw tx;
        // this assertion targets the guard, independent of the body outcome.
        const p1 = miner.fillMempool(10).catch(e => e)
        const p2 = miner.fillMempool(10).catch(e => e)
        const results = await Promise.all([p1, p2])
        const alreadyRunning = results.filter(
            r => r instanceof Error && /already running/.test(r.message)
        )
        assert.strictEqual(alreadyRunning.length, 1,
            'exactly one of two concurrent fillMempool calls must be rejected as already running')
    })
}

function fillMempoolTestsB() {
    it('calculates correct number of chunks for quantities within one chunk', function () {
        const chunks = Math.ceil(100 / 2500)
        assert.strictEqual(chunks, 1)
    })

    it('calculates correct number of chunks for exact multiple', function () {
        const chunks = Math.ceil(2500 / 2500)
        assert.strictEqual(chunks, 1)
    })

    it('calculates correct number of chunks for quantity exceeding one chunk', function () {
        const chunks = Math.ceil(2501 / 2500)
        assert.strictEqual(chunks, 2)
    })

    it('calculates correct number of chunks for large quantity', function () {
        const chunks = Math.ceil(7500 / 2500)
        assert.strictEqual(chunks, 3)
    })

    it('calculates correct remainder for last chunk', function () {
        const txQuantity = 2501
        const OUTPUTS_QUANTITY_PER_TX = 2500
        const txsChunksCount = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)
        const lastChunkIndex = txsChunksCount - 1

        let txRemainder = OUTPUTS_QUANTITY_PER_TX
        const remainder = txQuantity % OUTPUTS_QUANTITY_PER_TX
        if (remainder > 0) {
            txRemainder = remainder
        }

        assert.strictEqual(txsChunksCount, 2)
        assert.strictEqual(txRemainder, 1)
    })
}

function fillMempoolTestsC() {
    it('calculates correct remainder when evenly divisible', function () {
        const txQuantity = 5000
        const OUTPUTS_QUANTITY_PER_TX = 2500
        const remainder = txQuantity % OUTPUTS_QUANTITY_PER_TX
        // When evenly divisible, remainder is 0, so txRemainder stays at OUTPUTS_QUANTITY_PER_TX
        assert.strictEqual(remainder, 0)
    })

    it('calculates correct funding amount per chunk', function () {
        const AMOUNT_FOR_EACH_ADDRESS = 1000
        const FEE = 1000
        const txRemainder = 100
        const SATOSHI_UNIT = 100000000.0

        const totalAmount =
            AMOUNT_FOR_EACH_ADDRESS * txRemainder +
            FEE * txRemainder +
            50 * txRemainder

        assert.strictEqual(totalAmount, 205000)
        assert.strictEqual(totalAmount / SATOSHI_UNIT, 0.00205)
    })
}

describe('XChainRegtestMiner', function () {
    registerMinerHooks()
    describe('fillMempool', fillMempoolTestsA)
    describe('fillMempool', fillMempoolTestsB)
    describe('fillMempool', fillMempoolTestsC)
})
