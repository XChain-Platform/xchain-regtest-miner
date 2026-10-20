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
const { state, useConnectorFixtures, makeAxiosError, assertConsoleClean } = require('../helpers/connector_sanitization_fixture')
describe('Security: BlockchainConnector Error Sanitization', function () {
    useConnectorFixtures()
    // ─── Blanket console output credential check ──────────────────────

    describe('no method ever logs credentials to console', function () {
        const methods = [
            { name: 'getNetworkInfo', args: [] },
            { name: 'getBlockchainInfo', args: [] },
            { name: 'getBlockHash', args: [0] },
            { name: 'getBlock', args: ['abc'] },
            { name: 'getRawMempool', args: [] },
            { name: 'getMempoolEntry', args: ['txid'] },
            { name: 'loadWallet', args: ['test'] },
            { name: 'getNewAddress', args: [] },
            { name: 'generateToAddress', args: [1, 'addr'] },
            { name: 'getBalance', args: [] },
            { name: 'sendToAddress', args: ['addr', 1.0] },
            { name: 'sendRawTransaction', args: ['hex'] },
        ]

        for (const { name, args } of methods) {
            it(`${name} does not log password`, async function () {
                state.axiosPostStub.rejects(makeAxiosError('ECONNREFUSED'))
                try { await state.connector[name](...args) } catch (e) {}
                assertConsoleClean()
            })
        }
    })
})

describe('Security: BlockchainConnector Error Sanitization', function () {
    useConnectorFixtures()
    // ─── Error object property checks ─────────────────────────────────

    describe('no method exposes .config on thrown errors', function () {
        const methods = [
            { name: 'getNetworkInfo', args: [] },
            { name: 'getBlockchainInfo', args: [] },
            { name: 'getBlockHash', args: [0] },
            { name: 'getBlock', args: ['abc'] },
            { name: 'getRawMempool', args: [] },
            { name: 'getMempoolEntry', args: ['txid'] },
            { name: 'createWallet', args: ['test', 1] },
            { name: 'getWalletInfo', args: [1] },
            { name: 'loadWallet', args: ['test'] },
            { name: 'getNewAddress', args: [] },
            { name: 'generateToAddress', args: [1, 'addr'] },
            { name: 'getBalance', args: [] },
            { name: 'sendToAddress', args: ['addr', 1.0] },
            { name: 'sendRawTransaction', args: ['hex'] },
        ]

        for (const { name, args } of methods) {
            it(`${name} error has no .config property`, async function () {
                state.axiosPostStub.rejects(makeAxiosError('ECONNREFUSED'))
                try {
                    await state.connector[name](...args)
                    // getRawTransaction returns null, doesn't throw
                    if (name === 'getRawTransaction') return
                    assert.fail('should throw')
                } catch (err) {
                    assert.strictEqual(err.config, undefined, `${name} error exposes .config`)
                    assert.strictEqual(err.response, undefined, `${name} error exposes .response`)
                }
            })
        }
    })
})
