// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.
//
// NODE_RPC_TIMEOUT crosses into axios.defaults.timeout as a number. axios reads
// NaN as no timeout at all, a negative value throws inside the socket, and a bare
// parseInt reads "60s" as 60ms, so the config home falls back to 60000 for
// anything that is not a plain non-negative integer.

const assert = require('assert')

const CONFIG_PATH = require.resolve('../../../src/config')

function loadTimeout(value) {
    const saved = process.env.NODE_RPC_TIMEOUT
    if (value === undefined) delete process.env.NODE_RPC_TIMEOUT
    else process.env.NODE_RPC_TIMEOUT = value
    delete require.cache[CONFIG_PATH]
    try {
        return require('../../../src/config').NODE_RPC_TIMEOUT_MS
    } finally {
        if (saved === undefined) delete process.env.NODE_RPC_TIMEOUT
        else process.env.NODE_RPC_TIMEOUT = saved
        delete require.cache[CONFIG_PATH]
    }
}

describe('NODE_RPC_TIMEOUT config coercion', function () {
    it('defaults to 60000 when unset', function () {
        assert.strictEqual(loadTimeout(undefined), 60000)
    })

    for (const bad of ['', '   ', 'abc', 'NaN', '-5', '60s', '1e3', '15000.5']) {
        it('falls back to 60000 for ' + JSON.stringify(bad), function () {
            assert.strictEqual(loadTimeout(bad), 60000)
        })
    }

    it('honors an explicit positive value', function () {
        assert.strictEqual(loadTimeout('15000'), 15000)
        assert.strictEqual(loadTimeout(' 15000 '), 15000)
    })

    it('keeps 0, which axios reads as no timeout', function () {
        assert.strictEqual(loadTimeout('0'), 0)
    })
})
