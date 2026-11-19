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
 * Chaos Tests: CE-07: a connection reset during generatetoaddress
 *
 * A reset arrives with no node reply, so the node may still be mining.
 * The miner holds its queue slot until the node stops, while a node that
 * answered with a refusal does not hold it.
 */

const assert = require('assert');
const sinon = require('sinon');
const ChaosNode = require('./helpers/ChaosNode');
const { createMiner } = require('./helpers/chaosSetup');

const QUIET_WINDOW_READS = 100;

let node;

function destroySocket(params, res) {
    res.socket.destroy();
}

function refuse(params, res, id) {
    res.json({ jsonrpc: '2.0', result: null, error: { code: -1, message: 'refused' }, id });
}

describe('Chaos: generatetoaddress connection reset (CE-07)', function () {
    before(async function () {
        node = new ChaosNode();
        await node.start();
        sinon.stub(console, 'log');
        sinon.stub(console, 'error');
    });

    after(async function () {
        sinon.restore();
        await node.stop();
    });

    beforeEach(function () {
        node.reset();
        node._rpc_createwallet(['xchain_regtest_wallet']);
        node.calls = [];
    });

    it('CE-07a: a reset mine waits for the node to go quiet before the queue is released', async function () {
        const miner = createMiner(node);
        miner.walletAddress = 'bcrt1qseed';
        node.interceptMethod('generatetoaddress', destroySocket);

        const err = await miner.generateBlocksQueued(1).catch((e) => e);
        await miner.pauseMining();

        assert.strictEqual(err.executionUncertain, true);
        assert.ok(
            node.callsFor('getblockchaininfo').length >= QUIET_WINDOW_READS,
            'the failed mine must keep reading the node until its height holds still',
        );
    });

    it('CE-07b: a refused mine reads the height once and releases the queue', async function () {
        const miner = createMiner(node);
        miner.walletAddress = 'bcrt1qseed';
        node.interceptMethod('generatetoaddress', refuse);

        const err = await miner.generateBlocksQueued(1).catch((e) => e);
        await miner.pauseMining();

        assert.strictEqual(err.executionUncertain, undefined);
        assert.ok(node.callsFor('getblockchaininfo').length < QUIET_WINDOW_READS);
    });
});
