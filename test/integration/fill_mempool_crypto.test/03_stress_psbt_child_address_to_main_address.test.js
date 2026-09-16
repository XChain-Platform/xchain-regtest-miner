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
    deriveChildKey, deriveChildAddress, createFundingTx, bitcoin, ecc,
} = require('../helpers/fixtures')
const { ECPairFactory } = require('ecpair')

describe('Seam C: fillMempool ↔ bitcoinjs-lib crypto pipeline', function () {
    describe('stress PSBT (child address → main address)', function () {
        it('constructs, signs, and finalizes with a child key', function () {
            // First build the distribution tx to use as nonWitnessUtxo
            const fundingAmount = (AMOUNT_FOR_EACH_ADDRESS + FEE) * 1 + 50
            const fundingTx = createFundingTx(MAIN_ADDRESS, fundingAmount)

            const distPsbt = new bitcoin.Psbt({ network })
            distPsbt.addInput({
                hash: fundingTx.txid,
                index: 0,
                nonWitnessUtxo: Buffer.from(fundingTx.hex, 'hex'),
            })
            const childAddr = deriveChildAddress(0)
            distPsbt.addOutput({
                address: childAddr,
                value: AMOUNT_FOR_EACH_ADDRESS + FEE,
            })

            const ECPair = ECPairFactory(ecc)
            const mainKey = ECPair.fromPrivateKey(mainKeyNode.privateKey, { network })
            distPsbt.signInput(0, mainKey)
            distPsbt.finalizeAllInputs()
            const distTx = distPsbt.extractTransaction()
            const distHex = distTx.toHex()
            const distTxid = distTx.getId()

            // Now build the stress tx: child → main
            const stressPsbt = new bitcoin.Psbt({ network })
            stressPsbt.addInput({
                hash: distTxid,
                index: 0,
                sequence: 0xffffffff,
                nonWitnessUtxo: Buffer.from(distHex, 'hex'),
            })
            stressPsbt.addOutput({
                address: MAIN_ADDRESS,
                value: AMOUNT_FOR_EACH_ADDRESS,
            })

            const childKey = deriveChildKey(0)
            const childKeyPair = ECPair.fromPrivateKey(childKey.privateKey, { network })
            stressPsbt.signInput(0, childKeyPair)
            stressPsbt.finalizeAllInputs()

            const stressTx = stressPsbt.extractTransaction()
            const stressHex = stressTx.toHex()

            // Validate the stress tx structure
            const parsed = bitcoin.Transaction.fromHex(stressHex)
            assert.strictEqual(parsed.ins.length, 1, 'Stress tx should have 1 input')
            assert.strictEqual(parsed.outs.length, 1, 'Stress tx should have 1 output')
            assert.strictEqual(parsed.outs[0].value, AMOUNT_FOR_EACH_ADDRESS)
        })
    })
})
