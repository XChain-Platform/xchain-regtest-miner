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
const BlockchainConnector = require('../../../src/rpc/blockchain_connector')

let connector
let axiosPostStub

function setup() {
    connector = new BlockchainConnector('localhost', '18332', 'rpcuser', 'rpcpass')
    axiosPostStub = sinon.stub(axios, 'post')
    sinon.stub(connector, 'sleep').resolves()
    sinon.stub(console, 'error')
    sinon.stub(console, 'log')
}

function teardown() {
    sinon.restore()
}

describe('BlockchainConnector', function () {
    beforeEach(setup)
    afterEach(teardown)

    // ─── sleep ──────────────────────────────────────────────────────────

    describe('sleep', function () {
        beforeEach(function () {
            // Restore the real sleep for this describe block so we can test it
            connector.sleep.restore()
        })

        it('resolves after the specified delay', async function () {
            const clock = sinon.useFakeTimers()
            const promise = connector.sleep(100)

            // Before the delay has elapsed the promise must still be pending.
            // Race it against an immediately-resolved sentinel: if sleep resolved
            // early the sentinel would lose, so the sentinel winning proves pending.
            const sentinel = Promise.resolve('sentinel')
            const earlyWinner = await Promise.race([promise.then(() => 'sleep'), sentinel])
            assert.strictEqual(earlyWinner, 'sentinel', 'sleep resolved before the delay elapsed')

            // After time advances past the delay, sleep must resolve.
            clock.tick(100)
            await promise

            clock.restore()
        })
    })
})
