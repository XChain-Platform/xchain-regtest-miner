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
            await miner.generateBlocksQueued(1)
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
    const external = (guarded ? miner.generateBlocks(1) : miner.generateBlocksQueued(1))
        .catch((err) => { rejected = /fill_mempool/.test(err && err.message) })
    await tick()

    releaseBroadcast()
    await fill
    await external

    return { mined, rejected }
}

let miner

function setupMiner() {
    const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
    miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
    sinon.stub(console, 'log')
}

function teardownMiner() {
    sinon.restore()
    delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
}

describe('fill_mempool vs a concurrent generate_blocks', function () {
    beforeEach(setupMiner)
    afterEach(teardownMiner)

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
})

describe('fill_mempool vs a concurrent generate_blocks', function () {
    beforeEach(setupMiner)
    afterEach(teardownMiner)

    it('lets the fill run its own funding mines while the public entry point is shut', async function () {
        let mined = 0
        miner.walletAddress = 'bcrt1qtest'
        miner.connector = { generateToAddress: async () => { mined++; return ['hash'] } }
        miner.fillMempoolRunning = true

        await miner.generateBlocksQueued(1)
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

// continue_mining sets keepMining true with no fill check, so a call that lands
// mid-fill must not let the REAL auto-mine loop hit the generateBlocks guard every
// pass, count each refusal as a failed mine and drive health to mine_failures.
// Both loop mine sites are driven: the pending-mempool timer and the idle heartbeat.
async function continueMiningDuringFill({ rawMempool, idleMineIntervalMs }) {
    const { evaluateMinerHealth } = require('../../src/api/health')
    let nowMs = 1e9
    const realNow = Date.now
    Date.now = () => nowMs
    miner.sleep = async (ms) => { nowMs += (Number(ms) || 0); await tick() }
    miner.prepareWallet = async function () { this.walletAddress = 'bcrt1qtest'; this.walletReady = true }
    miner.connector.getBalance = async () => 1
    miner.connector.getRawMempool = async () => rawMempool
    let mines = 0
    miner.connector.generateToAddress = async (count) => { mines++; return Array(count).fill('hash') }
    await miner.setIdleMineInterval(idleMineIntervalMs)

    const sigBefore = { SIGTERM: process.listeners('SIGTERM'), SIGINT: process.listeners('SIGINT') }
    const loop = miner.start()
    try {
        for (let spins = 0; !miner.getStatus().mining_started && spins < 1000; spins++) await tick()
        assert.strictEqual(miner.getStatus().mining_started, true, 'precondition: the loop must be running')

        // Hold the fill open exactly as fillMempool does, then resume mid-fill.
        miner.fillMempoolRunning = true
        miner.keepMining = false
        miner._miningStateGeneration++
        await miner.continueMining()
        await assert.rejects(() => miner.generateBlocks(1), /fill_mempool/,
            'precondition: the guard is live, so zero failures means the loop never reached it')

        // 3000 passes of at least 100 virtual ms each: far past the 5s timer and 1s idle interval.
        for (let spins = 0; spins < 3000 && miner.getStatus().mine_failures < 5; spins++) await tick()
        const during = miner.getStatus()
        assert.strictEqual(mines, 0, 'no loop block may land while the fill runs')
        assert.strictEqual(during.mine_failures, 0, 'a fill-guard refusal is not a failed mine')
        assert.ok(during.consecutive_errors < 5, 'got consecutive_errors ' + during.consecutive_errors)
        assert.strictEqual(evaluateMinerHealth({ status: during, uptimeMs: 10 * 60000 }).healthy, true)

        // The fill ends: the resume the caller asked for takes effect.
        miner.fillMempoolRunning = false
        for (let spins = 0; spins < 3000 && mines === 0; spins++) await tick()
        assert.ok(mines >= 1, 'the loop must mine again once the fill has settled')
    } finally {
        miner._shutdown = true
        await loop
        Date.now = realNow
        for (const sig of ['SIGTERM', 'SIGINT']) {
            for (const listener of process.listeners(sig)) {
                if (!sigBefore[sig].includes(listener)) process.removeListener(sig, listener)
            }
        }
    }
}

describe('fill_mempool vs a mid-fill continue_mining', function () {
    beforeEach(setupMiner)
    afterEach(teardownMiner)

    it('keeps the pending-mempool timer mine idle until the fill ends', async function () {
        await continueMiningDuringFill({ rawMempool: ['tx1'], idleMineIntervalMs: 0 })
    })

    it('keeps the idle heartbeat mine idle until the fill ends', async function () {
        await continueMiningDuringFill({ rawMempool: [], idleMineIntervalMs: 1000 })
    })
})
