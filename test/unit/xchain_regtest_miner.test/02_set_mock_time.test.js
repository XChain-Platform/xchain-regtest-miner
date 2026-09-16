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

// ─── setMockTime ────────────────────────────────────────────────────

function setMockTimeTests() {
    it('delegates a valid timestamp to connector.setMockTime', async function () {
        connectorStub.setMockTime = sinon.stub().resolves(true)
        const result = await miner.setMockTime(1900000000)
        assert.strictEqual(result, true)
        assert(connectorStub.setMockTime.calledWith(1900000000))
    })

    it('accepts 0 (release the mock clock)', async function () {
        connectorStub.setMockTime = sinon.stub().resolves(true)
        await miner.setMockTime(0)
        assert(connectorStub.setMockTime.calledWith(0))
    })

    it('rejects a negative or non-numeric timestamp without calling the node', async function () {
        connectorStub.setMockTime = sinon.stub().resolves(true)
        await assert.rejects(() => miner.setMockTime(-1), /non-negative unix time/)
        await assert.rejects(() => miner.setMockTime('soon'), /non-negative unix time/)
        assert(connectorStub.setMockTime.notCalled)
    })

    it('refuses on mainnet without forwarding to the node', async function () {
        const mainnetMiner = new XChainRegtestMiner('bitcoin-mainnet', undefined, '8332', 'user', 'pass')
        mainnetMiner.connector = { setMockTime: sinon.stub().resolves(true) }
        await assert.rejects(() => mainnetMiner.setMockTime(1900000000), /refused on mainnet/)
        assert(mainnetMiner.connector.setMockTime.notCalled)
    })
}

describe('XChainRegtestMiner', function () {
    registerMinerHooks()
    describe('setMockTime', setMockTimeTests)
})
