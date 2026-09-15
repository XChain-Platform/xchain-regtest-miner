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
const {
    network, mainKeyNode, MAIN_ADDRESS, AMOUNT_FOR_EACH_ADDRESS, FEE,
    deriveChildAddress, createFundingTx, bitcoin, ecc,
} = require('../helpers/fixtures')
const { ECPairFactory } = require('ecpair')

let fundingTx, psbt

function createFundingTransaction() {
    // Create a funding tx with enough value for 3 child addresses
    const amountSats = (AMOUNT_FOR_EACH_ADDRESS + FEE) * 3 + 50 * 3 // 6150
    fundingTx = createFundingTx(MAIN_ADDRESS, amountSats)
}

describe('Seam C: fillMempool ↔ bitcoinjs-lib crypto pipeline', function () {
    // ─── PSBT Construction and Signing ──────────────────────────────────

    describe('distribution PSBT (main address → child addresses)', function () {
        beforeEach(createFundingTransaction)

        it('constructs a valid PSBT with correct input', function () {
            psbt = new bitcoin.Psbt({ network })
            psbt.addInput({
                hash: fundingTx.txid,
                index: 0,
                nonWitnessUtxo: Buffer.from(fundingTx.hex, 'hex'),
            })

            assert.strictEqual(psbt.data.inputs.length, 1)
        })

        it('adds correct number of outputs with correct values', function () {
            psbt = new bitcoin.Psbt({ network })
            psbt.addInput({
                hash: fundingTx.txid,
                index: 0,
                nonWitnessUtxo: Buffer.from(fundingTx.hex, 'hex'),
            })

            for (let i = 0; i < 3; i++) {
                const childAddr = deriveChildAddress(i)
                psbt.addOutput({
                    address: childAddr,
                    value: AMOUNT_FOR_EACH_ADDRESS + FEE, // 2000
                })
            }

            assert.strictEqual(psbt.data.outputs.length, 3)
        })
    })
})

describe('Seam C: fillMempool ↔ bitcoinjs-lib crypto pipeline', function () {
    describe('distribution PSBT (main address → child addresses)', function () {
        beforeEach(createFundingTransaction)

        it('signs and finalizes successfully with the main key', function () {
            psbt = new bitcoin.Psbt({ network })
            psbt.addInput({
                hash: fundingTx.txid,
                index: 0,
                nonWitnessUtxo: Buffer.from(fundingTx.hex, 'hex'),
            })

            for (let i = 0; i < 3; i++) {
                psbt.addOutput({
                    address: deriveChildAddress(i),
                    value: AMOUNT_FOR_EACH_ADDRESS + FEE,
                })
            }

            const ECPair = ECPairFactory(ecc)
            const keyToSign = ECPair.fromPrivateKey(mainKeyNode.privateKey, { network })
            psbt.signInput(0, keyToSign)
            psbt.finalizeAllInputs()

            const extractedTx = psbt.extractTransaction()
            assert.ok(extractedTx, 'Should extract a transaction')
        })

        it('produces valid serializable transaction hex', function () {
            psbt = new bitcoin.Psbt({ network })
            psbt.addInput({
                hash: fundingTx.txid,
                index: 0,
                nonWitnessUtxo: Buffer.from(fundingTx.hex, 'hex'),
            })

            for (let i = 0; i < 3; i++) {
                psbt.addOutput({
                    address: deriveChildAddress(i),
                    value: AMOUNT_FOR_EACH_ADDRESS + FEE,
                })
            }

            const ECPair = ECPairFactory(ecc)
            const keyToSign = ECPair.fromPrivateKey(mainKeyNode.privateKey, { network })
            psbt.signInput(0, keyToSign)
            psbt.finalizeAllInputs()

            const hex = psbt.extractTransaction().toHex()
            // Round-trip: parse the hex back
            const parsed = bitcoin.Transaction.fromHex(hex)
            assert.strictEqual(parsed.ins.length, 1)
            assert.strictEqual(parsed.outs.length, 3)
            // Each output should have value 2000
            for (const out of parsed.outs) {
                assert.strictEqual(out.value, 2000)
            }
        })
    })
})
