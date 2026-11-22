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
 *********************************************************************/

const assert = require('assert');
const http = require('http');
const { createApiApp } = require('../../../src/api/startup');

function post(port, body) {
    return new Promise((resolve, reject) => {
        const req = http.request(
            { host: '127.0.0.1', port, method: 'POST', path: '/', headers: { 'Content-Type': 'application/json' } },
            (res) => {
                let data = '';
                res.on('data', (c) => (data += c));
                res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', data }));
            },
        );
        req.on('error', reject);
        req.end(body);
    });
}

describe('body parser errors are JSON and leak no stack', function () {
    let server;
    let port;

    beforeEach(async function () {
        const app = createApiApp({ log() {}, error() {} });
        app.post('/', (req, res) => res.json({ reached: true, body: req.body }));
        await new Promise((r) => {
            server = app.listen(0, '127.0.0.1', r);
        });
        port = server.address().port;
    });

    afterEach(async function () {
        await new Promise((r) => server.close(r));
    });

    function assertNoLeak(res) {
        assert.ok(/application\/json/.test(res.type), 'JSON content type, got ' + res.type);
        const parsed = JSON.parse(res.data);
        assert.ok(parsed.error, 'error field present');
        assert.ok(!/SyntaxError|PayloadTooLarge|node_modules|<pre>|\n\s*at /.test(res.data), 'no leak: ' + res.data);
    }

    for (const [name, body] of [
        ['not json', 'not json'],
        ['null', 'null'],
        ['bare string', '"status"'],
    ]) {
        it('refuses ' + name + ' with a JSON 400', async function () {
            const res = await post(port, body);
            assert.strictEqual(res.status, 400);
            assertNoLeak(res);
        });
    }

    it('refuses a body over 100 KB with a JSON 413', async function () {
        const res = await post(port, JSON.stringify({ pad: 'x'.repeat(200 * 1024) }));
        assert.strictEqual(res.status, 413);
        assertNoLeak(res);
    });

    it('still delivers a valid JSON body to the handler', async function () {
        const res = await post(port, JSON.stringify({ a: 1 }));
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { reached: true, body: { a: 1 } });
    });
});
