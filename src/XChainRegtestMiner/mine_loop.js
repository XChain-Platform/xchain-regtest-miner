/*********************************************************************
 *
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC – https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 *
 **********************************************************************
 *
 * XChain Regtest Miner - Mine Loop
 *
 * The auto-mine loop: mempool timers, the idle heartbeat, the RPC error
 * streak and the pause barrier guards, run against the miner as `this`.
 *
 ********************************************************************/

'use strict';

const { CHECK_BLOCK_DELAY_MS, logger } = require('./constants.js');
const { maybeFlushNode } = require('./node_flush.js');

const MAX_BACKOFF_MS = 30000;

// Whether the auto-mine loop may mine now: not paused, and no fill_mempool run in
// progress. keepMining alone is not enough, because continue_mining can set it true
// in the middle of a fill, and generateBlocks then refuses every loop mine.
function loopMayMine() {
    return this.keepMining && !this.fillMempoolRunning;
}

// The auto-mine loop itself. `loop` carries the mempool timers, the RPC error
// streak and the heartbeat baseline across passes.
async function runMineLoop(loop) {
    while (!this._shutdown) {
        // Bound wallet_balance staleness at WALLET_BALANCE_REFRESH_MS whatever
        // moved the wallet: send_funds, fill_mempool, coinbase maturity, a
        // node-side change. Deliberately ABOVE the keepMining gate, because
        // fill_mempool and pause_mining hold that flag false for exactly the
        // windows in which the wallet drains, and a refresh that only ran while
        // mining would go quiet at the moment it is needed. refreshWalletFunds()
        // never throws, so this cannot break the loop; and both mine sites below
        // re-read loopMayMine immediately before generateBlocks, so this await
        // cannot reopen the pause barrier window those guards close.
        if (this.walletRefreshDue(Date.now())) {
            await this.refreshWalletFunds();
        }
        // A running fill idles the loop exactly like a pause (see loopMayMine).
        if (!loopMayMine.call(this)) {
            // Drop timers armed before the pause, so a resumed loop re-arms them from
            // a fresh mempool read instead of mining at once on their old timestamps.
            resetMempoolTimers(loop);
            await this.sleep(CHECK_BLOCK_DELAY_MS);
        } else {
            await mineLoopPass.call(this, loop);
        }
    }
}

// One mining pass for a loop that may mine, ending in the check delay. A failed read or
// mine has already backed off, so it returns early and the next pass starts at once. The
// bookkeeping after a mine and the closing sleep stay in this one synchronous run: split
// across an await boundary, a concurrent flow could land between them.
async function mineLoopPass(loop) {
    // Read the mempool BEFORE any mine decision: txs mined or dropped since
    // the last pass (by generate_blocks, a reorg) must clear their timers first.
    const read = await readLoopMempool.call(this, loop);
    if (!read.ok) return;
    clearErrorStreak.call(this, loop, false);
    const mempoolEmpty = trackMempool.call(this, loop, read.rawMempool);

    if (!mempoolEmpty && timerMineDue.call(this, loop)) {
        // Re-read loopMayMine with NO await before the mine. The mempool read
        // above awaits, and a pause or fill landing during it has already
        // cleared its _generateQueue barrier, so only this re-read stops a
        // loop mine inside a section the caller was told is serialized.
        if (!loopMayMine.call(this)) {
            await this.sleep(CHECK_BLOCK_DELAY_MS);
            return;
        }
        if (!(await mineLoopBlock.call(this, loop, 'generating a new block'))) return;
        clearErrorStreak.call(this, loop, true);
        resetMempoolTimers(loop);
    }

    // Mine-empty heartbeat (60000 ms under the API service unless
    // IDLE_MINE_INTERVAL_MS / set_idle_mine_interval set 0). Only on
    // the empty-mempool branch: a pending transaction has its own
    // timer above, and racing it would mine the block early.
    if (mempoolEmpty && this.idleMineDue(Date.now(), loop.watchingSince)) {
        // The real window this guard closes. The loop's loopMayMine check
        // sits above the `await this.connector.getRawMempool()` in readLoopMempool,
        // so a pauseMining()/fillMempool() that flipped the flag
        // during that RPC had already cleared its _generateQueue barrier
        // and returned by the time control reached here: the heartbeat then
        // landed a block INSIDE a section the caller had been told was
        // serialized, corrupting exactly the height-deterministic reorg and
        // mempool drills the barrier exists for.
        if (!loopMayMine.call(this)) {
            await this.sleep(CHECK_BLOCK_DELAY_MS);
            return;
        }
        if (!(await mineLoopBlock.call(this, loop, 'mining an idle block'))) return;
        clearErrorStreak.call(this, loop, true);
        maybeFlushNode.call(this, loop, Date.now());
    }
    await this.sleep(CHECK_BLOCK_DELAY_MS);
}

// Whether a pending mempool is due to be mined: the first tx has waited
// maxTimeToMineTxs, or no new tx has arrived for addedTimeToMineTxs.
function timerMineDue(loop) {
    if (loop.initialStartToMine > 0 && loop.extendedStartToMine > 0) {
        let timeNow = Date.now();
        let initialTimePassed = timeNow - loop.initialStartToMine;
        let extendedStartTime = timeNow - loop.extendedStartToMine;

        return initialTimePassed >= this.maxTimeToMineTxs || extendedStartTime >= this.addedTimeToMineTxs;
    }
    return false;
}

// Mines one block for the loop. Resolves true on success; on failure it extends
// both error streaks, backs off, and resolves false so the loop starts its next pass.
async function mineLoopBlock(loop, what) {
    try {
        await this.generateBlocks(1);
        // blocks_mined / last_mine_at are updated in generateBlocksRaw
        // (the chokepoint all mining paths flow through). The caller clears the
        // error streak; see clearErrorStreak for why that is not done here.
        return true;
    } catch (err) {
        loop.consecutiveErrors++;
        this._consecutiveErrors = loop.consecutiveErrors;
        this._mineFailures++;
        let backoff = Math.min(CHECK_BLOCK_DELAY_MS * Math.pow(2, loop.consecutiveErrors), MAX_BACKOFF_MS);
        logger.info(
            'There were problems ' +
                what +
                ': ' +
                (err && err.message ? err.message : err) +
                '; retrying in ' +
                backoff +
                'ms.',
        );
        await this.sleep(backoff);
        return false;
    }
}

// Reads the mempool for one pass. Resolves { ok: true, rawMempool }, or after
// extending the error streak and backing off, { ok: false } to skip the pass.
async function readLoopMempool(loop) {
    let rawMempool = null;
    try {
        rawMempool = await this.connector.getRawMempool();
    } catch (error) {
        loop.consecutiveErrors++;
        this._consecutiveErrors = loop.consecutiveErrors;
        let backoff = Math.min(CHECK_BLOCK_DELAY_MS * Math.pow(2, loop.consecutiveErrors), MAX_BACKOFF_MS);
        logger.info(
            'There were problems getting the mempool: ' +
                (error && error.message ? error.message : error) +
                '; retrying in ' +
                backoff +
                'ms.',
        );
        await this.sleep(backoff);
        return { ok: false };
    }
    return { ok: true, rawMempool };
}

// Clears the error streak after a successful pass; a successful mine clears the
// mine-failure count too. runMineLoop calls this synchronously right after the
// helper's await resolves, so the reset shares one synchronous run with the
// mempool bookkeeping and the next RPC that follow it. Done at the end of the
// async helper instead, the reset would sit a turn apart from them, and a
// concurrent flow could observe the counters cleared while the mempool size
// still held the previous pass.
function clearErrorStreak(loop, mined) {
    loop.consecutiveErrors = 0;
    this._consecutiveErrors = 0;
    if (mined) this._mineFailures = 0;
}

// Updates the mempool timers and the exported size from one read. Returns true
// when the mempool is empty, the only state the idle heartbeat may mine in.
function trackMempool(loop, rawMempool) {
    if (rawMempool != null && rawMempool.length > 0) {
        if (rawMempool.length > loop.lastRawMempoolLength) {
            //there are new txs in the mempool
            if (loop.initialStartToMine == 0) {
                loop.initialStartToMine = Date.now();
                loop.extendedStartToMine = loop.initialStartToMine;
            } else {
                loop.extendedStartToMine = Date.now();
            }
        }
        loop.lastRawMempoolLength = rawMempool.length;
        this._mempoolSize = rawMempool.length;
        return false;
    }
    resetMempoolTimers(loop);
    this._mempoolSize = 0;
    return true;
}

// Disarms the pending-tx timers; the next non-empty read re-arms them from now.
function resetMempoolTimers(loop) {
    loop.initialStartToMine = 0;
    loop.extendedStartToMine = 0;
    loop.lastRawMempoolLength = 0;
}

module.exports = { runMineLoop };
