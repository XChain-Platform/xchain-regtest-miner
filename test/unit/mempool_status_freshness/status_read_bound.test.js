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
 * test/unit/mempool_status_freshness/status_read_bound.test.js
 *
 * status needs no API key and refreshes mempool_size from the node. One full
 * getrawmempool per call let a modest flood cut the node's throughput for
 * every other caller. Concurrent callers must share one read, sequential
 * callers inside the freshness window must not read again, and no caller may
 * get a size older than the window or older than a mine, send or reorg this
 * miner finished before the call.
 *
 ********************************************************************/

'use strict';

const assert = require('assert');
const sinon = require('sinon');
const XChainRegtestMiner = require('../../../src/XChainRegtestMiner');
const { STATUS_MEMPOOL_FRESHNESS_MS } = require('../../../src/XChainRegtestMiner/constants');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function newMiner(getRawMempool) {
    const miner = new XChainRegtestMiner('regtest', '127.0.0.1', '18332', 'user', 'pass');
    miner.keepMining = false;
    miner.connector = { getRawMempool };
    return miner;
}

const turn = () => new Promise((resolve) => setImmediate(resolve));

// Fakes only Date, so the reads settle through real promise turns while the
// window is stepped by hand. Returns a getter for the clock of the running test.
function useFakeDate() {
    let clock;
    beforeEach(function () {
        clock = sinon.useFakeTimers({ now: 1_700_000_000_000, toFake: ['Date'] });
    });
    afterEach(function () {
        clock.restore();
    });
    return () => clock;
}

// A miner whose connector also mines, sends and reorgs, all as no-ops.
function writableMiner(getRawMempool) {
    const miner = newMiner(getRawMempool);
    miner.connector.generateToAddress = async (n) => new Array(n).fill('hash');
    miner.connector.getBlockchainInfo = async () => ({ blocks: 1 });
    miner.connector.sendToAddress = async () => 'txid';
    miner.connector.invalidateBlock = async () => null;
    miner.connector.getBalance = async () => 10;
    miner.walletReady = true;
    miner.walletAddress = 'bcrt1qexample';
    return miner;
}

describe('status mempool read is bounded under a flood', function () {
    const clockOf = useFakeDate();

    it('keeps the window short and documented', function () {
        assert.ok(Number.isInteger(STATUS_MEMPOOL_FRESHNESS_MS));
        assert.ok(STATUS_MEMPOOL_FRESHNESS_MS > 0 && STATUS_MEMPOOL_FRESHNESS_MS <= 1000);
    });

    it('serves 50 concurrent status calls from one getrawmempool', async function () {
        const pending = [];
        const miner = newMiner(() => {
            const d = deferred();
            pending.push(d);
            return d.promise;
        });
        const statuses = Array.from({ length: 50 }, () => miner.getFreshStatus());
        await turn();
        assert.strictEqual(pending.length, 1);
        pending[0].resolve(['a', 'b', 'c']);
        const results = await Promise.all(statuses);
        assert.strictEqual(pending.length, 1);
        for (const status of results) assert.strictEqual(status.mempool_size, 3);
    });

    it('reads at most once per window under a sequential flood', async function () {
        const clock = clockOf();
        let calls = 0;
        const miner = newMiner(async () => {
            calls++;
            return new Array(calls).fill('tx');
        });
        for (let i = 0; i < 100; i++) await miner.getFreshStatus();
        assert.strictEqual(calls, 1);

        clock.tick(STATUS_MEMPOOL_FRESHNESS_MS - 1);
        const inside = await miner.getFreshStatus();
        assert.strictEqual(calls, 1);
        assert.strictEqual(inside.mempool_size, 1);

        clock.tick(1);
        for (let i = 0; i < 100; i++) await miner.getFreshStatus();
        assert.strictEqual(calls, 2);
        assert.strictEqual((await miner.getFreshStatus()).mempool_size, 2);
    });
});

describe('status mempool read stays inside its window', function () {
    const clockOf = useFakeDate();

    it('never serves a size from a read that started more than one window ago', async function () {
        const clock = clockOf();
        const pending = [];
        const miner = newMiner(() => {
            const d = deferred();
            pending.push(d);
            return d.promise;
        });
        const first = miner.getFreshStatus();
        await turn();
        // A slow node: the read settles a full window after it was sent.
        clock.tick(STATUS_MEMPOOL_FRESHNESS_MS);
        pending[0].resolve(['old']);
        await first;

        const next = miner.getFreshStatus();
        await turn();
        assert.strictEqual(pending.length, 2, 'a read as old as the window is not served again');
        pending[1].resolve(['new', 'new']);
        assert.strictEqual((await next).mempool_size, 2);
    });

    it('bounds a failing node the same way and counts each shared failure once', async function () {
        const clock = clockOf();
        let calls = 0;
        const miner = newMiner(async () => {
            calls++;
            throw new Error('node unavailable');
        });
        const results = await Promise.all(Array.from({ length: 10 }, () => miner.getFreshStatus()));
        for (let i = 0; i < 10; i++) await miner.getFreshStatus();
        assert.strictEqual(calls, 1);
        for (const status of results) assert.strictEqual(status.consecutive_errors, 1);
        assert.strictEqual(results[0].mempool_size_at, null, 'a failed read stamps no read time');

        clock.tick(STATUS_MEMPOOL_FRESHNESS_MS);
        assert.strictEqual((await miner.getFreshStatus()).consecutive_errors, 2);
        assert.strictEqual(calls, 2);
    });
});

describe('status mempool read after this miner changes the mempool', function () {
    useFakeDate();

    it('reads again inside the window after a mine, a send or a reorg by this miner', async function () {
        let size = 3;
        let calls = 0;
        const miner = writableMiner(async () => {
            calls++;
            return new Array(size).fill('tx');
        });

        assert.strictEqual((await miner.getFreshStatus()).mempool_size, 3);

        size = 0;
        await miner.generateBlocks(1);
        assert.strictEqual((await miner.getFreshStatus()).mempool_size, 0, 'a mine is never hidden by the window');

        size = 1;
        await miner.sendFundsToAddress('bcrt1qexample', 1);
        assert.strictEqual((await miner.getFreshStatus()).mempool_size, 1, 'a send is never hidden by the window');

        size = 4;
        await miner.invalidateBlock('00'.repeat(32));
        assert.strictEqual((await miner.getFreshStatus()).mempool_size, 4, 'a reorg is never hidden by the window');
        assert.strictEqual(calls, 4);
    });

    it('does not join a read that began before the caller finished a mine', async function () {
        const pending = [];
        const miner = writableMiner(() => {
            const d = deferred();
            pending.push(d);
            return d.promise;
        });

        const before = miner.getFreshStatus();
        await turn();
        await miner.generateBlocks(1);
        const after = miner.getFreshStatus();
        await turn();
        assert.strictEqual(pending.length, 2, 'the caller after the mine gets its own read');

        pending[1].resolve([]);
        assert.strictEqual((await after).mempool_size, 0);
        // The older read lands last and must not overwrite the newer size.
        pending[0].resolve(['mined-already']);
        await before;
        assert.strictEqual(miner.getStatus().mempool_size, 0);
    });
});
