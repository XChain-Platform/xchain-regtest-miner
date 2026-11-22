// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

'use strict';

const assert = require('assert');
const sinon = require('sinon');
const XChainRegtestMiner = require('../../../src/XChainRegtestMiner');
const {
    MINE_SETTLE_QUIET_READS: QUIET_READS,
    MINE_SETTLE_DEADLINE_MS,
    MINE_SETTLE_POLL_MS,
} = require('../../../src/XChainRegtestMiner/constants.js');

const HASH = '00'.repeat(32);
const blindMiners = [];

function uncertain(message, property) {
    const err = new Error(message);
    err[property] = true;
    return err;
}

function fixture(method, property) {
    const miner = new XChainRegtestMiner('regtest', undefined, '18332', 'user', 'pass');
    const active = new Set([method]);
    let overlap = 0;
    miner.walletAddress = 'address';
    miner.refreshWalletFunds = async () => {};
    miner.connector = {
        invalidateBlock: async () => {
            throw uncertain('invalidate uncertain', property);
        },
        reconsiderBlock: async () => {
            throw uncertain('reconsider uncertain', property);
        },
        getRpcInfo: async () => ({ active_commands: Array.from(active, (name) => ({ method: name })) }),
        getBlockchainInfo: async () => ({ blocks: 100 }),
        generateToAddress: async () => {
            if (active.size) overlap++;
            return ['hash'];
        },
    };
    sinon.stub(miner, 'sleep').callsFake(async () => active.clear());
    return { miner, active, overlap: () => overlap };
}

// A daemon without getrpcinfo (the read throws) whose reorg RPC timed out and
// keeps the height still at 100 while it may still run.
function blindNode(method) {
    const miner = new XChainRegtestMiner('regtest', undefined, '18332', 'user', 'pass');
    blindMiners.push(miner);
    let generateCalls = 0;
    let sleeps = 0;
    let waiters = [];
    miner.walletAddress = 'address';
    miner.refreshWalletFunds = async () => {};
    miner.connector = {
        invalidateBlock: async () => {
            throw uncertain(method + ' uncertain', 'timedOut');
        },
        reconsiderBlock: async () => {
            throw uncertain(method + ' uncertain', 'timedOut');
        },
        getRpcInfo: async () => {
            throw new Error('Error getting RPC info');
        },
        getBlockchainInfo: async () => ({ blocks: 100 }),
        generateToAddress: async () => {
            generateCalls++;
            return ['hash'];
        },
    };
    sinon.stub(miner, 'sleep').callsFake(async () => {
        sleeps++;
        for (const waiter of waiters) if (sleeps >= waiter.at) waiter.resolve();
        waiters = waiters.filter((waiter) => sleeps < waiter.at);
    });
    const probeReads = (count) => new Promise((resolve) => waiters.push({ at: sleeps + count, resolve }));
    return { miner, generateCalls: () => generateCalls, probeReads };
}

function registerHooks() {
    beforeEach(function () {
        sinon.stub(console, 'log');
        sinon.stub(console, 'warn');
        sinon.stub(console, 'error');
    });

    afterEach(function () {
        // Ends any settlement probe a latched miner left polling.
        for (const miner of blindMiners.splice(0)) miner._shutdown = true;
        sinon.restore();
    });
}

describe('uncertain reorg RPC settlement', function () {
    registerHooks();

    for (const test of [
        { verb: 'invalidateBlock', method: 'invalidateblock', property: 'timedOut' },
        { verb: 'reconsiderBlock', method: 'reconsiderblock', property: 'executionUncertain' },
    ]) {
        it('holds a queued mine until ' + test.method + ' is no longer active', async function () {
            const { miner, overlap } = fixture(test.method, test.property);
            const reorg = miner[test.verb](HASH).catch((err) => err);
            const mine = miner.generateBlocks(1);
            const error = await reorg;
            await mine;

            assert.strictEqual(error[test.property], true);
            assert.strictEqual(overlap(), 0);
            assert.ok(miner.sleep.called);
            assert.strictEqual(miner._reorgMineHolds.size, 0);
        });
    }

    it('keeps a queued mine out while getrpcinfo lists the reorg past the quiet window', async function () {
        const { miner, active, overlap } = fixture('invalidateblock', 'timedOut');
        let sleeps = 0;
        miner.sleep.callsFake(async () => {
            sleeps++;
            if (sleeps === QUIET_READS + 30) active.clear();
        });
        const reorg = miner.invalidateBlock(HASH).catch((err) => err);
        const mine = miner.generateBlocks(1);
        assert.strictEqual((await reorg).timedOut, true);
        assert.deepStrictEqual(await mine, ['hash']);
        assert.strictEqual(overlap(), 0);
        assert.ok(sleeps >= QUIET_READS + 30);
    });

    it('releases immediately after a definite refusal', async function () {
        const { miner } = fixture('invalidateblock', 'timedOut');
        miner.connector.invalidateBlock = async () => {
            throw new Error('definite refusal');
        };
        await assert.rejects(miner.invalidateBlock(HASH), /definite refusal/);
        assert.strictEqual(miner.sleep.called, false);
        assert.deepStrictEqual(await miner.generateBlocks(1), ['hash']);
    });
});

describe('uncertain invalidate outcome pause @regression', function () {
    registerHooks();

    it('keeps mining paused when the target block is no longer active', async function () {
        const { miner } = fixture('invalidateblock', 'timedOut');
        miner.setKeepMining(true);

        await assert.rejects(miner.invalidateBlock(HASH), (err) => err.timedOut === true);

        assert.strictEqual(miner.keepMining, false);
    });

    it('keeps mining paused even when the target block would still look active', async function () {
        const { miner } = fixture('invalidateblock', 'executionUncertain');
        miner.connector.getBlock = sinon.stub().resolves({ confirmations: 1 });
        miner.setKeepMining(true);

        await assert.rejects(miner.invalidateBlock(HASH), (err) => err.executionUncertain === true);

        assert.strictEqual(miner.connector.getBlock.called, false);
        assert.strictEqual(miner.keepMining, false);
    });
});

describe('uncertain reorg RPC settlement without getrpcinfo', function () {
    registerHooks();

    for (const test of [
        { verb: 'invalidateBlock', method: 'invalidateblock' },
        { verb: 'reconsiderBlock', method: 'reconsiderblock' },
    ]) {
        it('latches rather than trusting a still height for ' + test.method, async function () {
            const { miner, generateCalls, probeReads } = blindNode(test.method);
            const reorg = miner[test.verb](HASH).catch((err) => err);
            const mine = miner.generateBlocks(1).catch((err) => err);
            assert.strictEqual((await reorg).timedOut, true);
            assert.strictEqual((await mine).mineUnsettled, true);
            assert.strictEqual(generateCalls(), 0);
            assert.ok(miner.getStatus().mine_unsettled);
            assert.strictEqual(miner._reorgMineHolds.size, 0);

            await Promise.race([probeReads(QUIET_READS + 10), miner._mineSettleProbe]);
            assert.ok(miner.getStatus().mine_unsettled);
            await assert.rejects(miner.generateBlocks(1), (err) => err.mineUnsettled === true);
            assert.strictEqual(generateCalls(), 0);
        });
    }

    it('still settles a timed-out mine on a still height', async function () {
        const { miner } = blindNode('invalidateblock');
        miner.connector.generateToAddress = async () => {
            throw uncertain('mine uncertain', 'timedOut');
        };
        await assert.rejects(miner.generateBlocks(1), (err) => err.timedOut === true);
        assert.strictEqual(miner.getStatus().mine_unsettled, null);
        assert.ok(miner.sleep.callCount >= QUIET_READS - 1);
    });
});

describe('uncertain reorg RPC deadline latch', function () {
    registerHooks();

    it('keeps the latch until getrpcinfo stops listing the reorg', async function () {
        const clock = sinon.useFakeTimers({ now: 1000, toFake: ['Date'] });
        const { miner, active, overlap } = fixture('invalidateblock', 'timedOut');
        blindMiners.push(miner);
        const generate = sinon.spy(miner.connector, 'generateToAddress');
        // Settling runs to the deadline, then the probe polls well past the quiet window.
        const flipAt = MINE_SETTLE_DEADLINE_MS / MINE_SETTLE_POLL_MS + QUIET_READS + 10;
        miner.sleep.callsFake(async (ms) => {
            clock.tick(ms);
            if (miner.sleep.callCount >= flipAt) active.clear();
        });
        const reorg = miner.invalidateBlock(HASH).catch((err) => err);
        const mine = miner.generateBlocks(1).catch((err) => err);
        assert.strictEqual((await reorg).timedOut, true);
        assert.strictEqual((await mine).mineUnsettled, true);
        assert.strictEqual(generate.callCount, 0);
        assert.ok(miner.getStatus().mine_unsettled);

        await miner._mineSettleProbe;
        assert.ok(miner.sleep.callCount >= flipAt);
        assert.strictEqual(miner.getStatus().mine_unsettled, null);
        assert.deepStrictEqual(await miner.generateBlocks(1), ['hash']);
        assert.strictEqual(overlap(), 0);
    });
});
