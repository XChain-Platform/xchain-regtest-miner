'use strict';

// A batch with a non-object element (null, a number, a string, an array) killed
// the process. express-json-rpc-router's batch loop calls the async single-request
// handler (which destructures its argument and so returns a rejected promise for
// null), then reads `.id` on the same element and throws synchronously before the
// promise is collected. The orphaned rejection is an unhandledRejection, which ends
// a Node 22 process. One unauthenticated request must get a JSON-RPC error, never
// stop the only block producer.
//
// This builds the same middleware chain around the REAL normalizer lifted out of
// src/api.js's mountJsonRpc, and counts unhandledRejection events.

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const jsonRouter = require('express-json-rpc-router');

const API_SRC = path.join(__dirname, '../../src/api.js');

// Run the real mountJsonRpc against a recording app, then replay its middlewares.
function realMiddlewares() {
    const api = require(API_SRC);
    assert.strictEqual(typeof api.mountJsonRpc, 'function', 'src/api.js must export mountJsonRpc');
    const stack = [];
    api.mountJsonRpc({ use: (fn) => stack.push(fn) }, { ping: async () => 'pong' });
    return stack.slice(0, -1); // all but the router itself
}

function buildApp(withGuards) {
    const app = express();
    app.use(bodyParser.json());
    if (withGuards) for (const mw of realMiddlewares()) app.use(mw);
    app.use(jsonRouter({ methods: { ping: async () => 'pong' } }));
    return app;
}

async function post(app, body) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    try {
        const res = await fetch(`http://127.0.0.1:${port}/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        return JSON.parse(await res.text());
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

describe('JSON-RPC batch with non-object elements', function () {
    this.timeout(10000);
    let rejections;
    const onRejection = (e) => rejections.push(e);

    beforeEach(() => {
        rejections = [];
        process.on('unhandledRejection', onRejection);
    });
    afterEach(() => process.removeListener('unhandledRejection', onRejection));

    const flush = () => new Promise((r) => setImmediate(() => setImmediate(r)));
    const BAD = [[null], [1], ['x'], [[]], [[null]]];

    it('CONTROL: without the guard a null element produces an unhandled rejection', async () => {
        try {
            await post(buildApp(false), [null]);
        } catch (_) {
            /* the request may fail; the rejection is the point */
        }
        await flush();
        assert.ok(rejections.length > 0, 'control must reproduce the orphaned rejection');
        assert.match(String(rejections[0].message), /destructure/);
    });

    for (const body of BAD) {
        it(`${JSON.stringify(body)} gets JSON-RPC error content and no unhandled rejection`, async () => {
            const r = await post(buildApp(true), body);
            await flush();
            assert.deepStrictEqual(rejections, [], 'no unhandledRejection may be raised');
            assert.ok(Array.isArray(r), 'a batch reply stays a batch');
            assert.strictEqual(r.length, body.length);
            for (const item of r) assert.ok(item.error && typeof item.error.message === 'string');
        });
    }

    it('a valid element in the same batch still returns its result', async () => {
        const r = await post(buildApp(true), [null, { jsonrpc: '2.0', id: 7, method: 'ping' }]);
        await flush();
        assert.deepStrictEqual(rejections, []);
        assert.strictEqual(r.length, 2);
        const ok = r.find((x) => x.id === 7);
        assert.strictEqual(ok.result, 'pong');
        assert.ok(r.some((x) => x.error));
    });

    it('src/api.js wires the element guard before the jsonRouter mount', () => {
        const src = fs.readFileSync(API_SRC, 'utf8');
        const guardIdx = src.indexOf('Invalid Request');
        const routerIdx = src.indexOf('jsonRouter({');
        assert.notStrictEqual(guardIdx, -1, 'batch element guard missing from src/api.js');
        assert.ok(guardIdx < routerIdx, 'guard must be registered before the jsonRouter mount');
    });
});
