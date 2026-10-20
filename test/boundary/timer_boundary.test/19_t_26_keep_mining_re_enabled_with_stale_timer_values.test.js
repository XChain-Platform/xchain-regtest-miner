// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const assert = require('assert');
const sinon = require('sinon');

const BlockchainConnector = require('../../../src/rpc/blockchain_connector');
let XChainRegtestMiner;
let miner;
let connectorStub;
let clock;

function setupMiner() {
    connectorStub = {
        getWalletInfo: sinon.stub().resolves({ walletname: 'w' }),
        loadWallet: sinon.stub(),
        createWallet: sinon.stub(),
        getNewAddress: sinon.stub().resolves('bcrt1qtest'),
        getBalance: sinon.stub().resolves(50.0),
        getBlockchainInfo: sinon.stub().resolves({ blocks: 200 }),
        generateToAddress: sinon.stub().resolves(['blockhash1']),
        getRawMempool: sinon.stub().resolves([]),
        sendToAddress: sinon.stub().resolves('txid_abc'),
        setTxFee: sinon.stub().resolves(true),
        setWalletName: sinon.stub(),
        getRawTransaction: sinon.stub().resolves('0200000001...'),
        sendRawTransaction: sinon.stub().resolves('txid_sent'),
        getNetworkInfo: sinon.stub().resolves({}),
    };

    sinon.stub(BlockchainConnector.prototype, 'constructor');

    XChainRegtestMiner = require('../../../src/XChainRegtestMiner');
    miner = new XChainRegtestMiner('regtest', '127.0.0.1', '18332', 'user', 'pass');
    miner.connector = connectorStub;

    sinon.stub(miner, 'sleep').resolves();
    sinon.stub(miner, 'prepareWallet').resolves();
    sinon.stub(console, 'log');
    sinon.stub(console, 'error');

    miner.walletAddress = 'bcrt1qtest';

    clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false });
}

function teardownMiner() {
    clock.restore();
    sinon.restore();
    delete require.cache[require.resolve('../../../src/XChainRegtestMiner')];
}

function registerMinerHooks() {
    beforeEach(setupMiner);
    afterEach(teardownMiner);
}

// Drive the loop through scripted sleeps (each step runs on that 1-based sleep,
// the loop breaks at `breakAt`) and return the sleep index of every mine.
async function runScripted(steps, breakAt) {
    miner.maxTimeToMineTxs = 50;
    miner.addedTimeToMineTxs = 50;
    miner.idleMineIntervalMs = 0;
    let sleeps = 0;
    const minedAtSleep = [];
    connectorStub.generateToAddress.callsFake(async () => {
        minedAtSleep.push(sleeps);
        return ['hash'];
    });
    miner.sleep.callsFake(async () => {
        sleeps++;
        if (steps[sleeps]) steps[sleeps]();
        if (sleeps >= breakAt) throw new Error('__LOOP_BREAK__');
    });
    try {
        await miner.start();
    } catch (e) {
        if (e.message !== '__LOOP_BREAK__') throw e;
    }
    return minedAtSleep;
}

// Resume cases where the loop observes the pause on at least one pass.
function observedPauseCases() {
    it('does not mine on resume when the caller mined the pending tx during the pause', async function () {
        connectorStub.getRawMempool.resolves(['txid1']);
        const mined = await runScripted(
            {
                1: () => {
                    miner.keepMining = false;
                    connectorStub.getRawMempool.resolves([]);
                    clock.tick(100);
                },
                3: () => {
                    miner.keepMining = true;
                },
            },
            6,
        );
        assert.deepStrictEqual(mined, [], 'a timer armed before the pause must not mine an empty block after resume');
    });

    it('re-arms the timers on resume for a tx still pending, then mines it once', async function () {
        connectorStub.getRawMempool.resolves(['txid1']);
        const mined = await runScripted(
            {
                1: () => {
                    miner.keepMining = false;
                    clock.tick(100);
                },
                3: () => {
                    miner.keepMining = true;
                },
                4: () => {
                    clock.tick(50);
                },
            },
            5,
        );
        assert.deepStrictEqual(
            mined,
            [4],
            'the pending tx waits a fresh addedTimeToMineTxs after resume, then mines exactly once',
        );
    });
}

// Resume cases where no paused pass is seen, or a fill stands in for the pause.
function unobservedPauseCases() {
    it('does not mine when a pause and resume inside one poll leave the mempool empty', async function () {
        connectorStub.getRawMempool.resolves(['txid1']);
        const mined = await runScripted(
            {
                1: () => {
                    miner.keepMining = false;
                    connectorStub.getRawMempool.resolves([]);
                    clock.tick(100);
                    miner.keepMining = true;
                },
            },
            4,
        );
        assert.deepStrictEqual(
            mined,
            [],
            'the mine decision must follow a fresh mempool read, not timers from before the pause',
        );
    });

    it('does not mine after a fill run ends when the pending tx was mined during it', async function () {
        connectorStub.getRawMempool.resolves(['txid1']);
        const mined = await runScripted(
            {
                1: () => {
                    miner.fillMempoolRunning = true;
                    connectorStub.getRawMempool.resolves([]);
                    clock.tick(100);
                },
                3: () => {
                    miner.fillMempoolRunning = false;
                },
            },
            6,
        );
        assert.deepStrictEqual(
            mined,
            [],
            'a timer armed before a fill must not mine an empty block when the fill ends',
        );
    });
}

describe('Boundary: Adaptive Mining Timer Logic', function () {
    registerMinerHooks();

    // ─── T-26: keepMining toggled true with stale timers ───────────────

    describe('T-26: keepMining re-enabled with stale timer values', function () {
        it('stale timestamps may cause immediate mining on resume', async function () {
            miner.maxTimeToMineTxs = 50;
            miner.addedTimeToMineTxs = 50;

            connectorStub.getRawMempool.resolves(['txid1']);

            let iterCount = 0;
            let generateCalledAfterResume = false;

            connectorStub.generateToAddress.callsFake(async () => {
                if (iterCount > 2) generateCalledAfterResume = true;
                return ['hash'];
            });

            miner.sleep.callsFake(async () => {
                iterCount++;
                if (iterCount === 1) {
                    // Timers set, advance time
                    clock.tick(100);
                    // Pause mining
                    miner.keepMining = false;
                }
                if (iterCount === 3) {
                    // Resume mining (stale timers still have old timestamps)
                    miner.keepMining = true;
                    clock.tick(100);
                }
                if (iterCount >= 5) throw new Error('__LOOP_BREAK__');
            });

            try {
                await miner.start();
            } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e;
            }

            // The cases below assert what resume does with timers armed before a pause.
        });

        observedPauseCases();
        unobservedPauseCases();
    });
});
