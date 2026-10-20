/*********************************************************************
 * test/unit/miner_health_probe_real_miner.test.js
 *
 * The health verdict asked of a REAL XChainRegtestMiner. The sibling suite
 * feeds the pure verdict function a hand-built payload, which is exactly how
 * an unreachable branch got certified; these drive the shipped state machine
 * that sets walletReady / keepMining / miningStarted and stub only the
 * network boundary (a coin node is not available to a unit run).
 *********************************************************************/

'use strict';

const assert = require('assert');
const axios  = require('axios');
const { evaluateMinerHealth, STALL_ERROR_THRESHOLD, WALLET_GRACE_MS } = require('../../../src/api');
const XChainRegtestMiner = require('../../../src/XChainRegtestMiner');

function snapshotSignalListeners() {
    return { SIGTERM: process.listeners('SIGTERM'), SIGINT: process.listeners('SIGINT') };
}

// start() installs SIGTERM/SIGINT handlers that call process.exit; drop the ones a test
// added since `before` so a later signal cannot kill the runner.
function dropSignalListenersAddedSince(before) {
    for (const sig of ['SIGTERM', 'SIGINT']) {
        for (const listener of process.listeners(sig)) {
            if (!before[sig].includes(listener)) process.removeListener(sig, listener);
        }
    }
}

// Yields to the event loop until the miner's mine-failure streak reaches the stall threshold,
// giving up after 20000 yields so a broken loop fails the assertions instead of hanging.
async function spinUntilMineFailureStall(miner) {
    for (let spins = 0; miner.getStatus().mine_failures < STALL_ERROR_THRESHOLD && spins < 20000; spins++) {
        await new Promise(resolve => setImmediate(resolve));
    }
}

function newMiner () {
    return new XChainRegtestMiner('bitcoin-regtest', 'localhost', '18443', 'user', 'pass');
}

function realMinerBasics() {
    // The production scenario the probe exists for: prepareWallet() never resolves
    // (wedged coin node, a wallet RPC that hangs), so start() never reaches
    // keepMining = true. A prepareWallet that THROWS was already covered by
    // api.js's start().catch(process.exit(1)); a hang is what this catches.
    it('reports a wedged wallet preparation as stalled, not as paused', function () {
        const status = newMiner().getStatus();
        assert.strictEqual(status.wallet_ready, false);
        assert.strictEqual(status.mining_paused, true,  'precondition: an unprepared miner also looks paused');
        assert.strictEqual(status.mining_started, false);

        const verdict = evaluateMinerHealth({ status, uptimeMs: 10 * 60000 });
        assert.strictEqual(verdict.healthy, false, 'ten minutes in with no wallet must not read healthy');
        assert.strictEqual(verdict.reason, 'wallet_not_ready');
    });

    it('reports that same miner healthy inside the cold-start grace', function () {
        const verdict = evaluateMinerHealth({ status: newMiner().getStatus(), uptimeMs: WALLET_GRACE_MS - 1 });
        assert.strictEqual(verdict.healthy, true);
    });
}

function realMinerLifecycle() {
    it('reports a started loop healthy, and an operator pause healthy too', async function () {
        const miner = newMiner();
        // Mirror prepareWallet()'s last statement (walletReady = true) and answer the
        // mempool poll locally; start()'s own ordering of keepMining / miningStarted
        // is left untouched, which is the ordering under test.
        miner.prepareWallet = async function () { this.walletReady = true; };
        miner.connector.getRawMempool = async () => [];

        const sigBefore = snapshotSignalListeners();
        const loop = miner.start();
        try {
            // Poll for the state start() is expected to reach rather than
            // settling for a fixed 50ms: prepareWallet is stubbed but still
            // async, so the handover is a scheduling fact, not a duration.
            // start() sets keepMining and miningStarted back to back with no
            // await between them, so mining_started implies mining_paused.
            const readyBy = Date.now() + 3000;
            while (!miner.getStatus().mining_started && Date.now() < readyBy) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }

            const running = miner.getStatus();
            assert.strictEqual(running.mining_started, true);
            assert.strictEqual(running.mining_paused, false);
            assert.strictEqual(evaluateMinerHealth({ status: running, uptimeMs: 10 * 60000 }).reason, 'ok');

            await miner.pauseMining();
            const paused = miner.getStatus();
            assert.strictEqual(paused.mining_paused, true);
            assert.strictEqual(paused.mining_started, true, 'a pause must not read as never-started');
            const verdict = evaluateMinerHealth({ status: paused, uptimeMs: 10 * 60000 });
            assert.strictEqual(verdict.healthy, true);
            assert.strictEqual(verdict.reason, 'paused');
        } finally {
            miner._shutdown = true;
            await loop;
            // start() installs SIGTERM/SIGINT handlers that call process.exit; drop
            // the ones this test added so a later signal cannot kill the runner.
            dropSignalListenersAddedSince(sigBefore);
        }
    });
}

function realMinerFailures() {
    // The reported failure, driven through the REAL auto-mine loop: the node
    // answers getrawmempool on every cycle but refuses generatetoaddress. The
    // loop zeroes consecutive_errors on each successful mempool read, which runs
    // immediately before the idle-mine heartbeat, so that counter reads 1 forever
    // and an unguarded probe answers {healthy:true, reason:'ok'} while block height
    // never advances. mine_failures is the streak that has to accumulate.
    it('accumulates mine_failures when only generatetoaddress fails, and stalls', async function () {
        const miner = newMiner();
        // Virtual clock: the loop's own sleeps advance it, so the idle-mine
        // interval elapses by iteration count rather than by wall time.
        let nowMs = 1e9;
        const realNow = Date.now;
        Date.now = () => nowMs;
        miner.sleep = async (ms) => { nowMs += (Number(ms) || 0); await new Promise(r => setImmediate(r)); };

        miner.prepareWallet = async function () { this.walletAddress = 'bcrt1qtest'; this.walletReady = true; };
        // The only stubs are the network boundary. getRawMempool SUCCEEDS, which
        // is the whole point: it is what keeps consecutive_errors pinned at 1.
        miner.connector.getRawMempool     = async () => [];
        miner.connector.generateToAddress = async () => { throw new Error('node refused the mine'); };
        await miner.setIdleMineInterval(1000);

        const sigBefore = snapshotSignalListeners();
        const loop = miner.start();
        try {
            await spinUntilMineFailureStall(miner);
            const status = miner.getStatus();
            assert.ok(status.mine_failures >= STALL_ERROR_THRESHOLD,
                'the mine-failure streak must survive the successful mempool reads between mines, got '
                + status.mine_failures);
            assert.ok(status.consecutive_errors <= 1,
                'precondition: the shared counter is still being zeroed by the mempool read, got '
                + status.consecutive_errors);
            const verdict = evaluateMinerHealth({ status, uptimeMs: 10 * 60000 });
            assert.strictEqual(verdict.healthy, false, 'a miner that cannot mine must not read healthy');
            assert.strictEqual(verdict.reason, 'mine_failures');
        } finally {
            miner._shutdown = true;
            await loop;
            Date.now = realNow;
            dropSignalListenersAddedSince(sigBefore);
        }
    });
}

function realMinerEmptyMines() {
    // The node's own answer when generatetoaddress exhausts maxtries at real
    // difficulty: an empty hash list and no error. Drive it through the REAL
    // connector so the contract under test is the one production runs.
    it('counts an empty generatetoaddress answer as a failed mine, not a mined block', async function () {
        const miner = newMiner();
        let nowMs = 1e9;
        const realNow = Date.now;
        const realPost = axios.post;
        const realConsoleError = console.error;
        Date.now = () => nowMs;
        miner.sleep = async (ms) => { nowMs += (Number(ms) || 0); await new Promise(r => setImmediate(r)); };
        miner.prepareWallet = async function () { this.walletAddress = 'bcrt1qtest'; this.walletReady = true; };
        miner.connector.getRawMempool = async () => [];
        axios.post = async (url, body) => {
            if (body && body.method === 'generatetoaddress') return { data: { result: [], error: null, id: 1 } };
            throw new Error('unexpected RPC in this test: ' + (body && body.method));
        };
        console.error = () => {};
        await miner.setIdleMineInterval(1000);

        const sigBefore = snapshotSignalListeners();
        const loop = miner.start();
        try {
            await spinUntilMineFailureStall(miner);
            const status = miner.getStatus();
            assert.strictEqual(status.blocks_mined, 0, 'an empty hash list mined nothing and must not be credited');
            assert.strictEqual(status.last_mine_at, null, 'an empty hash list must not stamp a fresh last_mine_at');
            assert.ok(status.mine_failures >= STALL_ERROR_THRESHOLD,
                'an empty generatetoaddress answer must extend the mine-failure streak, got ' + status.mine_failures);
            const verdict = evaluateMinerHealth({ status, uptimeMs: 10 * 60000 });
            assert.strictEqual(verdict.healthy, false);
            assert.strictEqual(verdict.reason, 'mine_failures');
        } finally {
            miner._shutdown = true;
            await loop;
            Date.now = realNow;
            axios.post = realPost;
            console.error = realConsoleError;
            dropSignalListenersAddedSince(sigBefore);
        }
    });
}


describe('miner health probe verdict', function () {
    describe('against a real XChainRegtestMiner', realMinerBasics);
    describe('against a real XChainRegtestMiner', realMinerLifecycle);
    describe('against a real XChainRegtestMiner', realMinerFailures);
    describe('against a real XChainRegtestMiner', realMinerEmptyMines);
});
