// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

'use strict';

const assert = require('assert');
const sinon = require('sinon');
const { evaluateMinerHealth } = require('../../../src/api/health.js');
const { MINE_SETTLE_DEADLINE_MS } = require('../../../src/XChainRegtestMiner/constants.js');

function activeMine(miner, clock) {
    const state = { active: true, generateCalls: 0 };
    miner.walletAddress = 'bcrt1qtest';
    miner.connector = {
        generateToAddress: async () => {
            state.generateCalls++;
            const err = new Error('Error generating to address');
            err.timedOut = true;
            throw err;
        },
        getBlockchainInfo: async () => ({ blocks: 100 }),
        getRpcInfo: async () => ({
            active_commands: state.active ? [{ method: 'generatetoaddress' }] : [],
        }),
        reconsiderBlock: sinon.stub().resolves(),
    };
    miner.sleep = async (ms) => clock.tick(ms);
    return state;
}

describe('mine settlement deadline latch', function () {
    let miner;
    let clock;

    beforeEach(function () {
        const XChainRegtestMiner = require('../../../src/XChainRegtestMiner');
        miner = new XChainRegtestMiner('regtest', '', '18332', 'user', 'pass');
        clock = sinon.useFakeTimers({ now: 1000, toFake: ['Date'] });
        sinon.stub(console, 'log');
        sinon.stub(console, 'warn');
        sinon.stub(console, 'error');
    });

    afterEach(function () {
        miner._shutdown = true;
        sinon.restore();
        delete require.cache[require.resolve('../../../src/XChainRegtestMiner')];
    });

    it('refuses every dependent control while getrpcinfo reports an active mine', async function () {
        const state = activeMine(miner, clock);
        const mineError = await miner.generateBlocksQueued(3).catch((err) => err);
        assert.strictEqual(mineError.timedOut, true);
        assert.ok(Date.now() - 1000 >= MINE_SETTLE_DEADLINE_MS);

        await assert.rejects(miner.pauseMining(), (err) => err.mineUnsettled === true);
        await assert.rejects(miner.reconsiderBlock('ab'.repeat(32)), (err) => err.mineUnsettled === true);
        await assert.rejects(miner.generateBlocksQueued(1), (err) => err.mineUnsettled === true);
        await assert.rejects(miner.fillMempool(1), (err) => err.mineUnsettled === true);
        assert.strictEqual(state.generateCalls, 1);
        assert.strictEqual(miner.connector.reconsiderBlock.callCount, 0);
        assert.ok(miner.getStatus().mine_unsettled);
    });

    it('clears the latch after the node reports that the mine stopped', async function () {
        const state = activeMine(miner, clock);
        await miner.generateBlocksQueued(3).catch(() => null);
        assert.ok(miner.getStatus().mine_unsettled);

        state.active = false;
        await miner._mineSettleProbe;
        assert.strictEqual(miner.getStatus().mine_unsettled, null);
        await miner.pauseMining();
    });

    it('reports an unsettled paused miner as unhealthy', function () {
        miner.walletReady = true;
        miner.miningStarted = true;
        miner.keepMining = false;
        miner._mineUnsettled = { since: Date.now(), lastHeight: 100 };

        const verdict = evaluateMinerHealth({ status: miner.getStatus(), uptimeMs: 120000 });
        assert.deepStrictEqual(verdict, { healthy: false, reason: 'mine_unsettled' });
    });
});
