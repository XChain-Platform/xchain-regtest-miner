// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.
//
// A generatetoaddress that hits the client timeout leaves the node mining. The
// mine queue must stay held until the node stops, or every barrier on it (pause,
// fill, the reorg primitives and the next mine) reaches the node mid-generation.
// The CONTROL drives an unflagged mine failure, which reproduces the early release,
// so a green settled case cannot be a harness that never held the queue.

const assert = require('assert')
const sinon = require('sinon')
const { MINE_SETTLE_DEADLINE_MS } = require('../../src/XChainRegtestMiner/constants.js')

// A node that keeps mining one block per poll interval after the client gave up.
function miningNode(blocksAfterAbort) {
    return { height: 100, remaining: blocksAfterAbort }
}

// Wire a miner to the node: the first mine times out (flagged or not), later mines
// succeed, and each sleep lets the node land one more block.
function wire(miner, node, { flagged }) {
    const seen = { remainingAtNextMine: null, remainingAtReconsider: null }
    let mines = 0
    miner.walletAddress = 'bcrt1qtest'
    miner.connector = {
        generateToAddress: async () => {
            if (++mines > 1) { seen.remainingAtNextMine = node.remaining; return ['hash'] }
            const err = new Error('Error generating to address')
            if (flagged) err.timedOut = true
            throw err
        },
        getBlockchainInfo: async () => ({ blocks: node.height }),
        reconsiderBlock: async () => { seen.remainingAtReconsider = node.remaining; return null },
    }
    sinon.stub(miner, 'refreshWalletFunds').resolves()
    sinon.stub(miner, 'sleep').callsFake(async () => {
        if (node.remaining > 0) { node.height++; node.remaining-- }
    })
    return seen
}

// Start a timed-out mine, then a pause, a reconsider and a second mine behind it.
async function raceBarriers(miner, node) {
    const mine = miner.generateBlocksQueued(5).catch((err) => err)
    const paused = miner.pauseMining().then(() => node.remaining)
    const reconsidered = miner.reconsiderBlock('ab'.repeat(32))
    const nextMine = miner.generateBlocksQueued(1)
    const remainingAtPause = await paused
    await Promise.all([reconsidered, nextMine])
    return { mineError: await mine, remainingAtPause }
}

describe('a generatetoaddress client timeout holds the mine queue until the node stops', function () {
    let miner

    beforeEach(function () {
        const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        sinon.stub(console, 'log')
        sinon.stub(console, 'warn')
        sinon.stub(console, 'error')
    })

    afterEach(function () {
        sinon.restore()
        delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
    })

    it('CONTROL: an unflagged mine failure releases the barriers while the node is still mining', async function () {
        const node = miningNode(4)
        const seen = wire(miner, node, { flagged: false })
        const { remainingAtPause } = await raceBarriers(miner, node)
        assert.strictEqual(remainingAtPause, 4, 'control must reproduce the early release, or the settled case proves nothing')
        assert.strictEqual(seen.remainingAtReconsider, 4)
        assert.strictEqual(seen.remainingAtNextMine, 4)
    })

    it('keeps pause, reconsider and the next mine waiting until the node height settles', async function () {
        const node = miningNode(4)
        const seen = wire(miner, node, { flagged: true })
        const { mineError, remainingAtPause } = await raceBarriers(miner, node)
        assert.strictEqual(remainingAtPause, 0, 'pauseMining must not resolve while blocks are still landing')
        assert.strictEqual(seen.remainingAtReconsider, 0)
        assert.strictEqual(seen.remainingAtNextMine, 0)
        assert.strictEqual(node.height, 104)
        assert.strictEqual(mineError.timedOut, true, 'the timed-out mine still rejects with its flag')
    })

    it('releases the queue at the settle deadline when the node never stops', async function () {
        const clock = sinon.useFakeTimers({ now: 1000, toFake: ['Date'] })
        const node = miningNode(Infinity)
        wire(miner, node, { flagged: true })
        miner.sleep.callsFake(async (ms) => { node.height++; clock.tick(ms) })
        const err = await miner.generateBlocksQueued(3).catch((e) => e)
        assert.strictEqual(err.timedOut, true)
        assert.ok(Date.now() - 1000 >= MINE_SETTLE_DEADLINE_MS, 'the hold must last until the deadline')
        await miner.pauseMining()
    })
})
