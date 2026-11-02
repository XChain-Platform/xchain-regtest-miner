// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

const assert = require('assert');
const sinon = require('sinon');
const XChainRegtestMiner = require('../../../src/XChainRegtestMiner');
const { STATUS_MEMPOOL_FRESHNESS_MS } = require('../../../src/XChainRegtestMiner/constants');

function newMiner(getRawMempool) {
    const miner = new XChainRegtestMiner('regtest', '127.0.0.1', '18332', 'user', 'pass');
    miner.keepMining = false;
    miner.connector = { getRawMempool };
    return miner;
}

describe('mempool status freshness while the mine loop is idle', function () {
    // status reuses a read for up to STATUS_MEMPOOL_FRESHNESS_MS, so each second
    // call below is made one full window after the first.
    let clock;
    beforeEach(function () {
        clock = sinon.useFakeTimers({ now: 1_700_000_000_000, toFake: ['Date'] });
    });
    afterEach(function () {
        clock.restore();
    });

    it('reads the node after a transaction arrives during the ordinary paused sleep', async function () {
        let rawMempool = [];
        const miner = newMiner(async () => rawMempool);
        const before = await miner.getFreshStatus();
        assert.strictEqual(before.mempool_size, 0);

        rawMempool = ['broadcast-during-sleep'];
        clock.tick(STATUS_MEMPOOL_FRESHNESS_MS);
        const after = await miner.getFreshStatus();
        assert.strictEqual(after.mempool_size, 1);
        assert.ok(after.mempool_size_at >= before.mempool_size_at);
        assert.strictEqual(after.mining_paused, true);
    });

    it('marks an on-demand read failure stale without replacing the prior size', async function () {
        let fail = false;
        const miner = newMiner(async () => {
            if (fail) throw new Error('node unavailable');
            return ['tx1', 'tx2'];
        });
        assert.strictEqual((await miner.getFreshStatus()).mempool_size, 2);
        fail = true;
        clock.tick(STATUS_MEMPOOL_FRESHNESS_MS);
        const status = await miner.getFreshStatus();
        assert.strictEqual(status.mempool_size, 2);
        assert.strictEqual(status.consecutive_errors, 1);
    });
});
