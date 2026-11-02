'use strict';

// JSON-RPC 2.0 envelope conformance and log hygiene on the miner's API.
//
// Four leniencies found by replaying malformed requests against a live miner:
//   1. An empty batch `[]` answered `[]`; the spec requires one Invalid Request
//      error object with id null.
//   2. A request with `"id": null` answered an empty 200 body. id null is not a
//      notification (a notification has NO id member), so it is owed a reply.
//      The router treats any nil id as a notification and drops the reply.
//   3. continue_mining (and pause_mining) took junk positional params such as
//      [1, 2] or "str" and answered "ok", acting on a malformed request.
//   4. A failed sendtoaddress logged the node's error text in full. The node
//      echoes the destination address back ("Invalid Bitcoin address: <addr>"),
//      so a 20000-char address produced a 20 KB log line.

const assert = require('assert');
const http = require('http');
const express = require('express');
const bodyParser = require('body-parser');
const sinon = require('sinon');
const axios = require('axios');

const api = require('../../../src/api');
const { createRpcMethods } = require('../../../src/api/rpc_methods');
const BlockchainConnector = require('../../../src/rpc/blockchain_connector');
const { logger } = require('../../../src/rpc/blockchain_connector/constants');

const MAX_LOG_LINE = 512;
const LONG_ADDRESS = 'b'.repeat(20000);
const NODE_ERR = { code: -5, message: 'Invalid Bitcoin address: ' + LONG_ADDRESS };

function buildApp(controller) {
    const app = express();
    app.use(bodyParser.json());
    api.mountJsonRpc(app, controller);
    return app;
}

async function post(app, rawBody) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    try {
        const res = await fetch(`http://127.0.0.1:${port}/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: rawBody,
        });
        return { status: res.status, text: await res.text() };
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

function fakeMiner() {
    return {
        paused: false,
        async pauseMining() {
            this.paused = true;
        },
        async continueMining() {
            this.paused = false;
        },
    };
}

async function sendAndCaptureLogs(connector) {
    const logged = [];
    sinon.stub(logger, 'error').callsFake((...args) => logged.push(args.map(String).join(' ')));
    let threw = null;
    try {
        await connector.sendToAddress(LONG_ADDRESS, 0.001);
    } catch (e) {
        threw = e;
    }
    return { logged, threw };
}

function assertBoundedLines(logged) {
    assert.ok(logged.length > 0, 'the failure is still logged');
    for (const line of logged) {
        assert.ok(line.length <= MAX_LOG_LINE, `log line is ${line.length} chars`);
        assert.ok(!line.includes(LONG_ADDRESS), 'the full address is not logged');
        assert.ok(line.includes('Invalid Bitcoin address'), 'the node reason is kept');
    }
}

function sendFailureLogTests() {
    let connector;

    beforeEach(() => {
        connector = new BlockchainConnector('127.0.0.1', '18443', 'rpcuser', 'rpcpass');
        sinon.stub(console, 'error');
        sinon.stub(console, 'log');
    });
    afterEach(() => sinon.restore());

    it('bounds the logged node error when the node answers HTTP 200 with an error', async () => {
        sinon.stub(axios, 'post').resolves({ data: { result: null, error: NODE_ERR, id: 1 } });
        const { logged, threw } = await sendAndCaptureLogs(connector);
        assert.strictEqual(threw && threw.message, 'Error sending funds to address');
        assertBoundedLines(logged);
    });

    it('bounds the logged node error when the node answers HTTP 500', async () => {
        const err = new Error('Request failed with status code 500');
        err.response = { status: 500, data: { result: null, error: NODE_ERR, id: 1 } };
        sinon.stub(axios, 'post').rejects(err);
        const { logged, threw } = await sendAndCaptureLogs(connector);
        assert.strictEqual(threw && threw.message, 'Error sending funds to address');
        assertBoundedLines(logged);
    });

    it('still flags a lost wallet from a long node message', async () => {
        const message = 'Requested wallet does not exist or is not loaded' + ' x'.repeat(2000);
        sinon.stub(axios, 'post').resolves({ data: { result: null, error: { code: -18, message }, id: 1 } });
        const { threw } = await sendAndCaptureLogs(connector);
        assert.strictEqual(threw && threw.walletMissing, true);
    });
}

const pingController = () => ({ ping: async () => 'pong' });

function emptyBatchAndNullIdTests() {
    it('answers an empty batch with one Invalid Request error, id null', async () => {
        const r = await post(buildApp(pingController()), '[]');
        assert.strictEqual(r.status, 200);
        const body = JSON.parse(r.text);
        assert.ok(!Array.isArray(body), 'not an empty array');
        assert.strictEqual(body.jsonrpc, '2.0');
        assert.strictEqual(body.id, null);
        assert.strictEqual(body.error && body.error.code, -32600);
    });

    it('answers a request whose id is null, echoing id null', async () => {
        const r = await post(buildApp(pingController()), JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: null }));
        assert.strictEqual(r.status, 200);
        assert.ok(r.text.length > 0, 'reply body is not empty');
        assert.deepStrictEqual(JSON.parse(r.text), { jsonrpc: '2.0', result: 'pong', id: null });
    });

    it('answers a null-id error with id null', async () => {
        const r = await post(buildApp(pingController()), JSON.stringify({ jsonrpc: '2.0', method: 'nope', id: null }));
        const body = JSON.parse(r.text);
        assert.strictEqual(body.id, null);
        assert.strictEqual(body.error && body.error.code, -32601);
    });
}

function batchAndNotificationTests() {
    it('answers null-id elements inside a batch and still drops true notifications', async () => {
        const r = await post(
            buildApp(pingController()),
            JSON.stringify([
                { jsonrpc: '2.0', method: 'ping', id: null },
                { jsonrpc: '2.0', method: 'ping' },
                { jsonrpc: '2.0', method: 'ping', id: 4 },
            ]),
        );
        assert.deepStrictEqual(JSON.parse(r.text), [
            { jsonrpc: '2.0', result: 'pong', id: null },
            { jsonrpc: '2.0', result: 'pong', id: 4 },
        ]);
    });

    it('still sends no body for a notification (no id member)', async () => {
        const r = await post(buildApp(pingController()), JSON.stringify({ jsonrpc: '2.0', method: 'ping' }));
        assert.strictEqual(r.text, '');
    });
}

function junkParamCase(method, junk) {
    it(`${method} with params ${JSON.stringify(junk)} is refused and leaves state alone`, async () => {
        const miner = fakeMiner();
        miner.paused = method === 'continue_mining';
        const before = miner.paused;
        const r = await post(
            buildApp(createRpcMethods(miner, {})),
            JSON.stringify({ jsonrpc: '2.0', method, params: junk, id: 1 }),
        );
        const body = JSON.parse(r.text);
        assert.ok(body.result && typeof body.result.error === 'string', JSON.stringify(body));
        assert.strictEqual(miner.paused, before, 'mining state unchanged');
    });
}

function acceptedParamCase(method, params) {
    it(`${method} with params ${JSON.stringify(params)} still answers ok`, async () => {
        const req = { jsonrpc: '2.0', method, id: 1 };
        if (params !== undefined) req.params = params;
        const r = await post(buildApp(createRpcMethods(fakeMiner(), {})), JSON.stringify(req));
        assert.strictEqual(JSON.parse(r.text).result, 'ok');
    });
}

function miningControlParamTests() {
    for (const method of ['continue_mining', 'pause_mining']) {
        for (const junk of [[1, 2], 'str', 7, true]) junkParamCase(method, junk);
        for (const params of [undefined, null, {}, []]) acceptedParamCase(method, params);
    }
}

describe('JSON-RPC envelope leniencies and log hygiene', function () {
    this.timeout(10000);
    describe('send failure log line', sendFailureLogTests);
    describe('empty batch and null id', emptyBatchAndNullIdTests);
    describe('batch null ids and notifications', batchAndNotificationTests);
    describe('mining controls refuse junk params', miningControlParamTests);
});
