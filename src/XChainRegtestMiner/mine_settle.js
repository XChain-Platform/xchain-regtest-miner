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

const {
    MINE_SETTLE_POLL_MS,
    MINE_SETTLE_QUIET_READS,
    MINE_SETTLE_DEADLINE_MS,
    logger
} = require('./constants.js')

// The node's current height, or null when it cannot be read.
async function readNodeHeight(){
    try {
        const info = await this.connector.getBlockchainInfo()
        return info && Number.isInteger(info.blocks) ? info.blocks : null
    } catch (err) {
        return null
    }
}

// Wait until the node's height holds still for MINE_SETTLE_QUIET_READS reads, or
// the deadline passes. A failed read counts as unsettled and never extends it.
async function settleAfterMineTimeout(){
    const deadline = Date.now() + MINE_SETTLE_DEADLINE_MS
    let last = null
    let quiet = 0
    while (Date.now() < deadline) {
        const height = await readNodeHeight.call(this)
        quiet = (height !== null && height === last) ? quiet + 1 : 0
        if (height !== null) last = height
        if (quiet >= MINE_SETTLE_QUIET_READS - 1) {
            logger.warn('generatetoaddress timed out; the node stopped mining at height ' + last)
            return
        }
        await this.sleep(MINE_SETTLE_POLL_MS)
    }
    logger.error('generatetoaddress timed out and the node height never settled; releasing the mine queue while the node may still be mining')
}

module.exports = { settleAfterMineTimeout }
