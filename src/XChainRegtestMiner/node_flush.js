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
 * XChain Regtest Miner - Node Flush
 *
 * Periodic node state flush after an idle block.
 *
 ********************************************************************/

'use strict';

const { NODE_FLUSH_TIMEOUT_MS, logger } = require('./constants.js')

// Forces the node to write its block index to disk, at most once per
// nodeFlushIntervalMs, after an idle block. dogecoind writes the block index only
// hourly, so a hard power-off of the host otherwise drops up to an hour of idle
// blocks, deeper than a decoder's reorg window. Best-effort and never awaited by
// the loop: the call is bounded by NODE_FLUSH_TIMEOUT_MS, a failure is logged once
// per interval, and a slow node cannot delay the next mine. The attempt stamp is
// taken before the call, so a failing or slow flush is not retried inside the
// interval, and an in-flight guard keeps two from overlapping. Only called from
// the idle branch, after its loopMayMine check, so it never runs while paused.
function maybeFlushNode(loop, now){
    const interval = this.nodeFlushIntervalMs
    if (!interval || this._nodeFlushInFlight) return
    if (loop.lastFlushAt == null) loop.lastFlushAt = loop.watchingSince
    if ((now - loop.lastFlushAt) < interval) return
    loop.lastFlushAt = now
    let pending
    try {
        pending = Promise.resolve(this.connector.flushNodeState(NODE_FLUSH_TIMEOUT_MS))
    } catch (err){
        pending = Promise.reject(err)
    }
    this._nodeFlushInFlight = pending.then(() => {
        logger.debug("Flushed the node state to disk")
    }, (err) => {
        logger.info("Node flush failed: "+(err && err.message ? err.message : err)+"; next attempt in "+interval+"ms.")
    }).then(() => { this._nodeFlushInFlight = null })
}

module.exports = { maybeFlushNode }
