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
const BlockchainConnector = require('../../src/rpc/blockchain_connector');
const MockRpcServer = require('./helpers/MockRpcServer');

async function withServer(daemon, run) {
    const server = new MockRpcServer({ daemon });
    await server.start();
    const connector = new BlockchainConnector('127.0.0.1', String(server.port), 'rpcuser', 'rpcpass');
    try {
        await run(server, connector);
    } finally {
        await server.stop();
    }
}

describe('BlockchainConnector.flushNodeState @regression', function () {
    it('accepts an object gettxoutsetinfo result', async function () {
        await withServer('core31', async (server, connector) => {
            server.onMethod('gettxoutsetinfo').returns({ height: 101, txouts: 1 });
            await connector.flushNodeState(1000);
        });
    });

    it('rejects a Core 31 HTTP-200 JSON-RPC error with its diagnostics', async function () {
        await withServer('core31', async (server, connector) => {
            server
                .onMethod('gettxoutsetinfo')
                .failTimes(1, 'rpc', {
                    code: -28,
                    message: 'Loading block index',
                })
                .thenReturn({ height: 101 });
            await assert.rejects(
                connector.flushNodeState(1000),
                (err) => /Error flushing node state/.test(err.message) && /-28/.test(err.message),
            );
        });
    });

    it('keeps rejecting legacy HTTP errors and invalid successful results', async function () {
        await withServer('legacy', async (server, connector) => {
            server
                .onMethod('gettxoutsetinfo')
                .failTimes(1, 'rpc', { code: -28, message: 'warming up' })
                .thenReturn(null);
            await assert.rejects(connector.flushNodeState(1000), /Error flushing node state/);
            await assert.rejects(connector.flushNodeState(1000), /object result/);
        });
    });
});
