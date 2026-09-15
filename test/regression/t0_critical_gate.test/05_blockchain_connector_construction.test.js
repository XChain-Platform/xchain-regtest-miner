/*********************************************************************
 *
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC – https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 *
 **********************************************************************/

const assert = require('assert')
const sinon = require('sinon')
const BlockchainConnector = require('../../../src/rpc/blockchain_connector')

let XChainRegtestMiner
let miner
let connectorStub

function setUpMiner() {
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
        setWalletName: sinon.stub(),
        getRawTransaction: sinon.stub().resolves('0200000001...'),
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
}

// ═══════════════════════════════════════════════════════════════════
// REG-T0-009: BlockchainConnector construction
// ═══════════════════════════════════════════════════════════════════

describe('T0 Regression: Critical Gate', function () {
    beforeEach(setUpMiner)
    afterEach(tearDownMiner)

    describe('REG-T0-009: BlockchainConnector construction', function () {
        it('builds correct URL and stores credentials', function () {
            const connector = new BlockchainConnector('localhost', '18332', 'rpcuser', 'rpcpass')
            assert.strictEqual(connector.url, 'http://localhost:18332')
            assert.strictEqual(connector.port, '18332')
            assert.strictEqual(connector.rpcUser, 'rpcuser')
            assert.strictEqual(connector.rpcPassword, 'rpcpass')
        })
    })
})
