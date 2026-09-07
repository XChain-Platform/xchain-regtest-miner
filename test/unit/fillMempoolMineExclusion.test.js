// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.
//
// fillMempool advertises a mempool holding N transactions. It claims its mutex,
// clears keepMining and drains _generateQueue ONCE, which stops the auto-mine
// loop and any mine already queued and stops nothing afterwards: api.js exposes
// generate_blocks with no mining gate, so a mine arriving during the broadcast
// loop mines the stress transactions straight back out while fill_mempool still
// answers "ok". The guard is a synchronous fillMempoolRunning check on the public
// entry point; the fill's own funding mines and prepareWallet's warmup take the
// private _generateBlocksQueued lane so the fill cannot reject its own work.
//
// The control runs the pre-fix public path verbatim (that lane IS the old body),
// so a green guarded case cannot be a harness that never interleaved the two.

const assert = require('assert')
const sinon = require('sinon')

const tick = () => new Promise((resolve) => setImmediate(resolve))

// Model fillMempool's shape: claim the flag, take the one-shot queue barrier,
// then park in the broadcast loop while an external mine is dispatched. Returns
// { mined, rejected }: blocks that reached the node during the fill, and whether
// the external call was refused.
async function externalMineDuringFill(miner, { guarded }) {
    let releaseBroadcast
    const broadcastParked = new Promise((resolve) => { releaseBroadcast = resolve })

    let filling = false
    let mined = 0

    miner.walletAddress = 'bcrt1qtest'
    miner.walletReady = true
    miner.connector = {
        generateToAddress: async () => {
            if (filling) mined++
            return ['hash']
        }
    }

    const fill = (async () => {
        miner.fillMempoolRunning = true
        miner.keepMining = false
        filling = true
        try {
            await miner._generateQueue
            // The fill's own funding mine still has to run.
            await miner._generateBlocksQueued(1)
            mined--
            // Stand in for the broadcast loop at the end of fillMempool.
            await broadcastParked
        } finally {
            filling = false
            miner.fillMempoolRunning = false
        }
    })()

    await tick()

    let rejected = false
    const external = (guarded ? miner.generateBlocks(1) : miner._generateBlocksQueued(1))
        .catch((err) => { rejected = /fill_mempool/.test(err && err.message) })
    await tick()

    releaseBroadcast()
    await fill
    await external

    return { mined, rejected }
}

describe('fill_mempool vs a concurrent generate_blocks', function () {
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

    it('CONTROL: the ungated mine path drains the mempool mid-fill', async function () {
        const { mined, rejected } = await externalMineDuringFill(miner, { guarded: false })
        assert.strictEqual(mined, 1, 'control must reproduce the drain, or the guarded case proves nothing')
        assert.strictEqual(rejected, false)
    })

    it('refuses an external generate_blocks for the whole fill', async function () {
        const { mined, rejected } = await externalMineDuringFill(miner, { guarded: true })
        assert.strictEqual(mined, 0, 'no external block may land while fill_mempool is building the mempool')
        assert.strictEqual(rejected, true, 'the caller must be told, not silently ignored')
    })

    it('rejects synchronously, before the queue append, so the guard cannot straddle an await', async function () {
        miner.fillMempoolRunning = true
        const queueBefore = miner._generateQueue
        await assert.rejects(() => miner.generateBlocks(1),
            /mining is disabled while fill_mempool is running/)
        assert.strictEqual(miner._generateQueue, queueBefore,
            'a refused mine must not have been appended to the mine queue')
    })

    it('lets the fill run its own funding mines while the public entry point is shut', async function () {
        let mined = 0
        miner.walletAddress = 'bcrt1qtest'
        miner.connector = { generateToAddress: async () => { mined++; return ['hash'] } }
        miner.fillMempoolRunning = true

        await miner._generateBlocksQueued(1)
        assert.strictEqual(mined, 1)
    })

    it('mines again normally once the fill has settled', async function () {
        let mined = 0
        miner.walletAddress = 'bcrt1qtest'
        miner.connector = { generateToAddress: async () => { mined++; return ['hash'] } }

        miner.fillMempoolRunning = true
        await assert.rejects(() => miner.generateBlocks(1), /fill_mempool/)
        miner.fillMempoolRunning = false
        await miner.generateBlocks(1)

        assert.strictEqual(mined, 1)
    })

    it('still validates the block count when no fill is running', async function () {
        await assert.rejects(() => miner.generateBlocks(0), /count must be a positive integer/)
        await assert.rejects(() => miner.generateBlocks(10001), /count exceeds maximum/)
    })
})
