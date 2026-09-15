// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.
//
// The auto-mine loop and wallet preparation run beside the API's flows (pause,
// continue, generate_blocks, the reorg and fill drills), so every await is a
// place where one of those flows can run. Three runs of shared-state writes must
// stay synchronous, with no turn inside them:
//   - after a successful mempool read, the error-streak reset through the
//     mempool size write;
//   - after a successful mine, the error-streak and mine-failure reset through
//     the loop's next RPC or sleep;
//   - in prepareWallet, the final balance check through the balance stamp.
// Moving a reset or a check to the end of an awaited helper puts a turn inside
// the run while the await count stays the same, which is why this test counts
// turns directly instead of awaits.
//
// Method: every connector RPC and every sleep resolves through a seeded number
// of microtask hops, so concurrent flows interleave at every turn, and a prober
// flow logs an event at EVERY microtask turn. A prober event inside one of the
// runs above means another flow could have run there. The CONTROL span contains
// the mempool RPC's own await, so it proves the prober does land inside a span
// that has a turn: a zero in the guarded runs is then a measurement, not a
// detector that never fires.

const assert = require('assert')

const SEEDS = 40

function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

// A connector whose every RPC logs rpc:<name>, resolves after a seeded number of
// microtask hops, and logs res:<name> (or fail:<name> for an injected failure,
// enabled only once mining has started so wallet preparation always succeeds).
function stubConnector(ctx) {
    const { rnd, ri, ev, hops, state } = ctx
    const FAILABLE = new Set(['getRawMempool', 'generateToAddress'])
    const values = {
        getNewAddress: () => 'bcrt1qtest',
        // The startup read and the first poll see 0, so the mine-to-maturity path runs.
        getBalance: () => (state.balanceCalls++ < 2 ? 0 : 50),
        getRawMempool: () => (rnd() < 0.5 ? [] : Array.from({ length: ri(1, 3) }, (_, i) => 'tx' + i)),
        generateToAddress: (n) => Array.from({ length: n }, (_, i) => 'h' + i)
    }
    return new Proxy({}, {
        get(_, name) {
            if (typeof name !== 'string' || name === 'then') return undefined
            if (name === 'setWalletName') return () => {}
            return async (...args) => {
                ev('rpc:' + name)
                await hops(ri(0, 4))
                if (state.started && FAILABLE.has(name) && rnd() < 0.08) { ev('fail:' + name); throw new Error('stub ' + name) }
                ev('res:' + name)
                const v = values[name]
                return typeof v === 'function' ? v(...args) : (v === undefined ? true : v)
            }
        }
    })
}

// Logs every write of the guarded status fields, and every read and write of the
// balance, so the analysis can place each prober event against them.
function instrumentFields(miner, ev) {
    const instrument = (name, logReads) => {
        let v = miner[name]
        Object.defineProperty(miner, name, {
            configurable: true,
            get() { if (logReads) ev('r:' + name); return v },
            set(x) { ev('w:' + name); v = x }
        })
    }
    for (const n of ['_consecutiveErrors', '_mempoolSize', '_mineFailures', '_balanceReadAt']) instrument(n, false)
    instrument('balance', true)
}

// Runs the miner from start() to shutdown under one seed and returns the event
// log: rpc:/res:/fail: per connector call, w:/r: per instrumented field access,
// paused/continue around each API pause, and probe once per microtask turn.
async function runSeed(XChainRegtestMiner, seed) {
    const rnd = mulberry32(seed)
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
    const log = []
    const ev = (k) => log.push(k)
    const hops = async (n) => { for (let i = 0; i < n; i++) await null }
    const state = { balanceCalls: 0, started: false, now: 1000000, sleeps: 0 }
    const realNow = Date.now
    Date.now = () => state.now

    const miner = new XChainRegtestMiner('bitcoin-regtest', 'localhost', '18443', 'u', 'p')
    miner.connector = stubConnector({ rnd, ri, ev, hops, state })
    miner.maxTimeToMineTxs = 300
    miner.addedTimeToMineTxs = 150
    miner.idleMineIntervalMs = 400
    miner.sleep = async (ms) => {
        ev('sleep')
        if (++state.sleeps >= 60) miner._shutdown = true
        state.now += Math.min(ms, 5000)
        await hops(ri(1, 3))
    }
    instrumentFields(miner, ev)

    let done = false
    const prober = (async () => { while (!done) { await null; ev('probe') } })()
    const api = (async () => {
        while (!miner.miningStarted && !done) await null
        started = true
        for (let r = 0; r < 3 && !miner._shutdown; r++) {
            await hops(ri(5, 60))
            await miner.pauseMining()
            ev('paused')
            await hops(ri(0, 12))
            ev('continue')
            await miner.continueMining()
        }
    })()
    const sigListeners = { SIGTERM: process.listeners('SIGTERM'), SIGINT: process.listeners('SIGINT') }
    try {
        await miner.start()
    } finally {
        done = true
        await api.catch(() => {})
        await prober
        Date.now = realNow
        // start() installs SIGTERM/SIGINT handlers on every run; keep only the originals.
        for (const sig of ['SIGTERM', 'SIGINT']) {
            for (const l of process.listeners(sig)) if (!sigListeners[sig].includes(l)) process.removeListener(sig, l)
        }
    }
    return log
}

// Counts prober events inside each guarded run, plus mines issued while paused.
function analyze(log) {
    const r = { m1: 0, m2: 0, m3: 0, barrier: 0, control: 0, m1Spans: 0, m2Spans: 0, m3Spans: 0 }
    let armed1 = false, in1 = false, in2 = false, inControl = false
    let lastBalRead = -1, stamped = false, paused = false
    for (let i = 0; i < log.length; i++) {
        const e = log[i]
        if (e === 'rpc:getRawMempool') inControl = true
        if (e === 'res:getRawMempool') { armed1 = true; inControl = false }
        if (e === 'fail:getRawMempool') inControl = false
        if (e === 'w:_consecutiveErrors' && armed1) { in1 = true; armed1 = false; r.m1Spans++ }
        else if (e === 'w:_mempoolSize') in1 = false
        if (e === 'w:_mineFailures') { in2 = true; r.m2Spans++ }
        else if (in2 && (e.startsWith('rpc:') || e === 'sleep')) in2 = false
        if (e === 'r:balance') lastBalRead = i
        if (e === 'w:_balanceReadAt' && !stamped) {
            stamped = true
            if (lastBalRead >= 0) { r.m3Spans++; for (let j = lastBalRead; j < i; j++) if (log[j] === 'probe') r.m3++ }
        }
        if (e === 'paused') paused = true
        if (e === 'continue') paused = false
        if (paused && e === 'rpc:generateToAddress') r.barrier++
        if (e === 'probe') { if (in1) r.m1++; if (in2) r.m2++; if (inControl) r.control++ }
    }
    return r
}

describe('mine loop and wallet preparation keep their shared-state runs free of turns', function () {
    this.timeout(60000)
    const saved = {}
    let totals

    before(async function () {
        for (const m of ['log', 'info', 'warn', 'error', 'debug']) { saved[m] = console[m]; console[m] = () => {} }
        try {
            const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
            totals = { m1: 0, m2: 0, m3: 0, barrier: 0, control: 0, m1Spans: 0, m2Spans: 0, m3Spans: 0 }
            for (let seed = 1; seed <= SEEDS; seed++) {
                const a = analyze(await runSeed(XChainRegtestMiner, seed))
                for (const k of Object.keys(a)) totals[k] += a[k]
            }
        } finally {
            for (const m of Object.keys(saved)) console[m] = saved[m]
        }
    })

    it('CONTROL: the prober lands inside a span that contains an await', function () {
        assert.ok(totals.control > 0, 'the prober never ran inside the mempool RPC await, so zeros below would prove nothing')
    })

    it('keeps the reset after a mempool read in one run with the mempool size write', function () {
        assert.ok(totals.m1Spans > 0, 'no successful mempool read was exercised')
        assert.strictEqual(totals.m1, 0, `a flow ran between the error-streak reset and the mempool size write ${totals.m1} times`)
    })

    it('keeps the reset after a mine in one run with the next RPC or sleep', function () {
        assert.ok(totals.m2Spans > 0, 'no mine outcome was exercised')
        assert.strictEqual(totals.m2, 0, `a flow ran between the mine reset and the next RPC ${totals.m2} times`)
    })

    it('keeps the final balance check and the balance stamp in one run', function () {
        assert.strictEqual(totals.m3Spans, SEEDS, 'every seed must reach the startup stamp through the mining path')
        assert.strictEqual(totals.m3, 0, `a flow ran between the final balance check and the stamp ${totals.m3} times`)
    })

    it('never issues a mine between a resolved pause and its continue', function () {
        assert.strictEqual(totals.barrier, 0)
    })
})
