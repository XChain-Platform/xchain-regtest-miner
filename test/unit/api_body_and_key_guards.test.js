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
const { timingSafeStringEqual, ensureJsonRpcBody, normalizeJsonRpcParams } = require('../../src/api')

describe('api.js', function () {
    describe('timingSafeStringEqual', function () {
        it('returns true for two equal strings', function () {
            assert.strictEqual(timingSafeStringEqual('secret-key', 'secret-key'), true)
        })

        it('returns false for two different strings of the same length', function () {
            assert.strictEqual(timingSafeStringEqual('secret-key', 'secret-koy'), false)
        })

        it('returns false for strings of different length rather than throwing', function () {
            assert.strictEqual(timingSafeStringEqual('short', 'a-much-longer-value'), false)
        })

        it('treats a missing header (undefined) as the empty string and fails closed', function () {
            assert.strictEqual(timingSafeStringEqual(undefined, 'secret-key'), false)
        })
    })
})

describe('api.js', function () {
    describe('ensureJsonRpcBody', function () {
        it('defaults an undefined body to {} and calls next', function () {
            const req = {}
            let nextCalled = false
            ensureJsonRpcBody(req, {}, () => { nextCalled = true })
            assert.deepStrictEqual(req.body, {})
            assert.strictEqual(nextCalled, true)
        })

        it('leaves an already-populated body untouched', function () {
            const req = { body: { method: 'ping' } }
            ensureJsonRpcBody(req, {}, () => {})
            assert.deepStrictEqual(req.body, { method: 'ping' })
        })
    })
})

describe('api.js', function () {
    describe('normalizeJsonRpcParams', function () {
        it('coalesces an explicit null params to {} on a single request', function () {
            const req = { body: { method: 'send_funds', params: null } }
            normalizeJsonRpcParams(req, {}, () => {})
            assert.deepStrictEqual(req.body.params, {})
        })

        it('coalesces null params on every entry of a batch request', function () {
            const req = { body: [{ method: 'ping', params: null }, { method: 'status', params: null }] }
            normalizeJsonRpcParams(req, {}, () => {})
            assert.deepStrictEqual(req.body[0].params, {})
            assert.deepStrictEqual(req.body[1].params, {})
        })

        it('leaves already-present params untouched and still calls next', function () {
            const req = { body: { method: 'send_funds', params: { address: 'a', amount: 1 } } }
            let nextCalled = false
            normalizeJsonRpcParams(req, {}, () => { nextCalled = true })
            assert.deepStrictEqual(req.body.params, { address: 'a', amount: 1 })
            assert.strictEqual(nextCalled, true)
        })
    })
})
