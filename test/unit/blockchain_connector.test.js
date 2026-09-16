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
const axios = require('axios')
const BlockchainConnector = require('../../src/rpc/blockchain_connector')

describe('BlockchainConnector', function () {
    let connector
    let axiosPostStub

    beforeEach(function () {
        connector = new BlockchainConnector('localhost', '18332', 'rpcuser', 'rpcpass')
        axiosPostStub = sinon.stub(axios, 'post')
        sinon.stub(connector, 'sleep').resolves()
        sinon.stub(console, 'error')
        sinon.stub(console, 'log')
    })

    afterEach(function () {
        sinon.restore()
    })

    // ─── Constructor ────────────────────────────────────────────────────

    describe('constructor', function () {
        it('builds the correct URL from host and port', function () {
            assert.strictEqual(connector.url, 'http://localhost:18332')
        })

        it('stores RPC credentials', function () {
            assert.strictEqual(connector.rpcUser, 'rpcuser')
            assert.strictEqual(connector.rpcPassword, 'rpcpass')
        })

        it('stores the port', function () {
            assert.strictEqual(connector.port, '18332')
        })

        it('handles special characters in host/port', function () {
            const c = new BlockchainConnector('192.168.1.100', '8332', 'u', 'p')
            assert.strictEqual(c.url, 'http://192.168.1.100:8332')
        })
    })
})
