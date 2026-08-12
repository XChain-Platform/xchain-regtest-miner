// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.
//
// : pauseMining() and fillMempool() advertise a barrier - after they
// resolve, no further block lands until continueMining(). The _generateQueue
// await they take only drains the mine already in flight; it does not stop the
// auto-mine loop from starting a NEW one. The loop reads keepMining once at the
// top of its body and then awaits getRawMempool(), so a pause that arrives
// during that RPC cleared its barrier and returned while the loop went on to the
// idle-mine call below with a stale flag. A block then landed inside a section
// the caller had been told was serialized, which is precisely what the
// height-deterministic reorg and mempool drills depend on not happening.
//
// The control below reproduces that (the loop mining after the barrier resolved)
// against a loop body with the guard removed, so a green run here cannot be a
// harness that never entered the path.

const assert = require('assert')
const sinon = require('sinon')

// Drive one pass of the auto-mine loop's idle-mine branch with a getRawMempool
// that parks until released, pause mid-RPC, then let the loop continue. Returns
// how many mines were issued after pauseMining() resolved.
async function minesAfterBarrier(miner, { guarded }) {
    let releaseMempool
    const mempoolParked = new Promise((resolve) => { releaseMempool = resolve })

    let barrierResolved = false
    const minesAfter = []

    miner.walletAddress = 'bcrt1qtest'
    miner.walletReady = true
    miner.keepMining = true
    miner.idleMineIntervalMs = 1000
    miner._lastMineAt = 0

    miner.connector = {
        getRawMempool: async () => { await mempoolParked; return [] },
        generateToAddress: async () => {
            if (barrierResolved) minesAfter.push(Date.now())
            return ['hash']
        }
    }

    // One iteration of the real loop body's idle-mine path. `guarded` is the
    // fix under test: re-read keepMining immediately before the mine, with no
    // await between the check and the call.
    const iteration = (async () => {
        if (!miner.keepMining) return
        await miner.connector.getRawMempool()
        if (miner._idleMineDue(Date.now(), 0)) {
            if (guarded && !miner.keepMining) return
            await miner.generateBlocks(1)
        }
    })()

    // Pause while the loop is parked inside getRawMempool: the flag flips and the
    // queue barrier finds nothing in flight, so the caller is told mining stopped.
    const paused = miner.pauseMining().then(() => { barrierResolved = true })
    await paused
    releaseMempool()
    await iteration

    return minesAfter.length
}

describe('pauseMining barrier vs the auto-mine loop ()', function () {
    let miner

    beforeEach(function () {
        const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        sinon.stub(console, 'log')
    })

    afterEach(function () {
        sinon.restore()
        delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
    })

    it('CONTROL: without the guard a block lands after pauseMining() resolved', async function () {
        assert.strictEqual(await minesAfterBarrier(miner, { guarded: false }), 1,
            'control must reproduce the original failure, or the guarded case proves nothing')
    })

    it('with the guard no block lands after pauseMining() resolved', async function () {
        assert.strictEqual(await minesAfterBarrier(miner, { guarded: true }), 0)
    })

    it('the shipped loop carries the guard at both auto-mine sites', function () {
        const fs = require('fs')
        const path = require('path')
        const src = fs.readFileSync(path.join(__dirname, '../../src/XChainRegtestMiner.js'), 'utf8')
        const body = src.slice(src.indexOf('while (!this._shutdown)'))
        const guards = body.split('if (!this.keepMining) { await this.sleep(CHECK_BLOCK_DELAY_MS); continue }').length - 1
        assert.strictEqual(guards, 2,
            'both loop mine sites must re-read keepMining immediately before generateBlocks')
    })

    it('an in-flight mine still holds the barrier open (the queue drain is unchanged)', async function () {
        let releaseMine
        const mineParked = new Promise((resolve) => { releaseMine = resolve })
        miner.walletAddress = 'bcrt1qtest'
        miner.connector = { generateToAddress: async () => { await mineParked; return ['hash'] } }

        const mining = miner.generateBlocks(1)
        let barrierDone = false
        const barrier = miner.pauseMining().then(() => { barrierDone = true })

        await new Promise((resolve) => setImmediate(resolve))
        assert.strictEqual(barrierDone, false, 'pauseMining must not resolve while a mine is in flight')

        releaseMine()
        await mining
        await barrier
        assert.strictEqual(barrierDone, true)
    })
})
