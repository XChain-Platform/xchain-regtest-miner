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
 * test/unit/XChainRegtestMiner/fill_mempool_cancel_progress.test.js
 *
 * fill_mempool broadcasts its stress transactions one at a time and the node's
 * sendrawtransaction slows as its mempool grows, so a fill at the 50000 cap
 * runs for well over half an hour with mining held off. status must show how
 * far the run has got, and cancel_fill_mempool must stop it after the RPC in
 * flight, release the fill's hold on mining, and leave continue_mining able to
 * resume.
 *
 * Drives the real fillMempool through the JSON-RPC methods against a connector
 * stub that fabricates funding transactions and records broadcasts.
 *
 ********************************************************************/

'use strict';

const assert = require('assert');
const sinon = require('sinon');
const bitcoin = require('bitcoinjs-lib');

const XChainRegtestMiner = require('../../../src/XChainRegtestMiner');
const { createRpcMethods } = require('../../../src/api/rpc_methods');
const { UNAUTHENTICATED_METHODS } = require('../../../src/api/auth');

const SATOSHI_UNIT = 100000000;

// onStressSend(index) runs inside each stress broadcast before it resolves, and
// onMine() inside each of the fill's own mines, so a test can read status or
// cancel while the run is mid-flight.
function buildMiner({ onStressSend = async () => {}, onMine = async () => {} } = {}) {
    const net = bitcoin.networks.regtest;
    const rawById = new Map();
    const stressSends = [];
    let fundingNonce = 0;

    const connector = {
        getRawMempool: sinon.stub().resolves([]),
        getRawTransaction: sinon.stub().callsFake(async (txid) => rawById.get(txid) || null),
        sendToAddress: sinon.stub().callsFake(async (address, amount) => {
            const tx = new bitcoin.Transaction();
            tx.version = 1;
            const prev = Buffer.alloc(32, 0);
            prev.writeUInt32LE(++fundingNonce, 0);
            tx.addInput(prev, 0);
            tx.addOutput(bitcoin.address.toOutputScript(address, net), Math.round(amount * SATOSHI_UNIT));
            rawById.set(tx.getId(), tx.toHex());
            return tx.getId();
        }),
        sendRawTransaction: sinon.stub().callsFake(async (hex) => {
            const tx = bitcoin.Transaction.fromHex(hex);
            const id = tx.getId();
            rawById.set(id, hex);
            // A stress tx spends one split output to one output; a split fans out.
            if (tx.outs.length === 1) {
                stressSends.push(id);
                await onStressSend(stressSends.length - 1);
            }
            return id;
        }),
    };

    const miner = new XChainRegtestMiner('bitcoin-regtest', '127.0.0.1', '18443', 'user', 'pass');
    miner.connector = connector;
    miner.walletReady = true;
    miner.miningStarted = true;
    sinon.stub(miner, 'sleep').resolves();
    sinon.stub(miner, 'sendFundsToAddress').callsFake((address, amount) => connector.sendToAddress(address, amount));
    sinon.stub(miner, 'generateBlocksQueued').callsFake(async () => {
        await onMine();
        return [];
    });
    return { miner, stressSends, rpc: createRpcMethods(miner, async () => ({})) };
}

// Silences the fill's logging and drops the stubs after each test.
function quietConsole() {
    beforeEach(function () {
        sinon.stub(console, 'log');
        sinon.stub(console, 'error');
    });
    afterEach(function () {
        sinon.restore();
    });
}

describe('fill_mempool progress in status', function () {
    quietConsole();

    it('reports a rising sent count against the requested total while the run broadcasts', async function () {
        const samples = [];
        const ctx = buildMiner({
            onStressSend: async () => {
                samples.push((await ctx.rpc.status()).fill_mempool);
            },
        });

        assert.strictEqual((await ctx.rpc.status()).fill_mempool, null, 'no fill has run yet');
        assert.strictEqual(await ctx.rpc.fill_mempool({ tx_quantity: 4 }), 'ok');

        assert.deepStrictEqual(
            samples.map((p) => p.sent),
            [0, 1, 2, 3],
        );
        for (const p of samples) {
            assert.strictEqual(p.running, true);
            assert.strictEqual(p.phase, 'stressing');
            assert.strictEqual(p.requested, 4);
            assert.strictEqual(p.cancel_requested, false);
        }
        const final = (await ctx.rpc.status()).fill_mempool;
        assert.strictEqual(final.running, false);
        assert.strictEqual(final.phase, 'done');
        assert.strictEqual(final.sent, 4);
        assert.ok(Number.isFinite(final.finished_at));
    });
});

describe('cancel_fill_mempool mid-broadcast', function () {
    quietConsole();

    it('stops a run mid-broadcast, releases its hold on mining and lets continue_mining resume', async function () {
        const TOTAL = 10;
        let cancelAnswer = null;
        let cancelSettled = null;
        const ctx = buildMiner({
            onStressSend: async (index) => {
                if (index !== 2) return;
                await ctx.rpc.continue_mining();
                assert.strictEqual(ctx.miner.fillMempoolRunning, true, 'continue_mining alone does not end a fill');
                // The cancel waits for the run to settle, and the run is parked in
                // this very broadcast, so take the answer without awaiting it here.
                cancelSettled = ctx.rpc.cancel_fill_mempool().then((answer) => {
                    cancelAnswer = answer;
                });
            },
        });

        const result = await ctx.rpc.fill_mempool({ tx_quantity: TOTAL });
        await cancelSettled;

        assert.ok(result && typeof result === 'object', 'a cancelled fill does not answer ok');
        assert.strictEqual(result.cancelled, true);
        assert.match(result.error, /cancelled during stressing/);
        assert.strictEqual(result.requested, TOTAL);
        // The broadcast in flight when the cancel landed completes; none after it starts.
        assert.strictEqual(result.sent, 3);
        assert.strictEqual(ctx.stressSends.length, 3);

        assert.strictEqual(cancelAnswer.cancelled, true);
        assert.strictEqual(cancelAnswer.fill_mempool.running, false, 'cancel answers once the run has stopped');
        assert.strictEqual(cancelAnswer.fill_mempool.phase, 'cancelled');
        assert.strictEqual(cancelAnswer.fill_mempool.sent, 3);

        const status = await ctx.rpc.status();
        assert.strictEqual(status.fill_running, false);
        assert.strictEqual(status.mining_paused, false, 'the continue_mining that landed mid-fill now holds');
        assert.deepStrictEqual(await ctx.rpc.generate_blocks({ count: 1 }), { count: 0, hashes: [] });
    });
});

describe('cancel_fill_mempool without continue_mining', function () {
    quietConsole();

    it('leaves the miner paused when no continue_mining landed, as a finished fill does', async function () {
        let cancelSettled = null;
        const ctx = buildMiner({
            onStressSend: async (index) => {
                if (index === 0) cancelSettled = ctx.rpc.cancel_fill_mempool();
            },
        });
        ctx.miner.keepMining = true;
        const result = await ctx.rpc.fill_mempool({ tx_quantity: 5 });
        await cancelSettled;
        assert.strictEqual(result.cancelled, true);
        assert.strictEqual((await ctx.rpc.status()).mining_paused, true);
        await ctx.rpc.continue_mining();
        assert.strictEqual((await ctx.rpc.status()).mining_paused, false);
    });
});

describe('cancel_fill_mempool outside the broadcast loop', function () {
    quietConsole();

    it('stops during the confirmation mines before any stress transaction is sent', async function () {
        let confirmingMines = 0;
        let cancelSettled = null;
        const ctx = buildMiner({
            onMine: async () => {
                if (ctx.miner.getStatus().fill_mempool.phase !== 'confirming') return;
                confirmingMines++;
                if (!cancelSettled) cancelSettled = ctx.rpc.cancel_fill_mempool();
            },
        });
        // Keep the split txs pending, so only the cancel can end the confirmation loop early.
        const splitTxids = [];
        const realSend = ctx.miner.connector.sendRawTransaction;
        ctx.miner.connector.getRawMempool = async () => [...splitTxids];
        ctx.miner.connector.sendRawTransaction = async (hex) => {
            const id = await realSend(hex);
            if (bitcoin.Transaction.fromHex(hex).outs.length > 1) splitTxids.push(id);
            return id;
        };

        const result = await ctx.rpc.fill_mempool({ tx_quantity: 5 });
        await cancelSettled;

        assert.strictEqual(result.cancelled, true);
        assert.match(result.error, /during confirming/);
        assert.strictEqual(result.sent, 0);
        assert.strictEqual(ctx.stressSends.length, 0);
        assert.strictEqual(confirmingMines, 1, 'the cancel stopped the loop after the mine in flight');
        assert.strictEqual(ctx.miner.fillMempoolRunning, false);
    });

    it('a cancel aimed at an earlier run never aborts the next one', async function () {
        let cancelArmed = true;
        let cancelSettled = null;
        const ctx = buildMiner({
            onStressSend: async () => {
                if (!cancelArmed) return;
                cancelArmed = false;
                cancelSettled = ctx.rpc.cancel_fill_mempool();
            },
        });

        const first = await ctx.rpc.fill_mempool({ tx_quantity: 3 });
        await cancelSettled;
        assert.strictEqual(first.cancelled, true);

        ctx.stressSends.length = 0;
        assert.strictEqual(await ctx.rpc.fill_mempool({ tx_quantity: 3 }), 'ok');
        assert.strictEqual((await ctx.rpc.status()).fill_mempool.sent, 3);
    });
});

describe('cancel_fill_mempool contract', function () {
    quietConsole();

    it('answers cancelled false and changes nothing when no fill runs', async function () {
        const ctx = buildMiner();
        ctx.miner.keepMining = true;

        const answer = await ctx.rpc.cancel_fill_mempool();

        assert.deepStrictEqual(answer, { cancelled: false, fill_mempool: null });
        assert.strictEqual(ctx.miner.keepMining, true);
        assert.strictEqual(ctx.miner._fillCancelRequested, false);
    });

    it('refuses junk params and stays behind the API key', async function () {
        const ctx = buildMiner();
        assert.deepStrictEqual(await ctx.rpc.cancel_fill_mempool(7), { error: 'This method takes no params' });
        assert.ok(!UNAUTHENTICATED_METHODS.has('cancel_fill_mempool'));
    });
});
