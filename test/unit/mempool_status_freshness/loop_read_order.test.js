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
 * test/unit/mempool_status_freshness/loop_read_order.test.js
 *
 * The mine loop and status endpoint both observe the mempool. Their results
 * must follow one newest-read-wins order so an older loop reply cannot replace
 * a fresh status count or pair a stale count with a fresh timestamp.
 *
 ********************************************************************/

'use strict';

const assert = require('assert');
const sinon = require('sinon');
const XChainRegtestMiner = require('../../../src/XChainRegtestMiner');
const { runMineLoop } = require('../../../src/XChainRegtestMiner/mine_loop');

function deferred() {
    let resolve;
    const promise = new Promise((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

function loopState() {
    return {
        lastRawMempoolLength: 0,
        initialStartToMine: 0,
        extendedStartToMine: 0,
        consecutiveErrors: 0,
        watchingSince: Date.now(),
    };
}

function testMiner() {
    const pending = [];
    const miner = new XChainRegtestMiner('regtest', '', '', '', '');
    miner.connector = {
        getRawMempool() {
            const read = deferred();
            pending.push(read);
            return read.promise;
        },
        sendToAddress: async () => 'txid',
    };
    miner.walletRefreshDue = () => false;
    miner.idleMineDue = () => false;
    miner.sleep = async () => {
        Reflect.set(miner, '_shutdown', true);
    };
    return { miner, pending };
}

function startOneLoopRead(miner) {
    miner.keepMining = true;
    Reflect.set(miner, '_shutdown', false);
    return runMineLoop.call(miner, loopState());
}

describe('mine loop mempool reads share status ordering', function () {
    let clock;

    beforeEach(function () {
        clock = sinon.useFakeTimers({ now: 1_700_000_000_000, toFake: ['Date'] });
    });

    afterEach(function () {
        clock.restore();
    });

    it('does not let a loop read from before a send replace the fresh status count', async function () {
        const { miner, pending } = testMiner();
        const loop = startOneLoopRead(miner);
        assert.strictEqual(pending.length, 1, 'the loop read started');

        await miner.sendFundsToAddress('bcrt1qexample', 1);
        clock.tick(10);
        const fresh = miner.getFreshStatus();
        assert.strictEqual(pending.length, 2, 'the send forced a status read');
        pending[1].resolve(['new-tx']);
        const status = await fresh;
        assert.strictEqual(status.mempool_size, 1);
        const freshAt = status.mempool_size_at;

        pending[0].resolve([]);
        await loop;
        assert.strictEqual(miner.getStatus().mempool_size, 1);
        assert.strictEqual(miner.getStatus().mempool_size_at, freshAt);
    });

    it('keeps a newer loop result when an older status read finishes last', async function () {
        const { miner, pending } = testMiner();
        const status = miner.getFreshStatus();
        assert.strictEqual(pending.length, 1, 'the status read started');
        const loop = startOneLoopRead(miner);
        assert.strictEqual(pending.length, 2, 'the newer loop read started');

        clock.tick(10);
        pending[1].resolve(['a', 'b']);
        await loop;
        const loopReadAt = Date.now();
        pending[0].resolve(['older']);
        await status;

        assert.strictEqual(miner.getStatus().mempool_size, 2);
        assert.strictEqual(miner.getStatus().mempool_size_at, loopReadAt);
    });

    it('updates the exported count and timestamp when only the loop reads', async function () {
        const { miner, pending } = testMiner();
        const loop = startOneLoopRead(miner);
        clock.tick(10);
        pending[0].resolve(['tx']);
        await loop;

        assert.strictEqual(miner.getStatus().mempool_size, 1);
        assert.strictEqual(miner.getStatus().mempool_size_at, Date.now());
    });
});
