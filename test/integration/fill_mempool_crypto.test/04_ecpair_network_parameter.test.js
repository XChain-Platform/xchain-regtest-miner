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
    network, mainKeyNode, MAIN_ADDRESS, bitcoin, ecc,
} = require('../helpers/fixtures')
const { ECPairFactory } = require('ecpair')

describe('Seam C: fillMempool ↔ bitcoinjs-lib crypto pipeline', function () {
    describe('ECPair network parameter', function () {
        it('creates key pair with regtest network', function () {
            const ECPair = ECPairFactory(ecc)
            const keyPair = ECPair.fromPrivateKey(mainKeyNode.privateKey, { network })
            assert.ok(keyPair.publicKey, 'Should have a public key')
            assert.ok(keyPair.privateKey, 'Should have a private key')
            assert.deepStrictEqual(keyPair.network, bitcoin.networks.regtest)
        })

        it('produces the same address as direct P2PKH derivation', function () {
            const ECPair = ECPairFactory(ecc)
            const keyPair = ECPair.fromPrivateKey(mainKeyNode.privateKey, { network })
            const ecPairAddr = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network }).address
            assert.strictEqual(ecPairAddr, MAIN_ADDRESS)
        })
    })
})
