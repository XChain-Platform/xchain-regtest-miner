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
const fc = require('fast-check')
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

    // ─── sendFundsToAddress response fuzzing ────────────────────────

    describe('sendFundsToAddress with arbitrary inputs', function () {
        it('passes through valid address and amount to connector', async function () {
            await fc.assert(
                fc.asyncProperty(
                    fc.string({ minLength: 1 }),
                    fc.double({ min: 0.00000001, max: 1e8, noNaN: true }),
                    async (address, amount) => {
                        connectorStub.sendToAddress.resolves('txid_ok')
                        const result = await miner.sendFundsToAddress(address, amount)
                        assert.strictEqual(result, 'txid_ok')
                        assert.ok(connectorStub.sendToAddress.calledWith(address, amount))
                        connectorStub.sendToAddress.resetHistory()
                    }
                ),
                { numRuns: 200 }
            )
        })

        it('rejects invalid inputs without reaching connector', async function () {
            await fc.assert(
                fc.asyncProperty(fc.anything(), fc.anything(), async (address, amount) => {
                    const isValidAddr = typeof address === 'string' && address.length > 0
                    const isValidAmt = typeof amount === 'number' && isFinite(amount) && amount > 0
                    if (!isValidAddr || !isValidAmt) {
                        connectorStub.sendToAddress.resetHistory()
                        try {
                            await miner.sendFundsToAddress(address, amount)
                        } catch(e) {
                            assert.ok(e.message.includes('Invalid'))
                        }
                        assert.strictEqual(connectorStub.sendToAddress.callCount, 0)
                    }
                    connectorStub.sendToAddress.resetHistory()
                }),
                { numRuns: 200 }
            )
        })

        it('propagates connector errors for valid inputs', async function () {
            connectorStub.sendToAddress.rejects(new Error('insufficient funds'))
            await assert.rejects(
                () => miner.sendFundsToAddress('addr', 1),
                /insufficient funds/
            )
        })
    })
})
