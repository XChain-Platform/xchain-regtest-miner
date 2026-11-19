// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

const assert = require('assert');
const sinon = require('sinon');

const XChainRegtestMiner = require('../../../src/XChainRegtestMiner');

function walletMissing(message) {
    const err = new Error(message);
    err.walletMissing = true;
    return err;
}

function loadMissing() {
    const err = new Error('wallet not found');
    err.rpcCode = -18;
    return err;
}

function deferred() {
    let resolve;
    const promise = new Promise((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

function makeMiner(connector) {
    const miner = new XChainRegtestMiner('bitcoin-regtest', undefined, '18332', 'user', 'pass');
    miner.connector = connector;
    miner.walletAddress = 'old-address';
    miner.walletReady = true;
    sinon.stub(miner, 'sleep').resolves();
    return miner;
}

function baseConnector() {
    return {
        getBalance: sinon.stub(),
        loadWallet: sinon.stub(),
        createWallet: sinon.stub().resolves(true),
        listWallets: sinon.stub().resolves([]),
        setWalletName: sinon.stub(),
        getNewAddress: sinon.stub().resolves('new-address'),
        generateToAddress: sinon.stub().resolves(Array(101).fill('hash')),
        getBlockCount: sinon.stub().resolves(0),
        sendToAddress: sinon.stub(),
    };
}

function registerHooks() {
    beforeEach(function () {
        sinon.stub(console, 'log');
        sinon.stub(console, 'warn');
        sinon.stub(console, 'error');
    });

    afterEach(function () {
        sinon.restore();
    });
}

describe('runtime wallet recreation readiness', function () {
    registerHooks();

    it('replaces the mining address and withholds readiness until maturity', async function () {
        const mine = deferred();
        const connector = baseConnector();
        connector.getBalance.onFirstCall().rejects(walletMissing('balance wallet missing'));
        connector.getBalance.onSecondCall().resolves(0);
        connector.getBalance.onThirdCall().resolves(50);
        connector.loadWallet.rejects(loadMissing());
        connector.generateToAddress.returns(mine.promise);
        const miner = makeMiner(connector);

        assert.strictEqual(await miner.refreshWalletFunds(), null);
        await new Promise((resolve) => setImmediate(resolve));
        assert.strictEqual(miner.walletReady, false);
        assert.strictEqual(miner.walletAddress, 'new-address');
        assert.ok(connector.generateToAddress.calledOnceWith(101, 'new-address'));

        mine.resolve(Array(101).fill('hash'));
        await miner.walletReloadInFlight;
        assert.strictEqual(miner.walletReady, true);
        assert.strictEqual(miner.balance, 50);
    });

    it('keeps the address and readiness when the existing wallet only needed loading', async function () {
        const connector = baseConnector();
        connector.getBalance.rejects(walletMissing('balance wallet missing'));
        connector.loadWallet.resolves(true);
        const miner = makeMiner(connector);

        assert.strictEqual(await miner.refreshWalletFunds(), null);
        await miner.walletReloadInFlight;

        assert.strictEqual(miner.walletAddress, 'old-address');
        assert.strictEqual(miner.walletReady, true);
        assert.ok(connector.getNewAddress.notCalled);
        assert.ok(connector.generateToAddress.notCalled);
    });
});

describe('runtime wallet recreation concurrency', function () {
    registerHooks();

    it('shares one recreate and maturity run between balance and send recovery', async function () {
        const load = deferred();
        const connector = baseConnector();
        connector.getBalance.onFirstCall().rejects(walletMissing('balance wallet missing'));
        connector.getBalance.onSecondCall().resolves(0);
        connector.getBalance.onThirdCall().resolves(50);
        connector.loadWallet.returns(load.promise);
        connector.sendToAddress.onFirstCall().rejects(walletMissing('send wallet missing'));
        connector.sendToAddress.onSecondCall().resolves('txid');
        const miner = makeMiner(connector);

        await miner.refreshWalletFunds();
        const send = miner.sendFundsToAddress('destination', 1);
        await new Promise((resolve) => setImmediate(resolve));
        load.resolve(Promise.reject(loadMissing()));

        assert.strictEqual(await send, 'txid');
        assert.strictEqual(connector.loadWallet.callCount, 1);
        assert.strictEqual(connector.createWallet.callCount, 1);
        assert.strictEqual(connector.generateToAddress.callCount, 1);
    });
});
