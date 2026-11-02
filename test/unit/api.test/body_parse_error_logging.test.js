// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

'use strict';

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
                res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], data }));
            },
        );
        req.on('error', reject);
        req.end(body);
    });
}

describe('body parse error logging', function () {
    let server;
    let lines;
    let port;
    let stderrWrites;
    let origErr;

    beforeEach(async function () {
        lines = [];
        stderrWrites = [];
        const logger = {
            log: (m) => lines.push(String(m)),
            error: (m) => lines.push(String(m)),
        };
        const app = createApiApp(logger);
        app.post('/', (req, res) => res.json({ ok: true }));
        // Express's default final handler prints err.stack through console.error.
        origErr = console.error;
        console.error = (...a) => stderrWrites.push(a.join(' '));
        await new Promise((r) => {
            server = app.listen(0, '127.0.0.1', r);
        });
        port = server.address().port;
    });

    afterEach(async function () {
        console.error = origErr;
        await new Promise((r) => server.close(r));
    });

    function assertQuiet() {
        const all = lines.concat(stderrWrites).join('\n');
        assert.ok(!/\n\s+at /.test(all), 'no stack frames in log output: ' + all);
        assert.ok(!/SyntaxError|PayloadTooLargeError/.test(all), 'no raw parser error in log output: ' + all);
        assert.ok(lines.length + stderrWrites.length <= 1, 'at most one log line');
    }

    it('answers malformed JSON with a JSON 400 and no stack trace', async function () {
        const res = await post(port, 'not json');
        assert.strictEqual(res.status, 400);
        assert.ok(/json/.test(res.type), 'JSON error body, got ' + res.type);
        assertQuiet();
    });

    it('answers an oversized body with a JSON 413 and no stack trace', async function () {
        const res = await post(port, JSON.stringify({ pad: 'x'.repeat(200 * 1024) }));
        assert.strictEqual(res.status, 413);
        assert.ok(/json/.test(res.type), 'JSON error body, got ' + res.type);
        assertQuiet();
    });
});
