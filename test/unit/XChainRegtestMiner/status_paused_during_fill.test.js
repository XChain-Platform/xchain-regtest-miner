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
 * test/unit/XChainRegtestMiner/status_paused_during_fill.test.js
 *
 * continue_mining can land while fill_mempool runs. It sets keepMining, but
 * the auto-mine loop still cannot mine until the fill ends, so status must keep
 * reporting mining paused and health must name the fill, without the fill
 * hiding a real stall, until the fill is over.
 *
 ********************************************************************/

'use strict';

const assert = require('assert');
const { evaluateMinerHealth, STALL_ERROR_THRESHOLD } = require('../../../src/api');
const { formatMinerHealth } = require('../../../src/api/health');
const XChainRegtestMiner = require('../../../src/XChainRegtestMiner');

const PAST_GRACE_MS = 10 * 60000;

function readyMiner() {
    const miner = new XChainRegtestMiner('bitcoin-regtest', '127.0.0.1', '18443', 'user', 'pass');
    miner.walletReady = true;
    miner.miningStarted = true;
    miner.keepMining = true;
    return miner;
}

function healthOf(miner) {
    const status = miner.getStatus();
    return formatMinerHealth(status, evaluateMinerHealth({ status, uptimeMs: PAST_GRACE_MS }));
}

describe('miner status and health while fill_mempool runs', function () {
    it('reports mining paused after continue_mining lands mid-fill, until the fill ends', async function () {
        const miner = readyMiner();
        miner.fillMempoolRunning = true;
        miner.keepMining = false;
        await miner.continueMining();
        assert.strictEqual(miner.keepMining, true, 'continue_mining set the flag');

        const during = miner.getStatus();
        assert.strictEqual(during.mining_paused, true, 'the loop cannot mine while the fill runs');
        assert.strictEqual(during.fill_running, true);

        miner.fillMempoolRunning = false;
        const after = miner.getStatus();
        assert.strictEqual(after.mining_paused, false);
        assert.strictEqual(after.fill_running, false);
    });

    it('names the fill in health, distinct from an operator pause, and returns to ok after it', function () {
        const miner = readyMiner();
        miner.fillMempoolRunning = true;
        const during = healthOf(miner);
        assert.strictEqual(during.status, 'success');
        assert.strictEqual(during.reason, 'filling');
        assert.strictEqual(during.mining_paused, true);

        miner.fillMempoolRunning = false;
        miner.keepMining = false;
        assert.strictEqual(healthOf(miner).reason, 'paused');

        miner.keepMining = true;
        assert.strictEqual(healthOf(miner).reason, 'ok');
    });
});

describe('miner status and health while fill_mempool runs', function () {
    it('a fill never masks a consecutive error stall', function () {
        const miner = readyMiner();
        miner.fillMempoolRunning = true;
        miner._consecutiveErrors = STALL_ERROR_THRESHOLD;
        const body = healthOf(miner);
        assert.strictEqual(body.status, 'degraded');
        assert.strictEqual(body.reason, 'consecutive_errors');
    });

    it('a fill never masks a mine failure stall, paused or not', function () {
        for (const keepMining of [true, false]) {
            const miner = readyMiner();
            miner.keepMining = keepMining;
            miner.fillMempoolRunning = true;
            miner._mineFailures = STALL_ERROR_THRESHOLD;
            const body = healthOf(miner);
            assert.strictEqual(body.status, 'degraded', 'keepMining=' + keepMining);
            assert.strictEqual(body.reason, 'mine_failures', 'keepMining=' + keepMining);
        }
    });

    it('leaves the health body shape unchanged while no fill runs', function () {
        const body = healthOf(readyMiner());
        assert.deepStrictEqual(Object.keys(body), [
            'status',
            'reason',
            'wallet_ready',
            'consecutive_errors',
            'mine_failures',
            'mining_paused',
            'mining_started',
        ]);
    });
});
