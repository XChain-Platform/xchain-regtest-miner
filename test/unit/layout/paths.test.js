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
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../../..')

describe('source layout', function () {
    it('keeps the blockchain connector in the rpc directory', function () {
        assert.strictEqual(fs.existsSync(path.join(root, 'src/blockchain_connector.js')), false)
        assert.strictEqual(fs.existsSync(path.join(root, 'src/rpc/blockchain_connector.js')), true)

        const miner = fs.readFileSync(path.join(root, 'src/XChainRegtestMiner.js'), 'utf8')
        assert.match(miner, /require\('\.\/rpc\/blockchain_connector\.js'\)/)
    })

    it('keeps crypto networks in the networks directory', function () {
        assert.strictEqual(fs.existsSync(path.join(root, 'src/crypto_networks.js')), false)
        assert.strictEqual(fs.existsSync(path.join(root, 'src/networks/crypto_networks.js')), true)

        const mempoolFill = fs.readFileSync(path.join(root, 'src/XChainRegtestMiner/mempool_fill.js'), 'utf8')
        assert.match(mempoolFill, /require\('\.\.\/networks\/crypto_networks\.js'\)/)
    })
})
