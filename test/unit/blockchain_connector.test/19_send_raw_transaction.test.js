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
const axios = require('axios');
const BlockchainConnector = require('../../../src/rpc/blockchain_connector');

let connector;
let axiosPostStub;

function setup() {
    connector = new BlockchainConnector('localhost', '18332', 'rpcuser', 'rpcpass');
    axiosPostStub = sinon.stub(axios, 'post');
    sinon.stub(connector, 'sleep').resolves();
    sinon.stub(console, 'error');
    sinon.stub(console, 'log');
}

function teardown() {
    sinon.restore();
}

function assertRpcCall(expectedMethod, expectedParams) {
    const [url, data, config] = axiosPostStub.firstCall.args;
    assert.strictEqual(url, 'http://localhost:18332');
    assert.strictEqual(data.jsonrpc, '2.0');
    assert.strictEqual(data.method, expectedMethod);
    assert.strictEqual(data.id, 1);
    if (expectedParams !== undefined) {
        assert.deepStrictEqual(data.params, expectedParams);
    }
    assert.deepStrictEqual(config.auth, { username: 'rpcuser', password: 'rpcpass' });
}

function rpcSuccess(result) {
    return { data: { result, error: null, id: 1 } };
}

// Every console.error line this test emitted, joined (the module logger writes there).
function loggedErrors() {
    return console.error
        .getCalls()
        .map((c) => c.args.join(' '))
        .join('\n');
}

function rpcNoResult() {
    return { data: { result: null, error: { code: -1, message: 'fail' }, id: 1 } };
}

describe('BlockchainConnector', function () {
    beforeEach(setup);
    afterEach(teardown);

    // ─── sendRawTransaction ─────────────────────────────────────────────

    describe('sendRawTransaction', function () {
        it('sends tx hex and returns txid', async function () {
            axiosPostStub.resolves(rpcSuccess('txid_result'));
            const result = await connector.sendRawTransaction('0200...');
            assert.strictEqual(result, 'txid_result');
            assertRpcCall('sendrawtransaction', ['0200...']);
        });

        it('throws and logs when result is falsy', async function () {
            axiosPostStub.resolves(rpcNoResult());
            await assert.rejects(() => connector.sendRawTransaction('hex'), /Error sending raw transaction/);
            assert.match(loggedErrors(), /sendrawtransaction RPC error: fail/);
        });

        it('throws on network error', async function () {
            axiosPostStub.rejects(new Error('refused'));
            await assert.rejects(() => connector.sendRawTransaction('hex'), /Error sending raw transaction/);
            assert.doesNotMatch(loggedErrors(), /sendrawtransaction RPC error/);
        });

        // Pre-JSON-RPC-2.0 daemons (LTC v0.21, DOGE v1.14) carry the rejection on HTTP 500.
        it('logs the node rejection reason from an HTTP 500 reply but throws a static message', async function () {
            const err = new Error('Request failed with status code 500');
            err.response = {
                status: 500,
                data: { result: null, error: { code: -26, message: 'dust' }, id: 1 },
            };
            axiosPostStub.rejects(err);
            await assert.rejects(() => connector.sendRawTransaction('hex'), /^Error: Error sending raw transaction$/);
            assert.match(loggedErrors(), /sendrawtransaction RPC error: dust/);
        });

        it('logs a 200 error reply once, not again from the catch', async function () {
            axiosPostStub.resolves(rpcNoResult());
            await assert.rejects(() => connector.sendRawTransaction('hex'), /^Error: Error sending raw transaction$/);
            const hits = loggedErrors().match(/sendrawtransaction RPC error/g) || [];
            assert.strictEqual(hits.length, 1);
        });
    });
});
