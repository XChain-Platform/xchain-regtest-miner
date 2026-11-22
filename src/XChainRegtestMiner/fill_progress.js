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
 * XChain Regtest Miner - Fill Progress
 *
 * The progress record and cancel points of a fill_mempool run. A fill is a
 * long serial broadcast whose sendrawtransaction calls slow as the node's
 * mempool grows, so a run at the 50000 cap holds mining off for well over half
 * an hour; this is what lets an operator watch it through status and stop it
 * through cancel_fill_mempool. Plain functions run with the miner as `this`,
 * deliberately not installed on its prototype.
 *
 ********************************************************************/

'use strict';

// Opens the record for a run that has just claimed the fill mutex. Resetting the
// cancel flag here, in the same synchronous step as the claim, means a cancel
// aimed at an earlier run can never abort this one.
function startFillProgress(txQuantity) {
    this._fillCancelRequested = false;
    this._fillProgress = {
        phase: 'starting',
        requested: txQuantity,
        sent: 0,
        started_at: Date.now(),
        finished_at: null,
        error: null,
    };
}

// A cancel point: throws a `cancelled` error once cancel_fill_mempool has asked
// the run to stop. Every fill loop calls this before its next node RPC, so a run
// ends after at most the call already in flight.
function throwIfFillCancelled() {
    if (!this._fillCancelRequested) return;
    const progress = this._fillProgress || {};
    const err = new Error(
        'fill_mempool cancelled during ' +
            progress.phase +
            ' after ' +
            (progress.sent || 0) +
            ' of ' +
            progress.requested +
            ' stress transactions',
    );
    err.cancelled = true;
    err.sent = progress.sent || 0;
    err.requested = progress.requested;
    throw err;
}

// Moves the run to its next phase, which is also a cancel point.
function enterFillPhase(phase) {
    throwIfFillCancelled.call(this);
    if (this._fillProgress) this._fillProgress.phase = phase;
}

// Counts one broadcast stress transaction.
function noteStressSent() {
    if (this._fillProgress) this._fillProgress.sent++;
}

// Closes the record when the run settles: done, cancelled or failed.
function finishFillProgress(err) {
    const progress = this._fillProgress;
    if (!progress) return;
    if (err) {
        progress.phase = err.cancelled ? 'cancelled' : 'failed';
        progress.error = err.message ? err.message : String(err);
    } else {
        progress.phase = 'done';
    }
    progress.finished_at = Date.now();
}

// The current or last run as status reports it, null when no fill has run since
// boot. `running` reads the mutex itself, so it is right even for a run that
// claimed the mutex without opening a record.
function fillProgressSnapshot() {
    if (!this._fillProgress) return null;
    return {
        ...this._fillProgress,
        running: this.fillMempoolRunning === true,
        cancel_requested: this._fillCancelRequested === true,
    };
}

module.exports = {
    startFillProgress,
    throwIfFillCancelled,
    enterFillPhase,
    noteStressSent,
    finishFillProgress,
    fillProgressSnapshot,
};
