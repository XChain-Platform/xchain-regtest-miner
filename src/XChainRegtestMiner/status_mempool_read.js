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
 * XChain Regtest Miner - Status Mempool Read
 *
 * The bounded getrawmempool behind the status method. status needs no API key,
 * and one full getrawmempool per call let a modest flood of status requests cut
 * the node's throughput for every other caller. Reads are shared two ways:
 * callers arriving while a read is in flight await that read, and a read
 * attempted within STATUS_MEMPOOL_FRESHNESS_MS is served again without touching
 * the node, so any flood costs at most one read per window. The auto-mine loop
 * shares the read sequence so an older loop reply cannot replace a newer status
 * result. Plain functions run with the miner as `this`, deliberately not
 * installed on its prototype.
 *
 ********************************************************************/

'use strict';

const { STATUS_MEMPOOL_FRESHNESS_MS } = require('./constants.js');

function initStatusMempoolRead() {
    // Bumped after every mempool change the miner itself makes (a mine, a send, a
    // reorg), so a caller that just made one never gets a read that began before it.
    Reflect.set(this, '_statusMempoolEpoch', 0);
    // The latest read: { seq, epoch, startedAt, inFlight }. startedAt bounds the
    // window from the moment the node was asked, so a served value is never older
    // than the window however long the read took.
    Reflect.set(this, '_statusMempoolRead', null);
    // Shared by status and auto-mine loop reads.
    Reflect.set(this, '_statusMempoolSeq', 0);
    // The seq of the newest status or auto-mine loop read whose result was
    // applied. A read overtaken by a later one must not replace the fresher pair.
    Reflect.set(this, '_statusMempoolAppliedSeq', 0);
}

function claimMempoolReadSeq() {
    const seq = Reflect.get(this, '_statusMempoolSeq') + 1;
    Reflect.set(this, '_statusMempoolSeq', seq);
    return seq;
}

function applyMempoolRead(seq, size, readAt) {
    if (seq <= Reflect.get(this, '_statusMempoolAppliedSeq')) return false;
    Reflect.set(this, '_statusMempoolAppliedSeq', seq);
    Reflect.set(this, '_mempoolSize', size);
    Reflect.set(this, '_mempoolReadAt', readAt === undefined ? Date.now() : readAt);
    return true;
}

// Marks the cached read stale. Called after a mine, a send or a reorg settles.
function noteMempoolChanged() {
    Reflect.set(this, '_statusMempoolEpoch', Reflect.get(this, '_statusMempoolEpoch') + 1);
}

// Refreshes mempool_size for status unless a shared or recent read already
// covers this caller. Never throws: a failed read counts one error, whatever
// number of callers shared it, and leaves the previous size and its timestamp.
function refreshStatusMempool() {
    const last = Reflect.get(this, '_statusMempoolRead');
    if (last && last.epoch === Reflect.get(this, '_statusMempoolEpoch')) {
        if (last.inFlight) return last.inFlight;
        if (Date.now() - last.startedAt < STATUS_MEMPOOL_FRESHNESS_MS) return Promise.resolve();
    }
    const read = {
        seq: claimMempoolReadSeq.call(this),
        epoch: Reflect.get(this, '_statusMempoolEpoch'),
        startedAt: Date.now(),
    };
    Reflect.set(this, '_statusMempoolRead', read);
    // Cleared in a .finally, which always runs on a later turn, so a connector that
    // fails synchronously cannot leave a settled promise parked as the shared read.
    read.inFlight = readMempoolOnce.call(this, read).finally(() => {
        read.inFlight = null;
    });
    return read.inFlight;
}

async function readMempoolOnce(read) {
    try {
        const rawMempool = await this.connector.getRawMempool();
        const size = Array.isArray(rawMempool) ? rawMempool.length : 0;
        if (applyMempoolRead.call(this, read.seq, size)) {
            Reflect.set(this, '_consecutiveErrors', 0);
        }
    } catch (error) {
        Reflect.set(this, '_consecutiveErrors', Reflect.get(this, '_consecutiveErrors') + 1);
    }
}

module.exports = {
    applyMempoolRead,
    claimMempoolReadSeq,
    initStatusMempoolRead,
    noteMempoolChanged,
    refreshStatusMempool,
};
