// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.
//
// : the mining loop is mempool-driven, so an idle chain never gains
// height and every height-gated wait (stake ACTIVATION_DELAY_BLOCKS,
// confirmation depth) stalls with nothing in flight to unstick it. Drills had
// to drop to raw node `generatetoaddress`. These pin the opt-in mine-empty
// heartbeat: OFF by default, validated bounds, and only ever firing on an
// empty mempool.

const assert = require('assert')
const sinon = require('sinon')

describe('XChainRegtestMiner idle mine-empty heartbeat ', function () {
    let XChainRegtestMiner
    let miner

    beforeEach(function () {
        XChainRegtestMiner = require('../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        sinon.stub(console, 'log')
    })

    afterEach(function () {
        sinon.restore()
        delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
    })

    describe('default posture', function () {
        it('is disabled out of the box', function () {
            assert.strictEqual(miner.idleMineIntervalMs, 0)
        })

        it('never reports a block due while disabled, however long the chain idles', function () {
            miner._mempoolSize = 0
            miner._lastMineAt = 0
            assert.strictEqual(miner._idleMineDue(60 * 60 * 1000, 0), false)
        })

        it('surfaces the setting in status so an operator can see which mode a venue runs', function () {
            assert.strictEqual(miner.getStatus().idle_mine_interval_ms, 0)
            miner.idleMineIntervalMs = 5000
            assert.strictEqual(miner.getStatus().idle_mine_interval_ms, 5000)
        })
    })

    describe('setIdleMineInterval', function () {
        it('enables the heartbeat', async function () {
            await miner.setIdleMineInterval(5000)
            assert.strictEqual(miner.idleMineIntervalMs, 5000)
        })

        it('0 disables it again', async function () {
            await miner.setIdleMineInterval(5000)
            await miner.setIdleMineInterval(0)
            assert.strictEqual(miner.idleMineIntervalMs, 0)
        })

        it('throws (never returns a sentinel) on non-integers and negatives', async function () {
            for (const bad of ['abc', 1.5, -1, null, undefined, NaN, {}]) {
                await assert.rejects(() => miner.setIdleMineInterval(bad), /Invalid idle mine interval/)
            }
            assert.strictEqual(miner.idleMineIntervalMs, 0, 'a rejected value must not be applied')
        })

        it('enforces the same bounds as the mining timers', async function () {
            await assert.rejects(() => miner.setIdleMineInterval(999), /too small/)
            await assert.rejects(() => miner.setIdleMineInterval(3600001), /too large/)
        })
    })

    describe('_idleMineDue', function () {
        beforeEach(async function () {
            await miner.setIdleMineInterval(5000)
        })

        it('fires once the interval has elapsed with an empty mempool', function () {
            miner._mempoolSize = 0
            miner._lastMineAt = 1000
            assert.strictEqual(miner._idleMineDue(6000, 0), true)
        })

        it('does not fire before the interval elapses', function () {
            miner._mempoolSize = 0
            miner._lastMineAt = 1000
            assert.strictEqual(miner._idleMineDue(5999, 0), false)
        })

        it('never fires while the mempool holds transactions', function () {
            // Those have their own dual-timer above; racing them would mine early.
            miner._mempoolSize = 3
            miner._lastMineAt = 1000
            assert.strictEqual(miner._idleMineDue(60000, 0), false)
        })

        it('measures from when the loop started watching when nothing has been mined yet', function () {
            // Enabling the heartbeat must not fire a block the instant the loop boots.
            miner._mempoolSize = 0
            miner._lastMineAt = null
            assert.strictEqual(miner._idleMineDue(4000, 1000), false)
            assert.strictEqual(miner._idleMineDue(6000, 1000), true)
        })

        it('re-arms from the last mine, so it paces at the interval', function () {
            miner._mempoolSize = 0
            miner._lastMineAt = 6000                 // the heartbeat block just landed
            assert.strictEqual(miner._idleMineDue(7000, 0), false)
            assert.strictEqual(miner._idleMineDue(11000, 0), true)
        })
    })
})
