// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.
//
// The API port listens while start() is still awaiting prepareWallet(), so a
// mining control can land before the auto-mine loop exists. start() must honour
// an operator pause, invalidate or fill that landed there instead of switching
// mining back on, and must still start mining after a reorg pause alone, since
// nothing else would ever resume it.

const assert = require('assert')
const sinon = require('sinon')

const tick = () => new Promise((resolve) => setImmediate(resolve))

let miner
let realNow
let sigBefore

function setupMiner() {
    const XChainRegtestMiner = require('../../../src/XChainRegtestMiner')
    miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
    sinon.stub(console, 'log')
    realNow = Date.now
    sigBefore = { SIGTERM: process.listeners('SIGTERM'), SIGINT: process.listeners('SIGINT') }
}

function teardownMiner() {
    Date.now = realNow
    for (const sig of ['SIGTERM', 'SIGINT']) {
        for (const listener of process.listeners(sig)) {
            if (!sigBefore[sig].includes(listener)) process.removeListener(sig, listener)
        }
    }
    sinon.restore()
    delete require.cache[require.resolve('../../../src/XChainRegtestMiner')]
}

// Boot start() with a wallet preparation the test releases by hand, and a loop
// that mines a pending mempool on virtual time. Returns the handles a case needs.
async function bootPending() {
    let nowMs = 1e9
    Date.now = () => nowMs
    miner.sleep = async (ms) => { nowMs += (Number(ms) || 0); await tick() }
    let releaseWallet
    const walletPrepared = new Promise((resolve) => { releaseWallet = resolve })
    miner.prepareWallet = async function () {
        await walletPrepared
        this.walletAddress = 'bcrt1qtest'
        this.walletReady = true
    }
    const counts = { loopMines: 0 }
    miner.connector.getBalance = async () => 1
    miner.connector.getRawMempool = async () => ['tx1']
    miner.connector.generateToAddress = async (count) => { counts.loopMines++; return Array(count).fill('hash') }
    miner.connector.invalidateBlock = async () => null
    miner.connector.reconsiderBlock = async () => null
    const loop = miner.start()
    await tick()
    return {
        counts,
        loop,
        async ready() {
            releaseWallet()
            for (let spins = 0; !miner.getStatus().mining_started && spins < 1000; spins++) await tick()
            assert.strictEqual(miner.getStatus().mining_started, true, 'precondition: start() must have finished preparation')
        },
        // 600 passes of at least 100 virtual ms: far past the 30s pending-mempool timer.
        async spin() {
            for (let spins = 0; spins < 600; spins++) await tick()
        },
        async stop() {
            miner._shutdown = true
            await loop
        }
    }
}

async function expectStaysPaused(run) {
    await run.spin()
    assert.strictEqual(run.counts.loopMines, 0, 'the loop must not mine under a pause that landed before ready')
    assert.strictEqual(miner.getStatus().mining_paused, true)
    assert.strictEqual(miner.getStatus().mining_started, true)
}

async function expectMines(run) {
    await run.spin()
    assert.ok(run.counts.loopMines >= 1, 'the loop must be mining')
    assert.strictEqual(miner.getStatus().mining_paused, false)
    assert.strictEqual(miner.getStatus().mining_started, true)
}

describe('start(): mining controls that land during wallet preparation', function () {
    beforeEach(setupMiner)
    afterEach(teardownMiner)

    it('starts mining when nothing landed before ready', async function () {
        const run = await bootPending()
        try {
            await run.ready()
            await expectMines(run)
        } finally { await run.stop() }
    })

    it('keeps a pause_mining that landed before ready', async function () {
        const run = await bootPending()
        try {
            await miner.pauseMining()
            await run.ready()
            await expectStaysPaused(run)
            await miner.continueMining()
            await expectMines(run)
        } finally { await run.stop() }
    })

    it('keeps the pause an invalidate_block took before ready', async function () {
        const run = await bootPending()
        try {
            await miner.invalidateBlock('00ab')
            await run.ready()
            await expectStaysPaused(run)
        } finally { await run.stop() }
    })

    it('keeps a fill_mempool stop that landed before ready, after the fill ends', async function () {
        const run = await bootPending()
        try {
            let releaseSend
            const sendParked = new Promise((resolve) => { releaseSend = resolve })
            let sends = 0
            miner.sendFundsToAddress = async () => {
                sends++
                if (sends === 1) await sendParked
                throw new Error('send refused')
            }
            const fill = miner.fillMempool(1).catch(() => {})
            for (let spins = 0; sends === 0 && spins < 1000; spins++) await tick()
            assert.strictEqual(sends, 1, 'precondition: the fill must be in flight across preparation')
            await run.ready()
            assert.strictEqual(miner.fillMempoolRunning, true, 'precondition: the fill spans the start() write')
            releaseSend()
            await fill
            assert.strictEqual(miner.fillMempoolRunning, false)
            await expectStaysPaused(run)
            await miner.continueMining()
            await expectMines(run)
        } finally { await run.stop() }
    })
})

describe('start(): mining controls that land during wallet preparation', function () {
    beforeEach(setupMiner)
    afterEach(teardownMiner)

    it('starts mining when a pause and a continue both landed before ready', async function () {
        const run = await bootPending()
        try {
            await miner.pauseMining()
            await miner.continueMining()
            await run.ready()
            await expectMines(run)
        } finally { await run.stop() }
    })

    it('starts mining after a reconsider_block that finished before ready', async function () {
        const run = await bootPending()
        try {
            await miner.reconsiderBlock('00ab')
            await run.ready()
            await expectMines(run)
        } finally { await run.stop() }
    })

    it('hands the resume to a reconsider_block still in flight at ready', async function () {
        const run = await bootPending()
        let releaseReconsider
        const reconsiderParked = new Promise((resolve) => { releaseReconsider = resolve })
        try {
            miner.connector.reconsiderBlock = async () => { await reconsiderParked; return null }
            const reconsider = miner.reconsiderBlock('00ab')
            await tick()
            await run.ready()
            await run.spin()
            assert.strictEqual(run.counts.loopMines, 0, 'no loop mine may land inside the reorg')
            assert.strictEqual(miner.keepMining, false, 'start() must not switch mining on mid-reorg')
            releaseReconsider()
            await reconsider
            assert.strictEqual(miner.keepMining, true, 'the reorg exit must restore mining')
            await expectMines(run)
        } finally {
            // Release the reorg hold first, or a loop mine parked behind it never settles.
            releaseReconsider()
            await run.stop()
        }
    })

    it('keeps a pause_mining that landed before a finished reconsider_block', async function () {
        const run = await bootPending()
        try {
            await miner.pauseMining()
            await miner.reconsiderBlock('00ab')
            await run.ready()
            await expectStaysPaused(run)
        } finally { await run.stop() }
    })
})
