// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.
//
//
// dogecoind writes its block index to disk only once an hour, so a hard
// power-off of the host drops up to an hour of idle-mined blocks. After an idle
// block the loop forces a flush (a gettxoutsetinfo call) at most once per
// NODE_FLUSH_INTERVAL_MS. These pin the cadence and the service defaults,
// driving the real loop with a stub RPC client and a fake clock.

const assert = require('assert');
const sinon = require('sinon');
const { useFlushHarness } = require('../../helpers/node_flush_harness');

describe('XChainRegtestMiner node flush cadence', function () {
    const h = useFlushHarness();

    it('is off on a bare instance and on at the service default of five minutes', function () {
        assert.strictEqual(new h.XChainRegtestMiner('regtest', 'h', '1', 'u', 'p').nodeFlushIntervalMs, 0);
        const { parseNodeFlushInterval } = require('../../../src/api/startup');
        const log = { warn: sinon.stub() };
        assert.strictEqual(parseNodeFlushInterval(undefined, log), 300000);
        assert.strictEqual(parseNodeFlushInterval('  ', log), 300000);
        assert.strictEqual(parseNodeFlushInterval('0', log), 0);
        assert.strictEqual(parseNodeFlushInterval('45000', log), 45000);
        assert.strictEqual(parseNodeFlushInterval('abc', log), 300000);
        assert.strictEqual(parseNodeFlushInterval('-5', log), 300000);
        assert.strictEqual(log.warn.callCount, 2);
    });

    it('flushes after an idle block once the interval has passed', async function () {
        await h.runLoop(15);
        assert.ok(h.miner.generateBlocks.callCount > 0, 'idle blocks were mined');
        assert.strictEqual(h.flush.callCount, 1);
        assert.strictEqual(typeof h.flush.firstCall.args[0], 'number', 'the call is bounded by a timeout');
    });

    it('does not flush before the interval has passed', async function () {
        await h.runLoop(5);
        assert.ok(h.miner.generateBlocks.callCount > 0);
        assert.strictEqual(h.flush.callCount, 0);
    });

    it('never flushes twice inside one interval, however fast it mines', async function () {
        await h.runLoop(15);
        assert.strictEqual(h.flush.callCount, 1);
        // 35 more ticks: blocks every pass, flushes only at the 10 s marks (3 in 35 s).
        h.flush.resetHistory();
        h.miner._shutdown = false;
        await h.runLoop(35);
        assert.ok(h.flush.callCount >= 3 && h.flush.callCount <= 4, 'got ' + h.flush.callCount);
    });
});
