// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.
//
// status.wallet_balance / wallet_funded are exported as the fund-capability
// oracle a drill reads INSTEAD of the startup-only wallet_ready. But this.balance
// used to be written only by prepareWallet (startup) and by refreshWalletFunds,
// whose only two callers were invalidateBlock and reconsiderBlock. Nothing in the
// auto-mine loop, in sendFundsToAddress or in fillMempool re-read it, so on any
// miner that never served a reorg RPC the field reported the startup balance for
// the life of the process and wallet_funded was a constant true, including after
// a fill_mempool had drained the wallet. The auto-mine loop now refreshes it on a
// bounded cadence.
//
// The CONTROL below reproduces that original failure by disabling the cadence
// check. Without it a green run here would prove only that the harness never
// drained the wallet.

const assert = require('assert')
const sinon = require('sinon')

// Mirrors CHECK_BLOCK_DELAY_MS / WALLET_BALANCE_REFRESH_MS in the miner.
const TICK_MS = 100
const REFRESH_MS = 5000

describe('wallet balance freshness in the auto-mine loop', function () {
    let XChainRegtestMiner
    let miner
    let connectorStub
    let nowMs

    beforeEach(function () {
        nowMs = 1_000_000
        connectorStub = {
            getNewAddress: sinon.stub().resolves('bcrt1qtest'),
            getBalance: sinon.stub().resolves(50.0),
            getRawMempool: sinon.stub().resolves([]),
            generateToAddress: sinon.stub().resolves(['blockhash1']),
            invalidateBlock: sinon.stub().resolves('invalidated'),
            reconsiderBlock: sinon.stub().resolves('reconsidered')
        }

        XChainRegtestMiner = require('../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        miner.connector = connectorStub

        sinon.stub(console, 'log')
        // Virtual clock: the loop's own bottom sleep is what advances it, so one
        // "tick" of wall time is exactly one loop iteration and the cadence guard is
        // exercised against real iteration counts rather than a timer race.
        sinon.stub(Date, 'now').callsFake(() => nowMs)
        sinon.stub(miner, 'sleep').callsFake(async () => {
            nowMs += TICK_MS
            await new Promise(resolve => setImmediate(resolve))
        })
        // Post-startup state, as prepareWallet leaves it. Deliberately once-only:
        // start() calls prepareWallet, so a stub that re-read the balance on every
        // start would refresh the status by itself and every assertion below would
        // pass with the loop refresh removed. The CONTROL test is what proves it does
        // not, so this stub must not do the loop's job for it.
        miner.prepareWallet = async function () {
            if (this.walletReady) return
            this.walletAddress = 'bcrt1qtest'
            this.balance = await this.connector.getBalance()
            this._balanceReadAt = Date.now()
            this.walletReady = true
        }
    })

    afterEach(function () {
        sinon.restore()
        delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
    })

    // Runs the real start() loop for `ticks` iterations, then shuts it down and
    // removes the signal handlers start() installs (they call process.exit).
    async function runLoop(ticks) {
        const before = { SIGTERM: process.listeners('SIGTERM'), SIGINT: process.listeners('SIGINT') }
        const deadline = nowMs + (ticks * TICK_MS)
        miner._shutdown = false
        const loop = miner.start()
        try {
            let spins = 0
            while (nowMs < deadline && spins < ticks * 50) {
                spins++
                await new Promise(resolve => setImmediate(resolve))
            }
        } finally {
            miner._shutdown = true
            await loop
            for (const sig of ['SIGTERM', 'SIGINT']) {
                for (const listener of process.listeners(sig)) {
                    if (!before[sig].includes(listener)) process.removeListener(sig, listener)
                }
            }
        }
    }

    describe('_walletRefreshDue (the cadence guard, load-bearing at a 100ms tick)', function () {
        it('is due when no balance has ever been read', function () {
            miner._balanceReadAt = null
            assert.strictEqual(miner._walletRefreshDue(nowMs), true)
        })

        it('is not due before the interval elapses', function () {
            miner._balanceReadAt = nowMs
            assert.strictEqual(miner._walletRefreshDue(nowMs + TICK_MS), false)
            assert.strictEqual(miner._walletRefreshDue(nowMs + REFRESH_MS - 1), false)
        })

        it('is due once the interval has elapsed', function () {
            miner._balanceReadAt = nowMs
            assert.strictEqual(miner._walletRefreshDue(nowMs + REFRESH_MS), true)
        })
    })

    // CONTROL: the pre-fix loop, reproduced by disabling the cadence check. If this
    // does not report a drained wallet as funded, the guarded case below proves
    // nothing about the defect.
    it('CONTROL: without the loop refresh a drained wallet still reports funded', async function () {
        miner._walletRefreshDue = () => false

        await miner.prepareWallet()
        connectorStub.getBalance.resolves(0)
        await runLoop(200)

        assert.strictEqual(miner.getStatus().wallet_balance, 50.0,
            'control must reproduce the frozen startup balance')
        assert.strictEqual(miner.getStatus().wallet_funded, true,
            'control must certify a drained wallet as funded')
    })

    it('reports the drained wallet unfunded within one interval, with no reorg RPC', async function () {
        connectorStub.getBalance.resolves(50.0)
        await runLoop(2)
        assert.strictEqual(miner.getStatus().wallet_funded, true, 'precondition: starts funded')

        connectorStub.getBalance.resolves(0)
        await runLoop((REFRESH_MS / TICK_MS) + 5)

        assert.strictEqual(miner.getStatus().wallet_balance, 0)
        assert.strictEqual(miner.getStatus().wallet_funded, false)
        assert.strictEqual(connectorStub.invalidateBlock.callCount, 0)
        assert.strictEqual(connectorStub.reconsiderBlock.callCount, 0)
    })

    it('keeps refreshing while mining is paused, which is when fill_mempool drains the wallet', async function () {
        await miner.prepareWallet()
        miner.keepMining = false
        const callsBefore = connectorStub.getBalance.callCount
        connectorStub.getBalance.resolves(0)

        // pauseMining() would be overwritten by start()'s own keepMining = true, so
        // hold the flag false from the loop's side instead: the point under test is
        // that the refresh sits ABOVE the keepMining gate, not how the flag got there.
        const loop = miner.start()
        const before = { SIGTERM: process.listeners('SIGTERM'), SIGINT: process.listeners('SIGINT') }
        try {
            const deadline = nowMs + (REFRESH_MS + (10 * TICK_MS))
            let spins = 0
            while (nowMs < deadline && spins < 5000) {
                miner.keepMining = false
                spins++
                await new Promise(resolve => setImmediate(resolve))
            }
        } finally {
            miner._shutdown = true
            await loop
            for (const sig of ['SIGTERM', 'SIGINT']) {
                for (const listener of process.listeners(sig)) {
                    if (!before[sig].includes(listener)) process.removeListener(sig, listener)
                }
            }
        }

        assert.ok(connectorStub.getBalance.callCount > callsBefore,
            'a paused loop must still refresh the balance')
        assert.strictEqual(miner.getStatus().wallet_funded, false)
        assert.strictEqual(miner.getStatus().mempool_size, 0)
    })

    it('reads the balance about once per interval, not once per loop tick', async function () {
        await miner.prepareWallet()
        const callsBefore = connectorStub.getBalance.callCount

        const intervals = 4
        await runLoop((REFRESH_MS / TICK_MS) * intervals)

        const reads = connectorStub.getBalance.callCount - callsBefore
        // A missing or inverted interval guard would issue one read per 100ms tick,
        // i.e. ~200 here rather than ~4.
        assert.ok(reads >= 1 && reads <= intervals + 2,
            'expected about ' + intervals + ' balance reads over ' + intervals +
            ' refresh intervals, got ' + reads)
    })

    it('exports wallet_balance_at: null before any read, non-decreasing after', async function () {
        const fresh = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        assert.strictEqual(fresh.getStatus().wallet_balance_at, null)

        await miner.prepareWallet()
        const first = miner.getStatus().wallet_balance_at
        assert.strictEqual(typeof first, 'number')

        await runLoop((REFRESH_MS / TICK_MS) + 5)
        const second = miner.getStatus().wallet_balance_at
        assert.ok(second >= first, 'wallet_balance_at must never move backwards')
        assert.ok(second > first, 'the loop refresh must advance wallet_balance_at')
    })

    it('stamps wallet_balance_at even when the read fails, so a wedged node is not re-polled every tick', async function () {
        await miner.prepareWallet()
        connectorStub.getBalance.rejects(new Error('node unreachable'))

        await miner.refreshWalletFunds()

        assert.strictEqual(miner.getStatus().wallet_balance, null)
        assert.strictEqual(miner.getStatus().wallet_funded, false)
        assert.strictEqual(miner.getStatus().wallet_balance_at, nowMs)
        assert.strictEqual(miner._walletRefreshDue(nowMs), false)
    })
})
