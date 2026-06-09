// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

const assert  = require('assert')
const bitcoin = require('bitcoinjs-lib')
const CryptoNetworks = require('../../src/CryptoNetworks')

describe('CryptoNetworks.getBitcoinJsNetwork', function () {

    it('returns the bitcoinjs-lib built-ins for bitcoin networks', function () {
        assert.strictEqual(CryptoNetworks.getBitcoinJsNetwork('bitcoin-mainnet'), bitcoin.networks.bitcoin)
        assert.strictEqual(CryptoNetworks.getBitcoinJsNetwork('bitcoin-testnet'), bitcoin.networks.testnet)
        assert.strictEqual(CryptoNetworks.getBitcoinJsNetwork('bitcoin-regtest'), bitcoin.networks.regtest)
    })

    it('returns dogecoin-mainnet params', function () {
        const n = CryptoNetworks.getBitcoinJsNetwork('dogecoin-mainnet')
        assert.strictEqual(n.pubKeyHash, 0x1e)
        assert.strictEqual(n.scriptHash, 0x16)
        assert.strictEqual(n.wif, 0x9e)
        assert.strictEqual(n.bip32.public, 0x02facafd)
    })

    it('returns dogecoin-testnet params', function () {
        const n = CryptoNetworks.getBitcoinJsNetwork('dogecoin-testnet')
        assert.strictEqual(n.pubKeyHash, 0x71)
        assert.strictEqual(n.wif, 0xf1)
        assert.strictEqual(n.bip32.public, 0x0432a9a8)
    })

    it('returns dogecoin-regtest params (bitcoin-testnet-style prefixes)', function () {
        const n = CryptoNetworks.getBitcoinJsNetwork('dogecoin-regtest')
        assert.strictEqual(n.pubKeyHash, 0x6f)
        assert.strictEqual(n.scriptHash, 0xc4)
        assert.strictEqual(n.wif, 0xef)
        assert.strictEqual(n.bip32.public, 0x043587cf)
    })

    it('returns litecoin-mainnet params with the ltc bech32 prefix', function () {
        const n = CryptoNetworks.getBitcoinJsNetwork('litecoin-mainnet')
        assert.strictEqual(n.bech32, 'ltc')
        assert.strictEqual(n.pubKeyHash, 0x30)
        assert.strictEqual(n.scriptHash, 0x32)
        assert.strictEqual(n.wif, 0xb0)
    })

    it('returns litecoin-testnet params with the tltc bech32 prefix', function () {
        const n = CryptoNetworks.getBitcoinJsNetwork('litecoin-testnet')
        assert.strictEqual(n.bech32, 'tltc')
        assert.strictEqual(n.pubKeyHash, 0x6f)
        assert.strictEqual(n.wif, 0xef)
    })

    it('returns litecoin-regtest params with the rltc bech32 prefix', function () {
        const n = CryptoNetworks.getBitcoinJsNetwork('litecoin-regtest')
        assert.strictEqual(n.bech32, 'rltc')
        assert.strictEqual(n.pubKeyHash, 0x6f)
        assert.strictEqual(n.wif, 0xef)
    })

    it('returns undefined for an unknown network name (no matching case)', function () {
        assert.strictEqual(CryptoNetworks.getBitcoinJsNetwork('ethereum-mainnet'), undefined)
        assert.strictEqual(CryptoNetworks.getBitcoinJsNetwork(''), undefined)
    })
})
