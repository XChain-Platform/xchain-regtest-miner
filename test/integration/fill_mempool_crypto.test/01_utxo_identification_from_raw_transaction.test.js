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
    network, MAIN_ADDRESS, deriveChildAddress, createFundingTx, bitcoin,
} = require('../helpers/fixtures')

describe('Seam C: fillMempool ↔ bitcoinjs-lib crypto pipeline', function () {
    // ─── UTXO Identification ────────────────────────────────────────────

    describe('UTXO identification from raw transaction', function () {
        it('finds the output matching the main address at index 0', function () {
            const funding = createFundingTx(MAIN_ADDRESS, 2050)
            const tx = bitcoin.Transaction.fromHex(funding.hex)

            let utxoIndex = 0
            let found = false
            for (const out of tx.outs) {
                const addr = bitcoin.address.fromOutputScript(out.script, network)
                if (addr === MAIN_ADDRESS) {
                    found = true
                    break
                }
                utxoIndex++
            }

            assert.ok(found, 'Should find mainAddress output')
            assert.strictEqual(utxoIndex, 0, 'mainAddress output should be at index 0')
        })

        it('finds the correct output when mainAddress is not at index 0', function () {
            // Build a tx with a different address at index 0, mainAddress at index 1
            const otherAddr = deriveChildAddress(0)
            const tx = new bitcoin.Transaction()
            tx.version = 2
            const dummyHash = Buffer.alloc(32, 0)
            dummyHash[0] = 0x02
            tx.addInput(dummyHash, 0)
            tx.addOutput(bitcoin.address.toOutputScript(otherAddr, network), 1000)
            tx.addOutput(bitcoin.address.toOutputScript(MAIN_ADDRESS, network), 2050)
            const hex = tx.toHex()

            const parsed = bitcoin.Transaction.fromHex(hex)
            let utxoIndex = 0
            for (const out of parsed.outs) {
                const addr = bitcoin.address.fromOutputScript(out.script, network)
                if (addr === MAIN_ADDRESS) break
                utxoIndex++
            }

            assert.strictEqual(utxoIndex, 1, 'mainAddress output should be at index 1')
        })
    })
})

describe('Seam C: fillMempool ↔ bitcoinjs-lib crypto pipeline', function () {
    describe('UTXO identification from raw transaction', function () {
        it('correctly identifies UTXOs across multiple funding transactions', function () {
            const funding1 = createFundingTx(MAIN_ADDRESS, 2050)
            const funding2 = createFundingTx(MAIN_ADDRESS, 4100)

            const utxos = []
            for (const funding of [funding1, funding2]) {
                const tx = bitcoin.Transaction.fromHex(funding.hex)
                let utxoIndex = 0
                for (const out of tx.outs) {
                    const addr = bitcoin.address.fromOutputScript(out.script, network)
                    if (addr === MAIN_ADDRESS) {
                        utxos.push({ txid: funding.txid, utxoIndex, value: out.value })
                        break
                    }
                    utxoIndex++
                }
            }

            assert.strictEqual(utxos.length, 2)
            assert.strictEqual(utxos[0].value, 2050)
            assert.strictEqual(utxos[1].value, 4100)
            assert.notStrictEqual(utxos[0].txid, utxos[1].txid)
        })
    })
})
