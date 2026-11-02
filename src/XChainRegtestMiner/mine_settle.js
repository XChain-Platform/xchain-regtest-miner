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
 * XChain Regtest Miner - Mine Settle
 *
 * Holds a timed-out mine's queue slot until the node stops mining, since the
 * node keeps generating blocks after the client gives up on generatetoaddress.
 *
 ********************************************************************/

'use strict';

const { MINE_SETTLE_POLL_MS, MINE_SETTLE_QUIET_READS, MINE_SETTLE_DEADLINE_MS, logger } = require('./constants.js');

// The node's current height, or null when it cannot be read.
async function readNodeHeight() {
    try {
        const info = await this.connector.getBlockchainInfo();
        return info && Number.isInteger(info.blocks) ? info.blocks : null;
    } catch (err) {
        return null;
    }
}

// Whether the node is still running a generatetoaddress: true or false from
// getrpcinfo's active_commands, null when that is unknown (no getrpcinfo on this
// daemon, or the read failed).
async function readMineActive() {
    if (typeof this.connector.getRpcInfo !== 'function') return null;
    try {
        const info = await this.connector.getRpcInfo();
        if (!info || !Array.isArray(info.active_commands)) return null;
        return info.active_commands.some((cmd) => cmd && cmd.method === 'generatetoaddress');
    } catch (err) {
        return null;
    }
}

// Wait until the node stops mining, or the deadline passes. Where getrpcinfo
// answers, the node has stopped once no generatetoaddress is active, and the
// height read after that is the settled one. Where it cannot answer, the height
// must hold still for MINE_SETTLE_QUIET_READS reads; that window has to outlast
// the node's own gaps between blocks, or the hold ends mid-call. A failed read
// counts as unsettled and never extends the deadline. Resolves to the settled
// height, or null at the deadline: the last read there is only a lower bound
// while the node may still be mining.
async function settleAfterMineTimeout() {
    const deadline = Date.now() + MINE_SETTLE_DEADLINE_MS;
    let last = null;
    let quiet = 0;
    while (Date.now() < deadline) {
        const active = await readMineActive.call(this);
        const height = await readNodeHeight.call(this);
        if (active === false && height !== null) {
            logger.warn('generatetoaddress timed out; the node stopped mining at height ' + height);
            return height;
        }
        quiet = active === null && height !== null && height === last ? quiet + 1 : 0;
        if (height !== null) last = height;
        if (quiet >= MINE_SETTLE_QUIET_READS - 1) {
            logger.warn('generatetoaddress timed out; the node stopped mining at height ' + last);
            return last;
        }
        await this.sleep(MINE_SETTLE_POLL_MS);
    }
    logger.error(
        'generatetoaddress timed out and the node height never settled; releasing the mine queue while the node may still be mining',
    );
    return null;
}

module.exports = { readNodeHeight, settleAfterMineTimeout };
