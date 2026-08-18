// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.
//
// pauseMining() and fillMempool() advertise a barrier - after they
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

describe('pauseMining barrier vs the auto-mine loop', function () {
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

// reconsiderBlock pauses, does its work, and restores the prior mining state in a
// finally. A pause_mining RPC that lands while it is parked on the node's
// reconsider was answered "ok" and then overridden by that finally, so the
// operator walked into a height-deterministic section with the auto-mine loop
// live. The restore is now conditional on no FOREIGN writer having moved the
// mining state, and the control below runs the ORIGINAL unconditional restore so
// a green guarded case cannot be a harness that never interleaved. The
// nested-reconsider suite further down is the other half of the contract: the
// condition must not be "any generation change", which stalls the miner.
async function keepMiningAfterReconsider(miner, { guarded }) {
    let releaseNode
    const nodeParked = new Promise((resolve) => { releaseNode = resolve })

    miner.walletAddress = 'bcrt1qtest'
    miner.walletReady = true
    miner.keepMining = true
    miner.connector = { reconsiderBlock: async () => { await nodeParked; return 'ok' } }
    miner.refreshWalletFunds = async () => {}

    // The pre-fix body, verbatim apart from the hash argument.
    const original = async () => {
        const wasMining = miner.keepMining
        await miner.pauseMining()
        try {
            const result = await miner.connector.reconsiderBlock('00'.repeat(32))
            await miner.refreshWalletFunds()
            return result
        } finally {
            if (wasMining) miner.keepMining = true
        }
    }

    const run = guarded ? miner.reconsiderBlock('00'.repeat(32)) : original()
    // Let the reconsider reach the parked node RPC before the operator pauses.
    await new Promise((resolve) => setImmediate(resolve))
    await miner.pauseMining()
    releaseNode()
    await run

    return miner.keepMining
}

describe('reconsiderBlock vs a concurrent pause_mining', function () {
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

    it('CONTROL: the unconditional restore resumes mining an operator just paused', async function () {
        assert.strictEqual(await keepMiningAfterReconsider(miner, { guarded: false }), true,
            'control must reproduce the override, or the guarded case proves nothing')
    })

    it('the concurrent pause survives the finally', async function () {
        assert.strictEqual(await keepMiningAfterReconsider(miner, { guarded: true }), false,
            'a pause_mining answered "ok" must not be undone by reconsiderBlock')
    })

    it('still restores auto-mining when nothing else touched the flag', async function () {
        miner.walletAddress = 'bcrt1qtest'
        miner.keepMining = true
        miner.connector = { reconsiderBlock: async () => 'ok' }
        miner.refreshWalletFunds = async () => {}

        await miner.reconsiderBlock('00'.repeat(32))
        assert.strictEqual(miner.keepMining, true,
            'the sequential reorg flow must still get its auto-restore')
    })

    it('leaves a miner that was already paused paused', async function () {
        miner.walletAddress = 'bcrt1qtest'
        miner.keepMining = false
        miner.connector = { reconsiderBlock: async () => 'ok' }
        miner.refreshWalletFunds = async () => {}

        await miner.reconsiderBlock('00'.repeat(32))
        assert.strictEqual(miner.keepMining, false)
    })
})

// api.js exposes reconsider_block as an independent express-json-rpc-router
// handler with no queue, so two of them can be in flight at once. reconsiderBlock
// is itself a keepMining writer AND a generation bumper, so a restore guarded on
// "my generation is still the latest" is cancelled by the OTHER reconsider: both
// decline, keepMining stays false and the miner stalls with nobody left to call
// continueMining(). The control runs that epoch-only guard verbatim so a green
// guarded case cannot be a harness that never overlapped the two calls.
async function keepMiningAfterNestedReconsider(miner, { guarded }) {
    const parked = []
    const release = []
    for (let i = 0; i < 2; i++) {
        parked.push(new Promise((resolve) => { release.push(resolve) }))
    }

    let calls = 0
    miner.walletAddress = 'bcrt1qtest'
    miner.walletReady = true
    miner.keepMining = true
    miner.connector = { reconsiderBlock: async () => { await parked[calls++]; return 'ok' } }
    miner.refreshWalletFunds = async () => {}

    // The reverted epoch-guard body, verbatim apart from the hash argument.
    const epochGuarded = async () => {
        const wasMining = miner.keepMining
        const generation = await miner.pauseMining()
        try {
            const result = await miner.connector.reconsiderBlock('00'.repeat(32))
            await miner.refreshWalletFunds()
            return result
        } finally {
            if (wasMining && miner._miningStateGeneration === generation) miner.keepMining = true
        }
    }

    const call = () => guarded ? miner.reconsiderBlock('00'.repeat(32)) : epochGuarded()

    const first = call()
    // Let the first reconsider park on the node before the second one starts, so
    // the second genuinely begins after the first claimed its pause.
    await new Promise((resolve) => setImmediate(resolve))
    const second = call()
    await new Promise((resolve) => setImmediate(resolve))

    release[0]()
    await first
    release[1]()
    await second

    return miner.keepMining
}

describe('reconsiderBlock vs a concurrent reconsider_block', function () {
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

    it('CONTROL: an epoch-only guard silently stalls the miner', async function () {
        assert.strictEqual(await keepMiningAfterNestedReconsider(miner, { guarded: false }), false,
            'control must reproduce the stall, or the guarded case proves nothing')
    })

    it('two overlapping reconsiders still leave auto-mining running', async function () {
        assert.strictEqual(await keepMiningAfterNestedReconsider(miner, { guarded: true }), true,
            'no operator ever paused, so the miner must not be left stalled')
    })

    it('an operator pause between two overlapping reconsiders still wins', async function () {
        let releaseFirst
        const firstParked = new Promise((resolve) => { releaseFirst = resolve })

        miner.keepMining = true
        miner.refreshWalletFunds = async () => {}
        let calls = 0
        miner.connector = {
            reconsiderBlock: async () => { if (calls++ === 0) await firstParked; return 'ok' }
        }

        const first = miner.reconsiderBlock('00'.repeat(32))
        await new Promise((resolve) => setImmediate(resolve))
        // The operator pauses, THEN a second reconsider arrives: it must not
        // inherit the pre-pause "was mining" record from the first call.
        await miner.pauseMining()
        await miner.reconsiderBlock('11'.repeat(32))
        releaseFirst()
        await first

        assert.strictEqual(miner.keepMining, false,
            'a pause_mining answered "ok" must survive a later reconsider_block')
    })

    it('the last reconsider out is the one that restores', async function () {
        let releaseFirst
        const firstParked = new Promise((resolve) => { releaseFirst = resolve })

        miner.keepMining = true
        miner.refreshWalletFunds = async () => {}
        let calls = 0
        miner.connector = {
            reconsiderBlock: async () => { if (calls++ === 0) await firstParked; return 'ok' }
        }

        const first = miner.reconsiderBlock('00'.repeat(32))
        await new Promise((resolve) => setImmediate(resolve))
        await miner.reconsiderBlock('11'.repeat(32))
        // The inner call finished while the outer one is still parked on the node.
        assert.strictEqual(miner.keepMining, false,
            'mining must stay paused while an outer reconsider is still mid-reorg')

        releaseFirst()
        await first
        assert.strictEqual(miner.keepMining, true)
    })

    it('leaves no reorg-pause hold behind when the node RPC throws', async function () {
        miner.keepMining = true
        miner.refreshWalletFunds = async () => {}
        miner.connector = { reconsiderBlock: async () => { throw new Error('node said no') } }

        await assert.rejects(() => miner.reconsiderBlock('00'.repeat(32)), /node said no/)
        assert.strictEqual(miner._reorgPauseDepth, 0, 'a failed reconsider must release its hold')
        assert.strictEqual(miner.keepMining, true,
            'a failed reconsider must not leave the miner paused either')
    })
})
