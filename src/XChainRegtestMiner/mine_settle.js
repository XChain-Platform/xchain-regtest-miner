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
 * Holds a failed mine's queue slot until the node stops mining when execution
 * may have started before the client lost the response.
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
async function readMineActive(methods = ['generatetoaddress']) {
    if (typeof this.connector.getRpcInfo !== 'function') return null;
    try {
        const info = await this.connector.getRpcInfo();
        if (!info || !Array.isArray(info.active_commands)) return null;
        return info.active_commands.some((cmd) => cmd && methods.includes(cmd.method));
    } catch (err) {
        return null;
    }
}

// A running mine moves the height, so a height that holds still shows it stopped.
// A reorg RPC can hold the height still while it runs (a long disconnect step, or
// a fork of equal length), so only getrpcinfo can show that one stopped.
function stillHeightSettles(methods) {
    return methods.every((name) => name === 'generatetoaddress');
}

function mineUnsettledError(methods = ['generatetoaddress']) {
    const names = methods.join(', ');
    const err = new Error('a failed ' + names + ' may still be running; mining controls are refused until it stops');
    err.mineUnsettled = true;
    return err;
}

function assertMineSettled() {
    if (this._mineUnsettled) throw mineUnsettledError(this._mineUnsettled.methods || ['generatetoaddress']);
}

function clearMineUnsettled(height) {
    const names = (this._mineUnsettled.methods || ['generatetoaddress']).join(', ');
    this._mineUnsettled = null;
    logger.warn(names + ' finished after the settlement deadline at height ' + height);
}

async function probeUnsettledMine() {
    await new Promise((resolve) => setImmediate(resolve));
    let last = this._mineUnsettled ? this._mineUnsettled.lastHeight : null;
    let quiet = 0;
    while (this._mineUnsettled && !this._shutdown) {
        await this.sleep(MINE_SETTLE_POLL_MS);
        await new Promise((resolve) => setImmediate(resolve));
        const methods = this._mineUnsettled.methods || ['generatetoaddress'];
        const active = await readMineActive.call(this, methods);
        const height = await readNodeHeight.call(this);
        if (active === false && height !== null) {
            clearMineUnsettled.call(this, height);
            return;
        }
        quiet = active === null && height !== null && height === last ? quiet + 1 : 0;
        if (height !== null) {
            last = height;
            this._mineUnsettled.lastHeight = height;
        }
        if (quiet >= MINE_SETTLE_QUIET_READS - 1 && stillHeightSettles(methods)) {
            clearMineUnsettled.call(this, last);
            return;
        }
    }
}

function latchMineUnsettled(lastHeight, method = 'generatetoaddress') {
    if (!this._mineUnsettled) {
        this._mineUnsettled = { since: Date.now(), lastHeight, methods: [method] };
    } else if (!this._mineUnsettled.methods) {
        this._mineUnsettled.methods = ['generatetoaddress', method].filter(
            (value, index, all) => all.indexOf(value) === index,
        );
    } else if (!this._mineUnsettled.methods.includes(method)) {
        this._mineUnsettled.methods.push(method);
    }
    if (this._mineSettleProbe) return;
    const probe = probeUnsettledMine.call(this);
    this._mineSettleProbe = probe;
    probe
        .catch((err) => logger.error('mine settlement probe failed: ' + err.message))
        .finally(() => {
            if (this._mineSettleProbe === probe) this._mineSettleProbe = null;
        });
}

// Wait until the node stops mining, or the deadline passes. Where getrpcinfo
// answers, the node has stopped once no generatetoaddress is active, and the
// height read after that is the settled one. Where it cannot answer, the height
// must hold still for MINE_SETTLE_QUIET_READS reads; that window has to outlast
// the node's own gaps between blocks, or the hold ends mid-call. A failed read
// counts as unsettled and never extends the deadline. Resolves to the settled
// height, or null at the deadline: the last read there is only a lower bound
// while the node may still be mining. A reorg RPC never settles on a still
// height: once the quiet window passes with getrpcinfo unable to answer, it
// latches at once instead of holding the caller to the deadline.
async function settleAfterMineTimeout(method = 'generatetoaddress') {
    const deadline = Date.now() + MINE_SETTLE_DEADLINE_MS;
    let last = null;
    let quiet = 0;
    let blind = false;
    while (Date.now() < deadline) {
        const active = await readMineActive.call(this, [method]);
        const height = await readNodeHeight.call(this);
        if (active === false && height !== null) {
            logger.warn(method + ' failed with an uncertain outcome; the node operation stopped at height ' + height);
            return height;
        }
        quiet = active === null && height !== null && height === last ? quiet + 1 : 0;
        if (height !== null) last = height;
        if (quiet >= MINE_SETTLE_QUIET_READS - 1) {
            blind = !stillHeightSettles([method]);
            if (blind) break;
            logger.warn(method + ' failed with an uncertain outcome; the node operation stopped at height ' + last);
            return last;
        }
        await this.sleep(MINE_SETTLE_POLL_MS);
    }
    latchMineUnsettled.call(this, last, method);
    const why = blind ? ' cannot be shown stopped without getrpcinfo' : ' did not settle before the deadline';
    const until = blind ? ' until getrpcinfo shows it idle or the miner restarts' : '';
    logger.error(method + why + '; mining controls are now refused' + until);
    return null;
}

module.exports = { assertMineSettled, readNodeHeight, settleAfterMineTimeout };
