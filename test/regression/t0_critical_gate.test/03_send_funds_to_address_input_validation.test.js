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
// REG-T0-007: sendFundsToAddress input validation
// ═══════════════════════════════════════════════════════════════════

describe('T0 Regression: Critical Gate', function () {
    beforeEach(setUpMiner)
    afterEach(tearDownMiner)

    describe('REG-T0-007: sendFundsToAddress input validation', function () {
        it('rejects non-string address', async function () {
            await assert.rejects(() => miner.sendFundsToAddress(12345, 1.0), /Invalid address/)
        })

        it('rejects empty string address', async function () {
            await assert.rejects(() => miner.sendFundsToAddress('', 1.0), /Invalid address/)
        })

        it('rejects non-number amount', async function () {
            await assert.rejects(() => miner.sendFundsToAddress('addr', 'abc'), /Invalid amount/)
        })

        it('rejects zero amount', async function () {
            await assert.rejects(() => miner.sendFundsToAddress('addr', 0), /Invalid amount/)
        })

        it('rejects negative amount', async function () {
            await assert.rejects(() => miner.sendFundsToAddress('addr', -1), /Invalid amount/)
        })

        it('rejects Infinity amount', async function () {
            await assert.rejects(() => miner.sendFundsToAddress('addr', Infinity), /Invalid amount/)
        })

        it('delegates valid inputs to connector', async function () {
            connectorStub.sendToAddress.resolves('txid123')
            const result = await miner.sendFundsToAddress('bcrt1qaddr', 1.5)
            assert.strictEqual(result, 'txid123')
            assert(connectorStub.sendToAddress.calledWith('bcrt1qaddr', 1.5))
        })
    })
})
