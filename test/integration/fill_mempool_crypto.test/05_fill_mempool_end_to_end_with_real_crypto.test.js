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
 **********************************************************************
 * Seam C Integration Tests: fillMempool ↔ bitcoinjs-lib (PSBT Pipeline)
 *
 * These tests use REAL crypto libraries with NO mocking of BIP39/BIP32/bitcoinjs-lib.
 * Only the BlockchainConnector is mocked (to avoid needing a real Bitcoin node).
 * A fixed mnemonic makes all keys and addresses deterministic.
 */

const assert = require('assert')
const sinon = require('sinon')
const {
    MNEMONIC, network, MAIN_ADDRESS, AMOUNT_FOR_EACH_ADDRESS, FEE,
    deriveChildAddress, createFundingTx, chunkFundingAmount, bitcoin, bip39,
} = require('../helpers/fixtures')

let XChainRegtestMiner, miner, connectorStub
let broadcastedTxHexes

function createMiner() {
    // Stub generateMnemonic to return our fixed mnemonic
    sinon.stub(bip39, 'generateMnemonic').returns(MNEMONIC)
    sinon.stub(console, 'log')
    sinon.stub(console, 'error')

    // Compute the funding transaction for txQuantity=1
    const fundingAmount = chunkFundingAmount(1, 0) // 2050 sats
    const funding = createFundingTx(MAIN_ADDRESS, fundingAmount)

    broadcastedTxHexes = []

    connectorStub = {
        sendToAddress: sinon.stub().resolves(funding.txid),
        setTxFee: sinon.stub().resolves(true),
        setWalletName: sinon.stub(),
        generateToAddress: sinon.stub().resolves(['blockhash']),
        getRawTransaction: sinon.stub().callsFake(async (txid) => {
            if (txid === funding.txid) return funding.hex
            return null
        }),
        sendRawTransaction: sinon.stub().callsFake(async (txHex) => {
            broadcastedTxHexes.push(txHex)
            // Return the real txid so stress txs can reference it
            return bitcoin.Transaction.fromHex(txHex).getId()
        }),
    }

    // Clear module cache and load fresh
    delete require.cache[require.resolve('../../../src/XChainRegtestMiner')]
    XChainRegtestMiner = require('../../../src/XChainRegtestMiner')
    miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
    miner.connector = connectorStub
    miner.walletAddress = 'bcrt1qreward'
    sinon.stub(miner, 'sleep').resolves()
}

function restoreMiner() {
    sinon.restore()
    delete require.cache[require.resolve('../../../src/XChainRegtestMiner')]
}

describe('Seam C: fillMempool ↔ bitcoinjs-lib crypto pipeline', function () {
    // ─── Full fillMempool End-to-End ────────────────────────────────────

    describe('fillMempool end-to-end with real crypto', function () {
        beforeEach(createMiner)
        afterEach(restoreMiner)

        it('fillMempool(1) completes without error', async function () {
            await miner.fillMempool(1)
        })

        it('fillMempool(1) leaves mining paused so the txs stay in the mempool', async function () {
            miner.keepMining = true
            await miner.fillMempool(1)
            // Auto-mining stays paused until continue_mining; only the mutex resets.
            assert.strictEqual(miner.keepMining, false)
            assert.strictEqual(miner.fillMempoolRunning, false)
        })

        it('fillMempool(1) broadcasts exactly 2 raw transactions', async function () {
            // 1 distribution tx + 1 stress tx
            await miner.fillMempool(1)
            assert.strictEqual(connectorStub.sendRawTransaction.callCount, 2,
                'Should broadcast 1 distribution tx + 1 stress tx')
        })

        it('fillMempool(1) distribution tx has correct structure', async function () {
            await miner.fillMempool(1)
            const distHex = broadcastedTxHexes[0]
            const distTx = bitcoin.Transaction.fromHex(distHex)

            assert.strictEqual(distTx.ins.length, 1, 'Distribution tx: 1 input')
            assert.strictEqual(distTx.outs.length, 1, 'Distribution tx: 1 output (for 1 child address)')
            assert.strictEqual(distTx.outs[0].value, AMOUNT_FOR_EACH_ADDRESS + FEE,
                'Output value should be AMOUNT + FEE = 2000')
        })
    })
})

describe('Seam C: fillMempool ↔ bitcoinjs-lib crypto pipeline', function () {
    describe('fillMempool end-to-end with real crypto', function () {
        beforeEach(createMiner)
        afterEach(restoreMiner)

        it('fillMempool(1) stress tx has correct structure', async function () {
            await miner.fillMempool(1)
            const stressHex = broadcastedTxHexes[1]
            const stressTx = bitcoin.Transaction.fromHex(stressHex)

            assert.strictEqual(stressTx.ins.length, 1, 'Stress tx: 1 input')
            assert.strictEqual(stressTx.outs.length, 1, 'Stress tx: 1 output')
            assert.strictEqual(stressTx.outs[0].value, AMOUNT_FOR_EACH_ADDRESS,
                'Output value should be AMOUNT = 1000')
        })

        it('fillMempool(1) stress tx output goes to main address', async function () {
            await miner.fillMempool(1)
            const stressTx = bitcoin.Transaction.fromHex(broadcastedTxHexes[1])
            const outputAddr = bitcoin.address.fromOutputScript(stressTx.outs[0].script, network)
            assert.strictEqual(outputAddr, MAIN_ADDRESS)
        })

        it('fillMempool(1) distribution tx output goes to correct child address', async function () {
            await miner.fillMempool(1)
            const distTx = bitcoin.Transaction.fromHex(broadcastedTxHexes[0])
            const outputAddr = bitcoin.address.fromOutputScript(distTx.outs[0].script, network)
            const expectedChildAddr = deriveChildAddress(0)
            assert.strictEqual(outputAddr, expectedChildAddr)
        })

        it('fillMempool(1) mines 2 blocks during the process', async function () {
            await miner.fillMempool(1)
            assert.strictEqual(connectorStub.generateToAddress.callCount, 2,
                'Should mine once after funding, once after distribution')
        })
    })
})

describe('Seam C: fillMempool ↔ bitcoinjs-lib crypto pipeline', function () {
    describe('fillMempool end-to-end with real crypto', function () {
        beforeEach(createMiner)
        afterEach(restoreMiner)

        it('fillMempool(3) broadcasts correct number of transactions', async function () {
            // Need funding tx for 3 addresses
            const fundingAmount = chunkFundingAmount(3, 0)
            const funding = createFundingTx(MAIN_ADDRESS, fundingAmount)
            connectorStub.sendToAddress.resolves(funding.txid)
            connectorStub.getRawTransaction.callsFake(async (txid) => {
                if (txid === funding.txid) return funding.hex
                return null
            })

            await miner.fillMempool(3)

            // 1 distribution tx + 3 stress txs = 4 total
            assert.strictEqual(connectorStub.sendRawTransaction.callCount, 4)
        })

        it('fillMempool(3) distribution tx has 3 outputs', async function () {
            const fundingAmount = chunkFundingAmount(3, 0)
            const funding = createFundingTx(MAIN_ADDRESS, fundingAmount)
            connectorStub.sendToAddress.resolves(funding.txid)
            connectorStub.getRawTransaction.callsFake(async (txid) => {
                if (txid === funding.txid) return funding.hex
                return null
            })

            await miner.fillMempool(3)

            const distTx = bitcoin.Transaction.fromHex(broadcastedTxHexes[0])
            assert.strictEqual(distTx.outs.length, 3, 'Distribution tx should have 3 outputs')
        })

        it('all broadcast transactions are valid parseable hex', async function () {
            const fundingAmount = chunkFundingAmount(3, 0)
            const funding = createFundingTx(MAIN_ADDRESS, fundingAmount)
            connectorStub.sendToAddress.resolves(funding.txid)
            connectorStub.getRawTransaction.callsFake(async (txid) => {
                if (txid === funding.txid) return funding.hex
                return null
            })

            await miner.fillMempool(3)

            for (let i = 0; i < broadcastedTxHexes.length; i++) {
                assert.doesNotThrow(
                    () => bitcoin.Transaction.fromHex(broadcastedTxHexes[i]),
                    `Transaction ${i} should be valid parseable hex`
                )
            }
        })
    })
})
