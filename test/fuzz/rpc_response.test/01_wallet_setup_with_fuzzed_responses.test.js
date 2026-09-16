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
}

describe('Fuzz: RPC response handling', function () {
    beforeEach(setUpMiner)
    afterEach(tearDownMiner)

    // ─── getWalletInfo / wallet setup fuzzing ───────────────────────

    describe('wallet setup with fuzzed responses', function () {
        it('handles probe failing then loadWallet succeeding', async function () {
            connectorStub.getNewAddress.rejects(new Error('no wallet loaded'))
            connectorStub.getNewAddress.onCall(10).resolves('bcrt1qtest')
            connectorStub.loadWallet.resolves({ name: 'test' })

            await miner.prepareWallet()

            assert.ok(connectorStub.loadWallet.calledOnce)
            assert.ok(connectorStub.createWallet.notCalled)
        })

        it('handles probe failing and loadWallet throwing', async function () {
            connectorStub.getNewAddress.rejects(new Error('no wallet loaded'))
            connectorStub.getNewAddress.onCall(10).resolves('bcrt1qtest')
            connectorStub.loadWallet.rejects(new Error('no file'))

            await miner.prepareWallet()

            assert.ok(connectorStub.createWallet.calledOnce)
        })

        it('handles probe returning no usable address', async function () {
            connectorStub.getNewAddress.rejects(new Error('no wallet loaded'))
            connectorStub.getNewAddress.onCall(10).resolves('bcrt1qtest')

            await miner.prepareWallet()

            // A failed probe triggers the wallet load/create path
            assert.ok(connectorStub.loadWallet.called || connectorStub.createWallet.called)
        })
    })
})
