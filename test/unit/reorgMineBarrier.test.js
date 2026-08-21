// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.
//
// invalidateBlock/reconsiderBlock claim, in their own comments, that the node
// never re-evaluates the chain while a generatetoaddress is in flight. Both only
// DRAINED the mine queue (pauseMining() / a bare `await this._generateQueue`) and
// then issued the node RPC outside it. The queue is settled the instant that
// await resolves - precisely because the reorg just drained it - so a
// generate_blocks RPC (api.js exposes it with no keepMining gate) arriving while
// the reorg was parked on the node ran its mine straight into the reorg, which is
// the overlap that breaks height-deterministic reorg drills.
//
// Each control below runs the pre-fix body verbatim, so a green guarded case
// cannot be a harness that never interleaved the two calls. The last suite pins
// the ordering rule the fix rests on: a mine queued BEFORE the reorg is drained by
// the reorg rather than gated on it, or the two would wait on each other forever.

const assert = require('assert')
const sinon = require('sinon')

const HASH = '00'.repeat(32)
const tick = () => new Promise((resolve) => setImmediate(resolve))

// Park the reorg's node RPC, land a generate_blocks while it is parked, and count
// the mines that reached the node with the reorg still in flight.
async function minesDuringReorg(miner, { verb, guarded }) {
    let releaseNode
    const nodeParked = new Promise((resolve) => { releaseNode = resolve })

    let reorgInFlight = false
    let overlaps = 0

    miner.walletAddress = 'bcrt1qtest'
    miner.walletReady = true
    miner.keepMining = true
    miner.refreshWalletFunds = async () => {}

    const nodeCall = async () => {
        reorgInFlight = true
        await nodeParked
        reorgInFlight = false
        return 'ok'
    }
    miner.connector = {
        invalidateBlock: nodeCall,
        reconsiderBlock: nodeCall,
        generateToAddress: async () => {
            if (reorgInFlight) overlaps++
            return ['hash']
        }
    }

    // The pre-fix bodies, verbatim apart from the hash argument.
    const originalInvalidate = async () => {
        await miner.pauseMining()
        const result = await miner.connector.invalidateBlock(HASH)
        await miner.refreshWalletFunds()
        return result
    }
    const originalReconsider = async () => {
        miner._enterReorgPause()
        try {
            await miner._generateQueue
            const result = await miner.connector.reconsiderBlock(HASH)
            await miner.refreshWalletFunds()
            return result
        } finally {
            miner._exitReorgPause()
        }
    }

    let reorg
    if (guarded) reorg = verb === 'invalidate' ? miner.invalidateBlock(HASH) : miner.reconsiderBlock(HASH)
    else reorg = verb === 'invalidate' ? originalInvalidate() : originalReconsider()

    // Let the reorg reach the parked node call before the concurrent RPC lands.
    await tick()
    const mine = miner.generateBlocks(1)
    await tick()

    releaseNode()
    await reorg
    await mine

    return overlaps
}

describe('reorg primitives vs a concurrent generate_blocks', function () {
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

    it('CONTROL: the drain-only invalidate lets a mine land mid-reorg', async function () {
        assert.strictEqual(await minesDuringReorg(miner, { verb: 'invalidate', guarded: false }), 1,
            'control must reproduce the overlap, or the guarded case proves nothing')
    })

    it('invalidateBlock holds off a generate_blocks that arrives mid-reorg', async function () {
        assert.strictEqual(await minesDuringReorg(miner, { verb: 'invalidate', guarded: true }), 0)
    })

    it('CONTROL: the drain-only reconsider lets a mine land mid-reorg', async function () {
        assert.strictEqual(await minesDuringReorg(miner, { verb: 'reconsider', guarded: false }), 1,
            'control must reproduce the overlap, or the guarded case proves nothing')
    })

    it('reconsiderBlock holds off a generate_blocks that arrives mid-reorg', async function () {
        assert.strictEqual(await minesDuringReorg(miner, { verb: 'reconsider', guarded: true }), 0)
    })

    it('the held-off mine still runs once the reorg finishes', async function () {
        let releaseNode
        const nodeParked = new Promise((resolve) => { releaseNode = resolve })
        let mines = 0

        miner.walletAddress = 'bcrt1qtest'
        miner.refreshWalletFunds = async () => {}
        miner.connector = {
            invalidateBlock: async () => { await nodeParked; return 'ok' },
            generateToAddress: async () => { mines++; return ['hash'] }
        }

        const reorg = miner.invalidateBlock(HASH)
        await tick()
        const mine = miner.generateBlocks(1)
        await tick()
        assert.strictEqual(mines, 0, 'the mine must wait, not fail')

        releaseNode()
        await reorg
        await mine
        assert.strictEqual(mines, 1, 'a deferred mine must still be honoured')
    })

    it('releases the hold when the reorg node call throws', async function () {
        miner.walletAddress = 'bcrt1qtest'
        miner.refreshWalletFunds = async () => {}
        miner.connector = {
            invalidateBlock: async () => { throw new Error('node said no') },
            generateToAddress: async () => ['hash']
        }

        await assert.rejects(() => miner.invalidateBlock(HASH), /node said no/)
        assert.strictEqual(miner._reorgMineHolds.size, 0, 'a failed reorg must not wedge mining')
        assert.deepStrictEqual(await miner.generateBlocks(1), ['hash'])
    })

    it('a mine queued before the reorg is drained by it, not gated on it', async function () {
        let releaseMine
        const mineParked = new Promise((resolve) => { releaseMine = resolve })

        miner.walletAddress = 'bcrt1qtest'
        miner.refreshWalletFunds = async () => {}
        miner.connector = {
            generateToAddress: async () => { await mineParked; return ['hash'] },
            invalidateBlock: async () => 'ok'
        }

        const mine = miner.generateBlocks(1)
        // Raised while that mine is still queued: the reorg must wait for it rather
        // than the mine waiting for the reorg, or neither ever runs.
        const reorg = miner.invalidateBlock(HASH)
        let reorgDone = false
        reorg.then(() => { reorgDone = true }, () => {})

        await tick()
        assert.strictEqual(reorgDone, false, 'the reorg must wait out the in-flight mine')

        releaseMine()
        await mine
        await reorg
        assert.strictEqual(reorgDone, true, 'the reorg must complete once the mine has')
    })
})
