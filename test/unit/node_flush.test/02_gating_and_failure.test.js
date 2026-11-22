// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.
//
//
// Companion to the cadence tests: the pause gate, the disable switch and the
// best-effort contract (a failing or slow flush never stalls mining).

const assert = require('assert');
const { useFlushHarness } = require('../../helpers/node_flush_harness');

describe('XChainRegtestMiner node flush gating and failure handling', function () {
    const h = useFlushHarness();

    it('does not flush while mining is paused', async function () {
        h.miner.keepMining = false;
        // start() sets keepMining true; pause again on the first pass.
        await h.runLoop(40, async (n) => {
            if (n === 1) await h.miner.pauseMining();
        });
        assert.strictEqual(h.flush.callCount, 0);
    });

    it('is disabled at 0', async function () {
        h.miner.nodeFlushIntervalMs = 0;
        await h.runLoop(40);
        assert.ok(h.miner.generateBlocks.callCount > 0);
        assert.strictEqual(h.flush.callCount, 0);
    });

    it('survives a rejected flush: the loop keeps mining and the failure does not throw', async function () {
        h.flush.rejects(new Error('node busy'));
        await h.runLoop(25);
        assert.ok(h.flush.callCount >= 1);
        assert.ok(h.miner.generateBlocks.callCount > 20, 'mining continued after the failure');
        assert.strictEqual(h.miner._mineFailures, 0);
    });

    it('survives a synchronous throw from the flush call', async function () {
        h.flush.throws(new Error('boom'));
        await h.runLoop(15);
        assert.strictEqual(h.flush.callCount, 1);
        assert.ok(h.miner.generateBlocks.callCount > 10);
    });

    it('never awaits a slow flush: mining proceeds and no second flush overlaps it', async function () {
        h.flush.returns(new Promise(() => {}));
        h.miner._shutdown = false;
        let n = 0;
        h.miner.sleep = async () => {
            n++;
            h.clock.tick(h.TICK_MS);
            if (n >= 40) h.miner._shutdown = true;
        };
        await h.miner.start();
        assert.strictEqual(h.flush.callCount, 1);
        assert.ok(h.miner.generateBlocks.callCount > 30);
    });
});
