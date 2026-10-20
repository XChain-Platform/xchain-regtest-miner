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
 * E2E Tests: Funding fee pin per daemon
 *
 * Drives both fee-pin mechanisms (per-call fee_rate on Bitcoin Core 31,
 * wallet-wide settxfee on the legacy daemons) over HTTP against the
 * stateful mock node.
 */

const assert = require('assert');
const sinon = require('sinon');
const {
    FUNDING_FEE_RATE_SAT_PER_VB,
    FUNDING_FEE_RATE_COINS_PER_KB,
} = require('../../src/XChainRegtestMiner/constants');
const { DEST, withNode, createMiner, rawRpc, fundedNode } = require('./helpers/fee_pin_fixtures');

// Sends one funding payment and asserts it carried the per-call fee_rate. Resolves the txid.
async function sendAndAssertPerCallFeeRate(node, miner) {
    const txid = await miner.sendFundsToAddress(DEST, 1.0);
    assert.strictEqual(typeof txid, 'string');
    assert.deepStrictEqual(node.callsFor('sendtoaddress')[0].params, {
        address: DEST,
        amount: 1.0,
        fee_rate: FUNDING_FEE_RATE_SAT_PER_VB,
    });
    return txid;
}

describe('E2E: Funding fee pin per daemon', function () {
    beforeEach(function () {
        sinon.stub(console, 'log');
        sinon.stub(console, 'error');
    });

    afterEach(function () {
        sinon.restore();
    });

    it('pins BTC per call on Core 31 and never calls the deleted settxfee', async function () {
        await withNode('core31', async (node) => {
            await fundedNode(node);
            const miner = createMiner('bitcoin-regtest', node);
            await miner.prepareWallet();

            assert.strictEqual(node.callsFor('settxfee').length, 0);
            assert.strictEqual(miner.fundingFeeRateSatPerVb, FUNDING_FEE_RATE_SAT_PER_VB);

            const txid = await sendAndAssertPerCallFeeRate(node, miner);
            assert.ok(node.mempool.some((m) => m.txid === txid));
        });
    });

    it('falls back to the per-call rate when a bare network meets a Core 31 node', async function () {
        await withNode('core31', async (node) => {
            await fundedNode(node);
            const miner = createMiner('regtest', node);
            await miner.prepareWallet();

            assert.strictEqual(node.callsFor('settxfee').length, 1);
            assert.strictEqual(miner.fundingFeeRateSatPerVb, FUNDING_FEE_RATE_SAT_PER_VB);

            await sendAndAssertPerCallFeeRate(node, miner);
        });
    });

    it('keeps the wallet-wide settxfee pin and positional sends on a legacy daemon', async function () {
        await withNode('legacy', async (node) => {
            await fundedNode(node);
            const miner = createMiner('litecoin-regtest', node);
            await miner.prepareWallet();

            assert.strictEqual(node.callsFor('settxfee').length, 1);
            assert.deepStrictEqual(node.callsFor('settxfee')[0].params, [FUNDING_FEE_RATE_COINS_PER_KB]);
            assert.strictEqual(miner.fundingFeeRateSatPerVb, null);

            const txid = await miner.sendFundsToAddress(DEST, 1.0);
            assert.strictEqual(typeof txid, 'string');
            assert.ok(node.mempool.some((m) => m.txid === txid));
            assert.deepStrictEqual(node.callsFor('sendtoaddress')[0].params, [DEST, 1.0]);
        });
    });
});

describe('E2E: Funding fee pin on a Dogecoin 1.14 node', function () {
    beforeEach(function () {
        sinon.stub(console, 'log');
        sinon.stub(console, 'error');
    });

    afterEach(function () {
        sinon.restore();
    });

    it('keeps the settxfee pin and positional sends for dogecoin-regtest', async function () {
        await testSettxfeePinOnDoge('dogecoin-regtest');
    });

    it('keeps a bare network on the settxfee pin', async function () {
        await testSettxfeePinOnDoge('regtest');
    });

    it('prepares a fresh node without any multi-wallet RPC', async function () {
        await withNode('doge114', async (node) => {
            const miner = createMiner('dogecoin-regtest', node);
            sinon.stub(miner, 'sleep').resolves();
            await miner.prepareWallet();

            for (const method of ['createwallet', 'loadwallet', 'listwallets']) {
                assert.deepStrictEqual(node.callsFor(method), [], method);
            }
            assert.ok(typeof miner.walletAddress === 'string' && miner.walletAddress.length > 0);
            assert.strictEqual(miner.walletReady, true);
            assert.deepStrictEqual(
                node.callsFor('settxfee').map((c) => c.params),
                [[FUNDING_FEE_RATE_COINS_PER_KB]],
            );
        });
    });

    it('fails fast when the load path is forced on a node without loadwallet', async function () {
        await withNode('doge114', async (node) => {
            const miner = createMiner('dogecoin-regtest', node);
            sinon.stub(miner, 'sleep').resolves();
            await assert.rejects(miner.ensureWalletLoaded(), /Could not create wallet .*Dogecoin v1\.14/);
            assert.strictEqual(node.callsFor('loadwallet').length, 1);
        });
    });
});

// Prepares a miner for `network` against a doge114 node and sends one funding payment.
async function testSettxfeePinOnDoge(network) {
    await withNode('doge114', async (node) => {
        await fundedNode(node);
        const miner = createMiner(network, node);
        await miner.prepareWallet();

        assert.deepStrictEqual(
            node.callsFor('settxfee').map((c) => c.params),
            [[FUNDING_FEE_RATE_COINS_PER_KB]],
        );
        assert.strictEqual(miner.fundingFeeRateSatPerVb, null);

        const txid = await miner.sendFundsToAddress(DEST, 1.0);
        assert.ok(node.mempool.some((m) => m.txid === txid));
        assert.deepStrictEqual(node.callsFor('sendtoaddress')[0].params, [DEST, 1.0]);
    });
}

const WALLET_URI = '/wallet/xchain_regtest_wallet';

// Prepare through the load path so sends target the pinned /wallet/<name> URI.
async function preparedMiner(network, node) {
    await fundedNode(node);
    node.unloadWallet();
    const miner = createMiner(network, node);
    sinon.stub(miner, 'sleep').resolves();
    await miner.prepareWallet();
    node.calls = [];
    return miner;
}

async function testLegacyErrorTransport() {
    await withNode('legacy', async (node) => {
        const lost = await rawRpc(node, WALLET_URI, {
            jsonrpc: '2.0',
            method: 'sendtoaddress',
            params: [DEST, 1],
            id: 7,
        });
        assert.strictEqual(lost.status, 500);
        assert.deepStrictEqual(lost.body, {
            result: null,
            error: { code: -18, message: 'Requested wallet does not exist or is not loaded' },
            id: 7,
        });
        const unknown = await rawRpc(node, '/', { jsonrpc: '2.0', method: 'nosuchmethod', params: [], id: 8 });
        assert.strictEqual(unknown.status, 404);
        assert.strictEqual(unknown.body.error.code, -32601);
    });
}

async function testCore31ErrorTransport() {
    await withNode('core31', async (node) => {
        const declared = await rawRpc(node, WALLET_URI, {
            jsonrpc: '2.0',
            method: 'sendtoaddress',
            params: [DEST, 1],
            id: 7,
        });
        assert.strictEqual(declared.status, 200);
        assert.deepStrictEqual(declared.body, {
            jsonrpc: '2.0',
            error: { code: -18, message: 'Requested wallet does not exist or is not loaded' },
            id: 7,
        });
        // Core 28+ keeps the legacy transport for a request that does not declare 2.0.
        const undeclared = await rawRpc(node, '/', { method: 'settxfee', params: [0.001], id: 8 });
        assert.strictEqual(undeclared.status, 404);
        assert.strictEqual(undeclared.body.result, null);
    });
}

async function testRecoveryOverDaemonTransport(daemon, network, settxfeeCalls) {
    await withNode(daemon, async (node) => {
        const miner = await preparedMiner(network, node);
        node.unloadWallet();

        const txid = await miner.sendFundsToAddress(DEST, 1.0);
        assert.strictEqual(typeof txid, 'string');
        assert.ok(node.mempool.some((m) => m.txid === txid));
        assert.strictEqual(node.callsFor('sendtoaddress').length, 2);
        assert.strictEqual(node.callsFor('loadwallet').length, 1);
        assert.strictEqual(node.callsFor('settxfee').length, settxfeeCalls);
    });
}

describe('E2E: RPC error transport per daemon', function () {
    beforeEach(function () {
        sinon.stub(console, 'log');
        sinon.stub(console, 'error');
    });

    afterEach(function () {
        sinon.restore();
    });

    it('answers RPC errors with HTTP 500 and method-not-found with 404 in legacy mode', testLegacyErrorTransport);
    it('answers a declared JSON-RPC 2.0 error with HTTP 200 in core31 mode', testCore31ErrorTransport);
    it('reloads a wallet lost to a restart when the daemon reports it with HTTP 500', async function () {
        await testRecoveryOverDaemonTransport('legacy', 'litecoin-regtest', 1);
    });
    it('reloads a wallet lost to a restart when the daemon reports it with HTTP 200', async function () {
        await testRecoveryOverDaemonTransport('core31', 'bitcoin-regtest', 0);
    });
});
