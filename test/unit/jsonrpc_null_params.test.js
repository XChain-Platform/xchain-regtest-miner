'use strict';

// An explicit `"params": null` bypassed the controller's error envelope.
//
// express-json-rpc-router destructures the request body as `{ ..., params = {} }`.
// A default parameter fires only on undefined, so an ABSENT params really does
// arrive as {} and the handler's own try/catch produces the standard truthy
// `{error: "..."}` result. An explicit null does not: it is passed through to
// `send_funds({address, amount})`, which throws during argument binding, before
// the handler body (and therefore its try/catch) is ever entered. The router
// catches that and answers with a top-level JSON-RPC `error` member instead,
// so one failure class had two wire shapes and the reply carried a raw
// "Cannot destructure property ..." JS message.
//
// This reconstructs the exact middleware chain with THIS service's own dependency
// versions, proves the drift exists without the normalizer, and proves the
// normalizer removes it. It also asserts src/api.js still wires the normalizer
// before the router mount so the fix cannot silently regress.

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const jsonRouter = require('express-json-rpc-router');

const BODY_GUARD = (req, res, next) => { if (req.body === undefined) req.body = {}; next(); };

const PARAM_GUARD = (req, res, next) => {
    const normalize = (rpc) => { if (rpc && typeof rpc === 'object' && rpc.params === null) rpc.params = {} };
    if (Array.isArray(req.body)) req.body.forEach(normalize);
    else normalize(req.body);
    next();
};

// Stands in for the real parameterized handlers: destructures in the signature
// and reports failure as a truthy {error} result, exactly as send_funds does.
const METHODS = {
    async send_funds({ address, amount }) {
        if (typeof address !== 'string' || !address) return { error: 'There was a problem sending funds: Invalid address' };
        return 'txid-' + address + '-' + amount;
    }
};

function buildApp(withParamGuard) {
    const app = express();
    app.use(bodyParser.json());
    app.use(BODY_GUARD);
    if (withParamGuard) app.use(PARAM_GUARD);
    app.use(jsonRouter({ methods: METHODS }));
    return app;
}

async function rpc(app, body) {
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    try {
        const res = await fetch(`http://127.0.0.1:${port}/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return JSON.parse(await res.text());
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
}

describe('JSON-RPC null params normalization', function () {
    this.timeout(10000);

    it('CONTROL: without the normalizer, params:null escapes to a top-level JSON-RPC error', async () => {
        const r = await rpc(buildApp(false), { jsonrpc: '2.0', id: 1, method: 'send_funds', params: null });
        assert.ok(r.error, 'control must reproduce the drift, or the guarded case proves nothing');
        assert.match(r.error.message, /destructure/);
        assert.strictEqual(r.result, undefined);
    });

    it('with the normalizer, params:null returns the controller error envelope', async () => {
        const r = await rpc(buildApp(true), { jsonrpc: '2.0', id: 1, method: 'send_funds', params: null });
        assert.strictEqual(r.error, undefined, 'no top-level JSON-RPC error member');
        assert.match(r.result.error, /Invalid address/);
    });

    it('an ABSENT params was already fine and still is (router default, not this guard)', async () => {
        for (const app of [buildApp(false), buildApp(true)]) {
            const r = await rpc(app, { jsonrpc: '2.0', id: 1, method: 'send_funds' });
            assert.strictEqual(r.error, undefined);
            assert.match(r.result.error, /Invalid address/);
        }
    });

    it('a well-formed call is untouched', async () => {
        const r = await rpc(buildApp(true), { jsonrpc: '2.0', id: 1, method: 'send_funds', params: { address: 'bcrt1q', amount: 2 } });
        assert.strictEqual(r.result, 'txid-bcrt1q-2');
    });

    it('normalizes each member of a batch body rather than replacing the array', async () => {
        const r = await rpc(buildApp(true), [
            { jsonrpc: '2.0', id: 1, method: 'send_funds', params: null },
            { jsonrpc: '2.0', id: 2, method: 'send_funds', params: { address: 'bcrt1q', amount: 1 } }
        ]);
        assert.ok(Array.isArray(r), 'batch replies must stay a batch');
        assert.strictEqual(r.length, 2);
        assert.match(r.find((x) => x.id === 1).result.error, /Invalid address/);
        assert.strictEqual(r.find((x) => x.id === 2).result, 'txid-bcrt1q-1');
    });

    it('src/api.js wires the params normalizer before the jsonRouter mount', () => {
        const src = fs.readFileSync(path.join(__dirname, '../../src/api.js'), 'utf8');
        const guardIdx = src.indexOf('rpc.params === null');
        const routerIdx = src.indexOf('jsonRouter(');
        assert.notStrictEqual(guardIdx, -1, 'params normalizer missing from src/api.js');
        assert.ok(guardIdx < routerIdx, 'normalizer must be registered before the jsonRouter mount');
    });
});
