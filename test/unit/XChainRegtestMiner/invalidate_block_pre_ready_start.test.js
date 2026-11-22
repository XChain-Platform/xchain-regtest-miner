// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
//
// An invalidate_block the node refuses while start() is still preparing the
// wallet invalidated nothing, so it must not leave auto-mining switched off:
// start() still turns mining on, whether the call finished before ready or is
// still in flight at ready. An accepted call keeps its pause until
// continue_mining, and an operator pause that landed meanwhile still wins.

const assert = require('assert');
const sinon = require('sinon');
const { evaluateMinerHealth } = require('../../../src/api/health');

const tick = () => new Promise((resolve) => setImmediate(resolve));

let miner;
let realNow;
let sigBefore;

function setupMiner() {
    const XChainRegtestMiner = require('../../../src/XChainRegtestMiner');
    miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass');
    sinon.stub(console, 'log');
    realNow = Date.now;
    sigBefore = { SIGTERM: process.listeners('SIGTERM'), SIGINT: process.listeners('SIGINT') };
}

function teardownMiner() {
    Date.now = realNow;
    for (const sig of ['SIGTERM', 'SIGINT']) {
        for (const listener of process.listeners(sig)) {
            if (!sigBefore[sig].includes(listener)) process.removeListener(sig, listener);
        }
    }
    sinon.restore();
    delete require.cache[require.resolve('../../../src/XChainRegtestMiner')];
}

function parkedPromise() {
    let release;
    const promise = new Promise((resolve) => {
        release = resolve;
    });
    return { promise, release };
}

// Boots start() on virtual time with a wallet preparation the test releases by hand.
async function bootPending() {
    let nowMs = 1e9;
    Date.now = () => nowMs;
    miner.sleep = async (ms) => {
        nowMs += Number(ms) || 0;
        await tick();
    };
    const walletParked = parkedPromise();
    miner.prepareWallet = async function () {
        await walletParked.promise;
        this.walletAddress = 'bcrt1qtest';
        this.walletReady = true;
    };
    const counts = { loopMines: 0 };
    miner.connector.getBalance = async () => 1;
    miner.connector.getRawMempool = async () => ['tx1'];
    miner.connector.generateToAddress = async (count) => {
        counts.loopMines++;
        return Array(count).fill('hash');
    };
    miner.connector.invalidateBlock = async () => null;
    const loop = miner.start();
    await tick();
    return {
        counts,
        async ready() {
            walletParked.release();
            for (let spins = 0; !miner.getStatus().mining_started && spins < 1000; spins++) await tick();
            assert.strictEqual(miner.getStatus().mining_started, true, 'start() must have finished preparation');
        },
        async spin() {
            for (let spins = 0; spins < 600; spins++) await tick();
        },
        async stop() {
            miner._shutdown = true;
            await loop;
        },
    };
}

async function expectStaysPaused(run) {
    await run.spin();
    assert.strictEqual(run.counts.loopMines, 0, 'the loop must not mine under a pause');
    assert.strictEqual(miner.getStatus().mining_paused, true);
    assert.strictEqual(miner.getStatus().mining_started, true);
}

// A fixed count of turns raced a slower CI runner (the loop mined after the spin ended), so
// this waits for the first mine with a wall-clock bound and still fails if none lands.
async function expectMines(run) {
    const deadline = realNow() + 3000;
    while (run.counts.loopMines < 1 && realNow() < deadline) {
        await run.spin();
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(run.counts.loopMines >= 1, 'the loop must be mining');
    assert.strictEqual(miner.getStatus().mining_paused, false);
}

// Starts one invalidate_block per outcome ('accept' or 'refuse'), each node call parked
// until its release runs; `calls[i]` settles to the call's result or its error.
async function startParkedInvalidates(outcomes) {
    const parked = outcomes.map(() => parkedPromise());
    let nextCall = 0;
    miner.connector.invalidateBlock = async () => {
        const index = nextCall++;
        await parked[index].promise;
        if (outcomes[index] === 'refuse') throw new Error('unknown block');
        return null;
    };
    const calls = outcomes.map(() => miner.invalidateBlock('00ab').catch((err) => err));
    for (let spins = 0; nextCall < outcomes.length && spins < 1000; spins++) await tick();
    assert.strictEqual(nextCall, outcomes.length, 'precondition: every invalidate parked at the node');
    return { calls, release: parked.map((entry) => entry.release) };
}

const refuseInvalidate = () => Promise.reject(new Error('unknown block'));

describe('start(): an invalidate_block the node refused before ready', function () {
    beforeEach(setupMiner);
    afterEach(teardownMiner);

    it('starts mining after an invalidate_block the node refused before ready', async function () {
        const run = await bootPending();
        try {
            miner.connector.invalidateBlock = refuseInvalidate;
            const err = await miner.invalidateBlock('00ab').catch((e) => e);
            assert.match(err.message, /unknown block/);
            await run.ready();
            await expectMines(run);
            assert.strictEqual(evaluateMinerHealth({ status: miner.getStatus(), uptimeMs: 6e5 }).reason, 'ok');
        } finally {
            await run.stop();
        }
    });

    it('keeps a pause_mining that landed before a refused invalidate_block', async function () {
        const run = await bootPending();
        try {
            await miner.pauseMining();
            miner.connector.invalidateBlock = refuseInvalidate;
            await miner.invalidateBlock('00ab').catch(() => {});
            await run.ready();
            await expectStaysPaused(run);
        } finally {
            await run.stop();
        }
    });
});

describe('start(): an invalidate_block still in flight at ready', function () {
    beforeEach(setupMiner);
    afterEach(teardownMiner);

    it('keeps the pause of an accepted call until continue_mining', async function () {
        const run = await bootPending();
        const { calls, release } = await startParkedInvalidates(['accept']);
        try {
            await run.ready();
            await run.spin();
            assert.strictEqual(run.counts.loopMines, 0, 'no loop mine may land inside the reorg');
            assert.strictEqual(miner.keepMining, false, 'start() must not switch mining on mid-reorg');
            release[0]();
            await calls[0];
            await expectStaysPaused(run);
            await miner.continueMining();
            await expectMines(run);
        } finally {
            release[0]();
            await run.stop();
        }
    });

    it('starts mining when the call is refused', async function () {
        const run = await bootPending();
        const { calls, release } = await startParkedInvalidates(['refuse']);
        try {
            await run.ready();
            assert.strictEqual(miner.keepMining, false, 'the call is still in flight');
            release[0]();
            assert.match((await calls[0]).message, /unknown block/);
            assert.strictEqual(miner.keepMining, true, 'the last refused call must start mining');
            await expectMines(run);
        } finally {
            release[0]();
            await run.stop();
        }
    });

    it('keeps a pause_mining that landed while a refused call was in flight', async function () {
        const run = await bootPending();
        const { calls, release } = await startParkedInvalidates(['refuse']);
        try {
            await run.ready();
            await miner.pauseMining();
            release[0]();
            await calls[0];
            await expectStaysPaused(run);
        } finally {
            release[0]();
            await run.stop();
        }
    });
});

describe('start(): several invalidate_blocks in flight at ready', function () {
    beforeEach(setupMiner);
    afterEach(teardownMiner);

    it('stays paused when an accepted call is followed by a refused one', async function () {
        const run = await bootPending();
        const { calls, release } = await startParkedInvalidates(['accept', 'refuse']);
        try {
            await run.ready();
            release[0]();
            await calls[0];
            release[1]();
            await calls[1];
            await expectStaysPaused(run);
        } finally {
            release.forEach((fn) => fn());
            await run.stop();
        }
    });

    it('starts mining only after the last of several refused calls', async function () {
        const run = await bootPending();
        const { calls, release } = await startParkedInvalidates(['refuse', 'refuse']);
        try {
            await run.ready();
            release[1]();
            await calls[1];
            assert.strictEqual(miner.keepMining, false, 'one refused call is still in flight');
            release[0]();
            await calls[0];
            await expectMines(run);
        } finally {
            release.forEach((fn) => fn());
            await run.stop();
        }
    });
});
