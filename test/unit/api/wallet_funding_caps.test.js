// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

'use strict';

const assert = require('assert');
const sinon = require('sinon');

const XChainRegtestMiner = require('../../../src/XChainRegtestMiner');
const { createRpcMethods } = require('../../../src/api/rpc_methods');

const CONFIG_KEYS = ['MINER_WALLET_FUNDED_FLOOR', 'MINER_SEND_FUNDS_MAX_AMOUNT'];
let savedConfig;
let miner;

function reportsBelowConfiguredFloor() {
    process.env.MINER_WALLET_FUNDED_FLOOR = '2.5';
    miner.balance = 2.49;

    assert.strictEqual(miner.getStatus().wallet_funded, false);

    miner.balance = 2.5;
    assert.strictEqual(miner.getStatus().wallet_funded, true);
}

async function refusesAboveConfiguredCap() {
    process.env.MINER_SEND_FUNDS_MAX_AMOUNT = '3';
    const controller = createRpcMethods(miner);

    const result = await controller.send_funds({ address: 'bcrt1qdestination', amount: 3.01 });

    assert.deepStrictEqual(result, {
        error:
            'There was a problem sending funds: send_funds amount 3.01 exceeds the configured per-call maximum ' +
            'of 3 coins (MINER_SEND_FUNDS_MAX_AMOUNT)',
    });
    assert.strictEqual(miner.connector.sendToAddress.callCount, 0);
}

async function allowsConfiguredCap() {
    process.env.MINER_SEND_FUNDS_MAX_AMOUNT = '3';

    assert.strictEqual(await miner.sendFundsToAddress('bcrt1qdestination', 3), 'txid');
    assert.strictEqual(miner.connector.sendToAddress.callCount, 1);
}

async function usesSafeDefaults() {
    miner.balance = 0.5;
    assert.strictEqual(miner.getStatus().wallet_funded, false);

    process.env.MINER_WALLET_FUNDED_FLOOR = '0';
    process.env.MINER_SEND_FUNDS_MAX_AMOUNT = '-1';
    assert.strictEqual(miner.getStatus().wallet_funded, false);
    await assert.rejects(() => miner.sendFundsToAddress('bcrt1qdestination', 100.01), /maximum of 100 coins/);
    assert.strictEqual(miner.connector.sendToAddress.callCount, 0);
}

describe('wallet funding floors and caps', function () {
    beforeEach(function () {
        savedConfig = Object.fromEntries(CONFIG_KEYS.map((key) => [key, process.env[key]]));
        for (const key of CONFIG_KEYS) delete process.env[key];

        miner = new XChainRegtestMiner('bitcoin-regtest', 'localhost', '18332', 'user', 'pass');
        miner.connector = {
            sendToAddress: sinon.stub().resolves('txid'),
        };
    });

    afterEach(function () {
        for (const key of CONFIG_KEYS) {
            if (savedConfig[key] === undefined) delete process.env[key];
            else process.env[key] = savedConfig[key];
        }
        sinon.restore();
    });

    it('reports wallet_funded false below the configured floor', reportsBelowConfiguredFloor);

    it(
        'returns a clear reason without calling the node when send_funds exceeds the configured per-call cap',
        refusesAboveConfiguredCap,
    );

    it('allows send_funds at the configured per-call cap', allowsConfiguredCap);

    it('uses safe defaults for missing or invalid configuration', usesSafeDefaults);
});
