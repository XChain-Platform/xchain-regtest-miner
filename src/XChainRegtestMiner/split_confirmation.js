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
 * XChain Regtest Miner - Split Confirmation
 *
 * Confirms every fill_mempool split tx before the stress loop spends it.
 *
 ********************************************************************/

'use strict';

const { logger } = require('./constants.js')

// Mines through the fill's private queue until no split tx is left in the mempool.
// (A 50000 fill is 20 splits of ~85 KB, more than one default block holds; a child
// of an unconfirmed split hits the node's descendant limit after a few dozen.)
async function confirmSplitTxs(utxos){
    const splitTxids = utxos.map((u) => u.txIdSource)
    const maxMines = utxos.length + 1
    for (let mines = 1; ; mines++) {
        await this.generateBlocksQueued(1)
        const inMempool = new Set(await this.connector.getRawMempool())
        const pending = splitTxids.filter((id) => inMempool.has(id))
        if (pending.length === 0) return mines
        // Stop at the cap: every block fits at least one split, so a miss means the node is not confirming them.
        if (mines >= maxMines) {
            throw new Error('fill_mempool: ' + pending.length + ' split transaction(s) still unconfirmed after ' + mines + ' blocks')
        }
        logger.info(pending.length + ' split transaction(s) still unconfirmed after ' + mines + ' block(s); mining another')
    }
}

module.exports = { confirmSplitTxs }
