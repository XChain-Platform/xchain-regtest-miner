// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

const assert = require('assert');
const XChainRegtestMiner = require('../../../src/XChainRegtestMiner');

function newMiner(getRawMempool) {
    const miner = new XChainRegtestMiner('regtest', '127.0.0.1', '18332', 'user', 'pass');
    miner.keepMining = false;
    miner.connector = { getRawMempool };
    return miner;
}

describe('mempool status freshness while the mine loop is idle', function () {
    it('reads the node after a transaction arrives during the ordinary paused sleep', async function () {
        let rawMempool = [];
        const miner = newMiner(async () => rawMempool);
        const before = await miner.getFreshStatus();
        assert.strictEqual(before.mempool_size, 0);

        rawMempool = ['broadcast-during-sleep'];
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
        const status = await miner.getFreshStatus();
        assert.strictEqual(status.mempool_size, 2);
        assert.strictEqual(status.consecutive_errors, 1);
    });
});
