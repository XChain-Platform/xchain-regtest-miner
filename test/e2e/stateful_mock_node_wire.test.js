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
 **********************************************************************
 * E2E Tests: StatefulMockNode wire contract
 *
 * Pins the mock node's own RPC answers to the daemon shapes it stands in for
 * (Bitcoin Core 31, the legacy daemons and Dogecoin 1.14) so the double
 * cannot drift from them.
 */

const assert = require('assert');
const StatefulMockNode = require('./helpers/StatefulMockNode');
const { DEST, withNode, rpc, fundedNode, rawRpc } = require('./helpers/fee_pin_fixtures');

// Asserts doge114 refuses a named send carrying `extra` and leaves the mempool empty.
async function assertDogeRefusesNamedArg(extra) {
    await withNode('doge114', async (node) => {
        await fundedNode(node);
        const params = Object.assign({ address: DEST, amount: 1.0 }, extra);
        const reply = await rawRpc(node, '/', { jsonrpc: '2.0', method: 'sendtoaddress', params, id: 3 });
        assert.strictEqual(reply.status, 500);
        assert.strictEqual(reply.body.error.code, -8);
        assert.match(reply.body.error.message, new RegExp('Unknown named parameter ' + Object.keys(extra)[0]));
        assert.strictEqual(node.mempool.length, 0);
    });
}

// Asserts a fresh node answers base-URL wallet calls with -18 in `daemon`'s transport.
async function assertNoWalletLoaded(daemon, status) {
    await withNode(daemon, async (node) => {
        for (const [method, params] of [
            ['getbalance', []],
            ['sendtoaddress', [DEST, 1]],
        ]) {
            const reply = await rawRpc(node, '/', { jsonrpc: '2.0', method, params, id: 4 });
            assert.strictEqual(reply.status, status, method);
            assert.strictEqual(reply.body.error.code, -18, method);
            assert.match(reply.body.error.message, /no wallet is loaded/i);
        }
    });
}

describe('E2E: StatefulMockNode wire contract', function () {
    it('answers a positional sendtoaddress with a bare txid string', async function () {
        await withNode('legacy', async (node) => {
            await fundedNode(node);
            const body = await rpc(node, 'sendtoaddress', [DEST, 1.0]);
            assert.strictEqual(body.error, null);
            assert.strictEqual(typeof body.result, 'string');
            assert.ok(body.result.length > 0);
        });
    });

    it('answers a named sendtoaddress without verbose with a bare txid string', async function () {
        await withNode('core31', async (node) => {
            await fundedNode(node);
            const body = await rpc(node, 'sendtoaddress', { address: DEST, amount: 1.0, fee_rate: 100 });
            assert.strictEqual(typeof body.result, 'string');
        });
    });

    it('answers the verbose object only when verbose is requested', async function () {
        await withNode('core31', async (node) => {
            await fundedNode(node);
            const body = await rpc(node, 'sendtoaddress', { address: DEST, amount: 1.0, verbose: true });
            assert.strictEqual(typeof body.result, 'object');
            assert.strictEqual(typeof body.result.txid, 'string');
        });
    });

    it('rejects settxfee as method-not-found and reports 31.0.0 in core31 mode', async function () {
        await withNode('core31', async (node) => {
            const fee = await rpc(node, 'settxfee', [0.001]);
            assert.ok(!('result' in fee), 'a JSON-RPC 2.0 error reply carries no result member');
            assert.strictEqual(fee.error.code, -32601);

            const info = await rpc(node, 'getnetworkinfo', []);
            assert.ok(info.result.version >= 310000);
        });
    });

    it('honors settxfee in legacy mode', async function () {
        await withNode('legacy', async (node) => {
            const fee = await rpc(node, 'settxfee', [0.001]);
            assert.strictEqual(fee.result, true);
            assert.strictEqual(fee.error, null);
        });
    });

    it('keeps the daemon mode across reset and refuses an unknown one', async function () {
        const node = new StatefulMockNode({ daemon: 'core31' });
        node.reset();
        assert.strictEqual(node.daemon, 'core31');
        assert.strictEqual(new StatefulMockNode().daemon, 'legacy');
        assert.throws(() => new StatefulMockNode({ daemon: 'core30' }), /Unknown daemon/);
    });
});

describe('E2E: StatefulMockNode doge114 and no-wallet wire contract', function () {
    it('refuses a named fee_rate send in doge114 mode', async function () {
        await assertDogeRefusesNamedArg({ fee_rate: 100 });
    });

    it('refuses a named verbose send in doge114 mode', async function () {
        await assertDogeRefusesNamedArg({ verbose: true });
    });

    it('accepts a named address and amount and omits walletname in doge114 mode', async function () {
        await withNode('doge114', async (node) => {
            await fundedNode(node);
            const body = await rpc(node, 'sendtoaddress', { address: DEST, amount: 1.0 });
            assert.strictEqual(typeof body.result, 'string');
            const info = await rpc(node, 'getwalletinfo', []);
            assert.ok(!('walletname' in info.result));
        });
    });

    it('starts with its wallet loaded and refuses the multi-wallet RPCs over HTTP 404 in doge114 mode', async function () {
        await withNode('doge114', async (node) => {
            const balance = await rpc(node, 'getbalance', []);
            assert.strictEqual(typeof balance.result, 'number');
            for (const method of ['createwallet', 'loadwallet', 'listwallets']) {
                const reply = await rawRpc(node, '/', {
                    jsonrpc: '2.0',
                    method,
                    params: ['xchain_regtest_wallet'],
                    id: 5,
                });
                assert.strictEqual(reply.status, 404, method);
                assert.strictEqual(reply.body.error.code, -32601, method);
            }
        });
    });

    it('answers base-URL wallet calls with -18 over HTTP 500 when no wallet is loaded in legacy mode', async function () {
        await assertNoWalletLoaded('legacy', 500);
    });

    it('answers base-URL wallet calls with -18 over HTTP 200 when no wallet is loaded in core31 mode', async function () {
        await assertNoWalletLoaded('core31', 200);
    });
});
