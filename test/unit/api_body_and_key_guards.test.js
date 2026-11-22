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
const { timingSafeStringEqual } = require('../../src/api/auth');
const { mountJsonRpc } = require('../../src/api');

function dispatcherFor(controller) {
    const middleware = [];
    mountJsonRpc({ use: (handler) => middleware.push(handler) }, controller);
    assert.strictEqual(middleware.length, 1);
    return middleware[0];
}

function responseRecorder() {
    return {
        body: undefined,
        json(value) {
            this.body = value;
            return this;
        },
        send(value) {
            this.body = value;
            return this;
        },
    };
}

describe('api.js', function () {
    describe('timingSafeStringEqual', function () {
        it('returns true for two equal strings', function () {
            assert.strictEqual(timingSafeStringEqual('secret-key', 'secret-key'), true);
        });

        it('returns false for two different strings of the same length', function () {
            assert.strictEqual(timingSafeStringEqual('secret-key', 'secret-koy'), false);
        });

        it('returns false for strings of different length rather than throwing', function () {
            assert.strictEqual(timingSafeStringEqual('short', 'a-much-longer-value'), false);
        });

        it('treats a missing header (undefined) as the empty string and fails closed', function () {
            assert.strictEqual(timingSafeStringEqual(undefined, 'secret-key'), false);
        });
    });
});

describe('api.js', function () {
    describe('JSON-RPC body handling', function () {
        it('answers an undefined body with Invalid Request', async function () {
            const req = {};
            const res = responseRecorder();
            await dispatcherFor({})(req, res);
            assert.strictEqual(res.body.error.code, -32600);
            assert.strictEqual(res.body.id, null);
        });

        it('dispatches an already-populated body without rewriting it', async function () {
            const body = { jsonrpc: '2.0', method: 'ping', id: 1 };
            const req = { body };
            const res = responseRecorder();
            await dispatcherFor({ ping: async () => 'pong' })(req, res);
            assert.strictEqual(req.body, body);
            assert.strictEqual(res.body.result, 'pong');
        });
    });
});

describe('api.js', function () {
    describe('JSON-RPC params handling', function () {
        it('passes explicit null params to a handler as an empty object', async function () {
            let seen;
            const req = { body: { jsonrpc: '2.0', method: 'send_funds', params: null, id: 1 } };
            const res = responseRecorder();
            await dispatcherFor({
                send_funds: async (params) => {
                    seen = params;
                },
            })(req, res);
            assert.deepStrictEqual(seen, {});
        });

        it('passes null params as empty objects for every batch entry', async function () {
            const seen = [];
            const req = {
                body: [
                    { jsonrpc: '2.0', method: 'ping', params: null, id: 1 },
                    { jsonrpc: '2.0', method: 'status', params: null, id: 2 },
                ],
            };
            const res = responseRecorder();
            await dispatcherFor({
                ping: async (params) => {
                    seen.push(params);
                },
                status: async (params) => {
                    seen.push(params);
                },
            })(req, res);
            assert.deepStrictEqual(seen, [{}, {}]);
        });

        it('passes structured params through without rewriting them', async function () {
            const params = { address: 'a', amount: 1 };
            let seen;
            const req = { body: { jsonrpc: '2.0', method: 'send_funds', params, id: 1 } };
            const res = responseRecorder();
            await dispatcherFor({
                send_funds: async (value) => {
                    seen = value;
                },
            })(req, res);
            assert.strictEqual(seen, params);
        });
    });
});

describe('api.js', function () {
    describe('mountJsonRpc method dispatch', function () {
        const express = require('express');
        const http = require('http');
        let server;
        let port;

        before(async function () {
            const app = express();
            app.use(express.json());
            mountJsonRpc(app, { ping: async () => 'pong' });
            await new Promise((resolve) => {
                server = app.listen(0, '127.0.0.1', resolve);
            });
            port = server.address().port;
        });

        after(function () {
            return new Promise((resolve) => server.close(resolve));
        });

        function post(body) {
            return new Promise((resolve, reject) => {
                const req = http.request(
                    { host: '127.0.0.1', port, method: 'POST', headers: { 'Content-Type': 'application/json' } },
                    (res) => {
                        let data = '';
                        res.on('data', (c) => (data += c));
                        res.on('end', () => resolve(JSON.parse(data)));
                    },
                );
                req.on('error', reject);
                req.end(body);
            });
        }

        for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', 'toLocaleString']) {
            it(`refuses Object.prototype name ${name} with -32601 and no result`, async function () {
                const reply = await post(`{"jsonrpc":"2.0","method":"${name}","params":{"probe":1},"id":1}`);
                assert.ok(reply.error, 'expected an error member');
                assert.strictEqual(reply.error.code, -32601);
                assert.ok(!('result' in reply));
            });
        }

        it('still dispatches a real method', async function () {
            const reply = await post('{"jsonrpc":"2.0","method":"ping","params":{},"id":1}');
            assert.strictEqual(reply.result, 'pong');
        });
    });
});
