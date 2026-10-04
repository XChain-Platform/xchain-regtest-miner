// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

'use strict'

const assert = require('assert')
const sinon = require('sinon')
const miningSchedule = require('../../../src/XChainRegtestMiner/mining_schedule')
const { logger } = require('../../../src/XChainRegtestMiner/constants')

function useSinonSandbox() {
    beforeEach(function () {
        sinon.stub(logger, 'info')
    })
    afterEach(function () {
        sinon.restore()
    })
}

describe('sleep', function () {
    useSinonSandbox()

    it('resolves only after the requested delay', async function () {
        const clock = sinon.useFakeTimers()
        let resolved = false
        const sleeping = miningSchedule.sleep(10).then(() => { resolved = true })

        await clock.tickAsync(9)
        assert.strictEqual(resolved, false)
        await clock.tickAsync(1)
        await sleeping
        assert.strictEqual(resolved, true)
    })
})

describe('setMiningTime', function () {
    useSinonSandbox()

    it('accepts bounded positive integers', async function () {
        const state = {}

        await miningSchedule.setMiningTime.call(state, 1000, 5000)

        assert.strictEqual(state.maxTimeToMineTxs, 1000)
        assert.strictEqual(state.addedTimeToMineTxs, 5000)
    })

    it('throws for a value below the minimum', async function () {
        const state = {}

        await assert.rejects(
            () => miningSchedule.setMiningTime.call(state, 999, 5000),
            /Mining times too small/
        )
        assert.strictEqual(state.maxTimeToMineTxs, undefined)
    })
})

describe('setIdleMineInterval', function () {
    useSinonSandbox()

    it('accepts a bounded non-zero interval', async function () {
        const state = {}

        await miningSchedule.setIdleMineInterval.call(state, 1000)

        assert.strictEqual(state.idleMineIntervalMs, 1000)
    })

    it('throws for a negative interval', async function () {
        const state = {}

        await assert.rejects(
            () => miningSchedule.setIdleMineInterval.call(state, -1),
            /Invalid idle mine interval/
        )
        assert.strictEqual(state.idleMineIntervalMs, undefined)
    })
})

describe('setMockTime', function () {
    useSinonSandbox()

    it('accepts a finite timestamp and delegates its numeric value', async function () {
        const connector = { setMockTime: sinon.stub().resolves('set') }
        const state = { network: 'bitcoin-regtest', connector }

        const result = await miningSchedule.setMockTime.call(state, '1900000000')

        assert.strictEqual(result, 'set')
        assert(connector.setMockTime.calledOnceWithExactly(1900000000))
    })

    it('throws for a negative timestamp without delegating', async function () {
        const connector = { setMockTime: sinon.stub().resolves() }
        const state = { network: 'bitcoin-regtest', connector }

        await assert.rejects(
            () => miningSchedule.setMockTime.call(state, -1),
            /timestamp must be a non-negative unix time/
        )
        assert(connector.setMockTime.notCalled)
    })
})
