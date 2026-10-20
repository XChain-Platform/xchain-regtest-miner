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
 * Fixtures for the fee-pin and wire-contract e2e suites: the stateful mock
 * node lifecycle, a miner pointed at it and raw JSON-RPC posts to it.
 */

const axios = require('axios');
const XChainRegtestMiner = require('../../../src/XChainRegtestMiner');
const StatefulMockNode = require('./StatefulMockNode');

const DEST = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';

async function withNode(daemon, fn) {
    const node = new StatefulMockNode({ daemon });
    await node.start();
    try {
        return await fn(node);
    } finally {
        await node.stop();
    }
}

function createMiner(network, node) {
    return new XChainRegtestMiner(network, '127.0.0.1', String(node.port), 'user', 'pass');
}

async function rpc(node, method, params) {
    const res = await axios.post(`http://127.0.0.1:${node.port}/`, { jsonrpc: '2.0', method, params, id: 1 });
    return res.data;
}

// Seeds a loaded, matured wallet so prepareWallet skips the fresh-node probe retries.
// doge114 already has its one wallet loaded and no createwallet, so it mines to its own address.
async function fundedNode(node) {
    let to = DEST;
    if (node.daemon === 'doge114') to = (await rpc(node, 'getnewaddress', [])).result;
    else await rpc(node, 'createwallet', ['xchain_regtest_wallet']);
    await rpc(node, 'generatetoaddress', [110, to]);
    node.calls = [];
}

// POST one RPC and resolve the raw HTTP reply whatever its status.
async function rawRpc(node, path, body) {
    const res = await axios.post(`http://127.0.0.1:${node.port}${path}`, body, { validateStatus: () => true });
    return { status: res.status, body: res.data };
}

module.exports = { DEST, withNode, createMiner, rpc, fundedNode, rawRpc };
