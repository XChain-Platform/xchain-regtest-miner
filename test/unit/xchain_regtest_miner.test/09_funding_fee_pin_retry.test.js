// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
//
// Only a method-not-found proves settxfee is gone; a transient failure is
// retried, a refusal never switches a send to the named fee_rate form, and an
// unreachable settxfee switches only a coin known to accept fee_rate.

const assert = require('assert');
const sinon = require('sinon');
const XChainRegtestMiner = require('../../../src/XChainRegtestMiner');
const {
    FUNDING_FEE_RATE_SAT_PER_VB,
    PER_CALL_FEE_RATE_COINS,
    SETTXFEE_COINS,
    FEE_RATE_REFUSING_COINS,
} = require('../../../src/XChainRegtestMiner/constants');
const { COIN_FULL_NAME } = require('../../../src/coins');

let connector;

// Builds a miner on `network` whose retry sleeps return at once.
function minerFor(network) {
    const miner = new XChainRegtestMiner(network, undefined, '18332', 'user', 'pass');
    miner.connector = connector;
    sinon.stub(miner, 'sleep').resolves();
    return miner;
}

// A classified settxfee failure, shaped as the connector throws it.
function settxfeeError(fields) {
    return Object.assign(new Error('Error setting wallet fee'), fields);
}

function settxfeeRetryTests() {
    it('retries a timed-out settxfee and keeps the wallet-wide pin', async function () {
        connector.setTxFee.onFirstCall().rejects(settxfeeError({ timedOut: true }));
        const miner = minerFor('dogecoin-regtest');

        assert.strictEqual(await miner.pinFundingFeeRate(), 'settxfee');
        assert.strictEqual(connector.setTxFee.callCount, 2);
    });

    it('never picks fee_rate on a bare network when settxfee keeps failing in transport', async function () {
        connector.setTxFee.rejects(settxfeeError({}));
        const miner = minerFor('regtest');

        assert.strictEqual(await miner.pinFundingFeeRate(), 'none');
        assert.ok(connector.setTxFee.callCount > 1, 'a transport failure must be retried');
        await miner.sendFundsToAddress('addr', 1.0);
        assert.ok(!connector.sendToAddress.firstCall.args[2]);
    });

    it('keeps the positional form when the daemon refuses settxfee with another code', async function () {
        connector.setTxFee.rejects(settxfeeError({ rpcCode: -8 }));
        const miner = minerFor('regtest');

        assert.strictEqual(await miner.pinFundingFeeRate(), 'none');
        assert.ok(connector.setTxFee.calledOnce, 'a refusal repeats on every try');
    });

    it('never throws out of the pin when settxfee keeps timing out', async function () {
        connector.setTxFee.rejects(settxfeeError({ timedOut: true }));
        const miner = minerFor('litecoin-regtest');

        assert.strictEqual(await miner.pinFundingFeeRate(), 'fee_rate');
        assert.strictEqual(miner.fundingFeeRateSatPerVb, FUNDING_FEE_RATE_SAT_PER_VB);
        assert.strictEqual(connector.setTxFee.callCount, 3);
        await miner.sendFundsToAddress('addr', 1.0);
        assert.ok(
            connector.sendToAddress.firstCall.args[2] > 0,
            'LTC accepts fee_rate, so an unreachable settxfee must not leave the send uncapped',
        );
    });
}

// A refusal is about the rate itself, so only an unreachable settxfee moves a coin to fee_rate.
function settxfeeRefusedOrUnreachablePerCoinTests() {
    it('keeps a Dogecoin daemon on the positional form when settxfee stays unreachable', async function () {
        connector.setTxFee.rejects(settxfeeError({ timedOut: true }));
        const miner = minerFor('dogecoin-regtest');

        assert.strictEqual(await miner.pinFundingFeeRate(), 'none');
        await miner.sendFundsToAddress('addr', 1.0);
        assert.ok(!connector.sendToAddress.firstCall.args[2], 'DOGE v1.14 refuses fee_rate');
    });

    it('keeps a Litecoin daemon on the positional form when it refuses settxfee', async function () {
        connector.setTxFee.rejects(settxfeeError({ rpcCode: -8 }));
        const miner = minerFor('litecoin-regtest');

        assert.strictEqual(await miner.pinFundingFeeRate(), 'none');
        assert.ok(connector.setTxFee.calledOnce, 'a refusal repeats on every try');
        await miner.sendFundsToAddress('addr', 1.0);
        assert.ok(!connector.sendToAddress.firstCall.args[2], 'a refused rate is not retried per call');
    });

    it('keeps a Litecoin daemon on the positional form when settxfee answers without pinning', async function () {
        connector.setTxFee.resolves(false);
        const miner = minerFor('litecoin-regtest');

        assert.strictEqual(await miner.pinFundingFeeRate(), 'none');
        assert.strictEqual(miner.fundingFeeRateSatPerVb, null);
    });
}

// Each list decides one branch of the pin, so a registered coin must sit in exactly one path class.
function feePinCoinClassTests() {
    const registered = Object.values(COIN_FULL_NAME).sort();

    it('puts every registered coin in exactly one of the per-call and settxfee lists', function () {
        for (const coin of PER_CALL_FEE_RATE_COINS) {
            assert.ok(!SETTXFEE_COINS.includes(coin), coin + ' is in both PER_CALL_FEE_RATE_COINS and SETTXFEE_COINS');
        }
        assert.deepStrictEqual(
            [...PER_CALL_FEE_RATE_COINS, ...SETTXFEE_COINS].sort(),
            registered,
            'every registered coin belongs in PER_CALL_FEE_RATE_COINS or SETTXFEE_COINS, and no other name does',
        );
    });

    it('lists only settxfee coins as refusing fee_rate', function () {
        for (const coin of FEE_RATE_REFUSING_COINS) {
            assert.ok(
                SETTXFEE_COINS.includes(coin),
                coin + ' refuses fee_rate, so it must keep settxfee (add it to SETTXFEE_COINS)',
            );
        }
    });
}

// The method-not-found fallback is decided by whether the daemon takes fee_rate, not by coin history.
function settxfeeMissingPerCoinTests() {
    it('moves a Litecoin daemon that dropped settxfee to the per-call rate', async function () {
        connector.setTxFee.rejects(settxfeeError({ rpcCode: -32601 }));
        const miner = minerFor('litecoin-regtest');

        assert.strictEqual(await miner.pinFundingFeeRate(), 'fee_rate');
        await miner.sendFundsToAddress('addr', 1.0);
        const rate = connector.sendToAddress.firstCall.args[2];
        assert.ok(
            rate > 0,
            'LTC accepts fee_rate, so a dropped settxfee must not leave the send uncapped, got ' + rate,
        );
    });

    it('keeps a Dogecoin daemon without settxfee on the positional form', async function () {
        connector.setTxFee.rejects(settxfeeError({ rpcCode: -32601 }));
        const miner = minerFor('dogecoin-regtest');

        assert.strictEqual(await miner.pinFundingFeeRate(), 'none');
        await miner.sendFundsToAddress('addr', 1.0);
        assert.ok(!connector.sendToAddress.firstCall.args[2], 'DOGE v1.14 refuses fee_rate');
    });
}

describe('XChainRegtestMiner', function () {
    beforeEach(function () {
        connector = {
            setTxFee: sinon.stub().resolves(true),
            sendToAddress: sinon.stub().resolves('txid_abc'),
        };
        sinon.stub(console, 'log');
        sinon.stub(console, 'error');
    });

    afterEach(function () {
        sinon.restore();
    });

    describe('funding fee pin retry', settxfeeRetryTests);
    describe('funding fee pin when settxfee is refused or unreachable', settxfeeRefusedOrUnreachablePerCoinTests);
    describe('funding fee pin when settxfee is missing', settxfeeMissingPerCoinTests);
    describe('funding fee pin coin classes', feePinCoinClassTests);
});
