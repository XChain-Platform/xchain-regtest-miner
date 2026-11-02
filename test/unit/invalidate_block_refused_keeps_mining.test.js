// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.
//
// invalidateBlock pauses auto-mining before the node call. When the node
// refuses the call (unknown or malformed hash) nothing was invalidated, so the
// rejected call must leave mining state unchanged; a successful invalidate keeps
// its documented pause until continueMining().

const assert = require('assert');
const sinon = require('sinon');

const HASH = 'ff'.repeat(32);

let miner;

function setupMiner(invalidate) {
    const XChainRegtestMiner = require('../../src/XChainRegtestMiner');
    miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass');
    sinon.stub(console, 'log');
    miner.walletReady = true;
    miner.keepMining = true;
    miner.refreshWalletFunds = async () => {};
    miner.connector = { invalidateBlock: invalidate };
}

describe('invalidateBlock refused by the node', function () {
    afterEach(() => {
        sinon.restore();
        delete require.cache[require.resolve('../../src/XChainRegtestMiner')];
    });

    it('leaves auto-mining running and releases the mine hold', async function () {
        setupMiner(async () => {
            throw new Error('Error invalidating block');
        });
        await assert.rejects(miner.invalidateBlock(HASH), /Error invalidating block/);
        assert.strictEqual(miner.keepMining, true);
        assert.strictEqual(miner._reorgMineHolds.size, 0);
    });

    it('keeps the documented pause after a successful invalidate', async function () {
        setupMiner(async () => true);
        await miner.invalidateBlock(HASH);
        assert.strictEqual(miner.keepMining, false);
        assert.strictEqual(miner._reorgMineHolds.size, 0);
    });

    it('leaves an operator-paused miner paused after a refused invalidate', async function () {
        setupMiner(async () => {
            throw new Error('Error invalidating block');
        });
        miner.keepMining = false;
        await assert.rejects(miner.invalidateBlock(HASH));
        assert.strictEqual(miner.keepMining, false);
    });

    it('does not override an operator pause that lands during the node call', async function () {
        let release;
        const parked = new Promise((r) => (release = r));
        setupMiner(async () => {
            await parked;
            throw new Error('Error invalidating block');
        });
        const call = miner.invalidateBlock(HASH);
        await new Promise((r) => setImmediate(r));
        await miner.pauseMining();
        release();
        await assert.rejects(call);
        assert.strictEqual(miner.keepMining, false);
    });
});
