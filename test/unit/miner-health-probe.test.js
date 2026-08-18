/*********************************************************************
 * test/unit/miner-health-probe.test.js
 *
 * The Docker HEALTHCHECK POSTs `ping`, whose handler always
 * returns status:"success" and reports wallet readiness in the body only.
 * Credential drift or an unreachable coin node therefore stalled mining
 * indefinitely while the container stayed Docker-healthy, and any
 * `depends_on: service_healthy` stack proceeded against a miner that never
 * advanced block height.
 *
 * The probe now reads `health`, whose verdict lives in the pure function
 * asserted here. `ping` is deliberately left as liveness-only.
 *********************************************************************/

'use strict';

const assert = require('assert');
const fs     = require('fs');
const path   = require('path');
const { evaluateMinerHealth, UNAUTHENTICATED_METHODS,
        STALL_ERROR_THRESHOLD, WALLET_GRACE_MS } = require('../../src/api');
const XChainRegtestMiner = require('../../src/XChainRegtestMiner');

// Every field the real getStatus() emits for a running, healthy miner. mining_started
// belongs here: a payload that omits it is one the real miner cannot produce, and
// synthetic-only payloads are how the first cut of this probe certified a branch
// production never reached.
const READY = { wallet_ready: true, consecutive_errors: 0, mining_paused: false, mining_started: true };

describe('miner health probe verdict', function () {

    it('is healthy when the wallet is ready and the loop is not failing', function () {
        assert.strictEqual(evaluateMinerHealth({ status: READY, uptimeMs: 10 * 60000 }).healthy, true);
    });

    it('is unhealthy on a sustained run of mining failures', function () {
        const status = Object.assign({}, READY, { consecutive_errors: STALL_ERROR_THRESHOLD });
        const verdict = evaluateMinerHealth({ status, uptimeMs: 10 * 60000 });
        assert.strictEqual(verdict.healthy, false);
        assert.strictEqual(verdict.reason, 'consecutive_errors');
    });

    it('tolerates a short failure streak below the threshold', function () {
        const status = Object.assign({}, READY, { consecutive_errors: STALL_ERROR_THRESHOLD - 1 });
        assert.strictEqual(evaluateMinerHealth({ status, uptimeMs: 10 * 60000 }).healthy, true);
    });

    it('is unhealthy when the wallet never became ready past the cold-start grace', function () {
        const status = Object.assign({}, READY, { wallet_ready: false });
        const verdict = evaluateMinerHealth({ status, uptimeMs: WALLET_GRACE_MS + 1 });
        assert.strictEqual(verdict.healthy, false);
        assert.strictEqual(verdict.reason, 'wallet_not_ready');
    });

    // start() runs prepareWallet() detached, so a cold start legitimately answers
    // before walletAddress is set. Flagging that window unhealthy would stall every
    // depends_on: service_healthy bring-up the miner participates in.
    it('tolerates a not-yet-ready wallet inside the cold-start grace', function () {
        const status = Object.assign({}, READY, { wallet_ready: false });
        assert.strictEqual(evaluateMinerHealth({ status, uptimeMs: WALLET_GRACE_MS - 1 }).healthy, true);
    });

    // fill_mempool / invalidate_block hold keepMining=false until continue_mining.
    // That is an operator action, not a stall; reporting it unhealthy would flap
    // the container on every drill that pauses mining. A pause can only follow a
    // prepared wallet and a started loop, so the payload says so.
    it('treats a deliberate pause as healthy even with a failing streak', function () {
        const status = { wallet_ready: true, consecutive_errors: 99, mining_paused: true, mining_started: true };
        const verdict = evaluateMinerHealth({ status, uptimeMs: 10 * 60000 });
        assert.strictEqual(verdict.healthy, true);
        assert.strictEqual(verdict.reason, 'paused');
    });

    // The half-fix this test file first shipped with: a pause-first branch order made
    // the wallet check unreachable, because keepMining is false during wallet prep too.
    // Asserted on a payload shaped like the real one rather than on the old synthetic
    // { wallet_ready:false, mining_paused:false }, which getStatus() cannot emit.
    it('does not let a not-yet-prepared wallet hide behind mining_paused', function () {
        const status = { wallet_ready: false, consecutive_errors: 0, mining_paused: true, mining_started: false };
        const verdict = evaluateMinerHealth({ status, uptimeMs: 10 * 60000 });
        assert.strictEqual(verdict.healthy, false);
        assert.strictEqual(verdict.reason, 'wallet_not_ready');
    });

    it('is unhealthy when the wallet is ready but the mining loop never started', function () {
        const status = Object.assign({}, READY, { mining_started: false, mining_paused: true });
        const verdict = evaluateMinerHealth({ status, uptimeMs: 10 * 60000 });
        assert.strictEqual(verdict.healthy, false);
        assert.strictEqual(verdict.reason, 'not_started');
    });

    it('fails closed on a missing status payload past the grace window', function () {
        assert.strictEqual(evaluateMinerHealth({ uptimeMs: WALLET_GRACE_MS + 1 }).healthy, false);
    });

    it('exempts health from the MINER_API_KEY gate, as the probe sends no key', function () {
        assert.ok(UNAUTHENTICATED_METHODS.has('health'),
            'health must bypass the API-key gate or the Docker healthcheck 401s forever');
    });

    // Wiring guards: the handler is built inside startApi()'s closure and the probe
    // lives in the Dockerfile, so neither is reachable from a require. A verdict
    // nothing probes is the exact defect this item is about.
    it('registers health on the JSON-RPC controller and 503s on the verdict', function () {
        const src = fs.readFileSync(path.join(__dirname, '../../src/api.js'), 'utf8');
        const controller = src.slice(src.indexOf('const jsonRpcController = {'));
        assert.ok(/^\s+async health\(params, \{res\}\)\s*\{/m.test(controller), 'health method not registered');
        assert.ok(/evaluateMinerHealth\(/.test(controller), 'health does not consult the verdict');
        assert.ok(/if \(!verdict\.healthy\) res\.status\(503\)/.test(controller), 'health never sets 503');
    });

    // Everything above feeds the pure function a hand-built payload, which is exactly
    // how the unreachable branch got certified. These ask a REAL XChainRegtestMiner
    // instead. Only the network boundary is stubbed (a coin node is not available to
    // a unit run); the state machine that sets walletReady / keepMining /
    // miningStarted is the shipped one.
    describe('against a real XChainRegtestMiner', function () {

        function newMiner () {
            return new XChainRegtestMiner('bitcoin-regtest', 'localhost', '18443', 'user', 'pass');
        }

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

        it('reports a started loop healthy, and an operator pause healthy too', async function () {
            const miner = newMiner();
            // Mirror prepareWallet()'s last statement (walletReady = true) and answer the
            // mempool poll locally; start()'s own ordering of keepMining / miningStarted
            // is left untouched, which is the ordering under test.
            miner.prepareWallet = async function () { this.walletReady = true; };
            miner.connector.getRawMempool = async () => [];

            const sigBefore = { SIGTERM: process.listeners('SIGTERM'), SIGINT: process.listeners('SIGINT') };
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
                for (const sig of ['SIGTERM', 'SIGINT']) {
                    for (const listener of process.listeners(sig)) {
                        if (!sigBefore[sig].includes(listener)) process.removeListener(sig, listener);
                    }
                }
            }
        });
    });

    // The Dockerfile probe exits non-zero only on a non-200, so the whole fix rests on
    // res.status(503) surviving express-json-rpc-router, which wraps every handler
    // result in a JSON-RPC envelope. Asserted over a real socket rather than trusted:
    // a router that always answered 200 would make the verdict decorative.
    it('lets a handler 503 reach the wire through express-json-rpc-router', async function () {
        const express    = require('express');
        const bodyParser = require('body-parser');
        const jsonRouter = require('express-json-rpc-router');

        const app = express();
        app.use(bodyParser.json());
        app.use((req, res, next) => { if (req.body === undefined) req.body = {}; next(); });
        app.use(jsonRouter({ methods: {
            async health (params, { res }) {
                const verdict = evaluateMinerHealth({
                    status:   { wallet_ready: false, mining_paused: true, mining_started: false },
                    uptimeMs: 10 * 60000
                });
                if (!verdict.healthy) res.status(503);
                return { status: verdict.healthy ? 'success' : 'degraded', reason: verdict.reason };
            }
        } }));

        const server = app.listen(0);
        try {
            await new Promise(resolve => server.once('listening', resolve));
            const response = await fetch('http://127.0.0.1:' + server.address().port + '/', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ jsonrpc: '2.0', method: 'health', id: 1 })
            });
            assert.strictEqual(response.status, 503, 'a stalled miner must answer non-200 or the probe passes');
            const body = await response.json();
            assert.strictEqual(body.result.reason, 'wallet_not_ready');
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });

    it('points the Docker HEALTHCHECK at health rather than ping', function () {
        const dockerfile = fs.readFileSync(path.join(__dirname, '../../Dockerfile'), 'utf8');
        const healthcheck = dockerfile.slice(dockerfile.indexOf('HEALTHCHECK'));
        assert.ok(healthcheck.includes("method:'health'"), 'HEALTHCHECK still probes the wrong method');
        assert.ok(!healthcheck.includes("method:'ping'"), 'HEALTHCHECK still probes ping');
    });

});
