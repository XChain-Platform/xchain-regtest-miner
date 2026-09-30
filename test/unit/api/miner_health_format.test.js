// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

'use strict'

const assert = require('assert')
const { evaluateMinerHealth, formatMinerHealth } = require('../../../src/api/health')

describe('formatMinerHealth', function () {
    it('formats a healthy status without changing its counters or flags', function () {
        const status = {
            wallet_ready: true,
            consecutive_errors: 0,
            mine_failures: 0,
            mining_paused: false,
            mining_started: true
        }

        assert.deepStrictEqual(formatMinerHealth(status, { healthy: true, reason: 'ok' }), {
            status: 'success',
            reason: 'ok',
            wallet_ready: true,
            consecutive_errors: 0,
            mine_failures: 0,
            mining_paused: false,
            mining_started: true
        })
    })

    it('formats missing status fields with boolean defaults', function () {
        assert.deepStrictEqual(formatMinerHealth({}, { healthy: false, reason: 'not_started' }), {
            status: 'degraded',
            reason: 'not_started',
            wallet_ready: false,
            consecutive_errors: undefined,
            mine_failures: undefined,
            mining_paused: false,
            mining_started: false
        })
    })

    it('coerces flags to booleans and passes counters through', function () {
        const result = formatMinerHealth(
            { wallet_ready: 1, mining_paused: 'yes', consecutive_errors: '3' },
            { healthy: true, reason: 'ok' }
        )

        assert.strictEqual(result.wallet_ready, true)
        assert.strictEqual(result.mining_paused, true)
        assert.strictEqual(result.consecutive_errors, '3')
    })
})

describe('formatMinerHealth with evaluated verdicts', function () {
    it('formats an operator pause as successful', function () {
        const status = { wallet_ready: true, mining_started: true, mining_paused: true }
        const verdict = evaluateMinerHealth({ status, uptimeMs: 120000 })
        const result = formatMinerHealth(status, verdict)

        assert.strictEqual(result.status, 'success')
        assert.strictEqual(result.reason, 'paused')
    })

    it('formats an unready wallet as degraded', function () {
        const status = { wallet_ready: false }
        const verdict = evaluateMinerHealth({ status, uptimeMs: 120000 })
        const result = formatMinerHealth(status, verdict)

        assert.strictEqual(result.status, 'degraded')
        assert.strictEqual(result.reason, 'wallet_not_ready')
    })
})
