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
    MNEMONIC, network, account, MAIN_ADDRESS,
    deriveChildAddress, bitcoin, bip39, bip32,
} = require('./helpers/fixtures')

describe('Seam C: fillMempool ↔ bitcoinjs-lib crypto pipeline', function () {

    // ─── Key Derivation ─────────────────────────────────────────────────

    describe('key derivation from fixed mnemonic', function () {
        it('produces a valid P2PKH regtest main address', function () {
            assert.ok(MAIN_ADDRESS.startsWith('m') || MAIN_ADDRESS.startsWith('n'),
                `Expected P2PKH regtest address (m/n prefix), got: ${MAIN_ADDRESS}`)
        })

        it('derives unique child addresses', function () {
            const addresses = []
            for (let i = 0; i < 5; i++) {
                addresses.push(deriveChildAddress(i))
            }
            const unique = new Set(addresses)
            assert.strictEqual(unique.size, 5, 'All 5 child addresses must be unique')
        })

        it('derives valid P2PKH regtest child addresses', function () {
            for (let i = 0; i < 5; i++) {
                const addr = deriveChildAddress(i)
                assert.ok(addr.startsWith('m') || addr.startsWith('n'),
                    `Child address ${i} should be P2PKH regtest, got: ${addr}`)
            }
        })

        it('main address uses derivation path m/44h/0h/0h/0 → derive(0) → derive(0)', function () {
            // Independently re-derive and compare
            const seed = bip39.mnemonicToSeedSync(MNEMONIC)
            const root = bip32.fromSeed(seed)
            const acct = root.derivePath("m/44'/0'/0'/0")
            const key = acct.derive(0).derive(0)
            const addr = bitcoin.payments.p2pkh({ pubkey: key.publicKey, network }).address
            assert.strictEqual(addr, MAIN_ADDRESS)
        })

        it('child address at index i uses derive(i+1).derive(0)', function () {
            // Verify the offset: fillMempool uses account.derive(i+1).derive(0)
            const key0 = account.derive(1).derive(0)
            const addr0 = bitcoin.payments.p2pkh({ pubkey: key0.publicKey, network }).address
            assert.strictEqual(addr0, deriveChildAddress(0))

            const key2 = account.derive(3).derive(0)
            const addr2 = bitcoin.payments.p2pkh({ pubkey: key2.publicKey, network }).address
            assert.strictEqual(addr2, deriveChildAddress(2))
        })
    })

})
