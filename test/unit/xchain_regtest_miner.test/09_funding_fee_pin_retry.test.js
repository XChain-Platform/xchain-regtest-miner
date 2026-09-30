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
// retried, and an undecided pin never switches a send to the named fee_rate form.

const assert = require('assert')
const sinon = require('sinon')
const XChainRegtestMiner = require('../../../src/XChainRegtestMiner')

let connector

// Builds a miner on `network` whose retry sleeps return at once.
function minerFor(network) {
    const miner = new XChainRegtestMiner(network, undefined, '18332', 'user', 'pass')
    miner.connector = connector
    sinon.stub(miner, 'sleep').resolves()
    return miner
}

// A classified settxfee failure, shaped as the connector throws it.
function settxfeeError(fields) {
    return Object.assign(new Error('Error setting wallet fee'), fields)
}

function settxfeeRetryTests() {
    it('retries a timed-out settxfee and keeps the wallet-wide pin', async function () {
        connector.setTxFee.onFirstCall().rejects(settxfeeError({ timedOut: true }))
        const miner = minerFor('dogecoin-regtest')

        assert.strictEqual(await miner.pinFundingFeeRate(), 'settxfee')
        assert.strictEqual(connector.setTxFee.callCount, 2)
    })

    it('never picks fee_rate on a bare network when settxfee keeps failing in transport', async function () {
        connector.setTxFee.rejects(settxfeeError({}))
        const miner = minerFor('regtest')

        assert.strictEqual(await miner.pinFundingFeeRate(), 'none')
        assert.ok(connector.setTxFee.callCount > 1, 'a transport failure must be retried')
        await miner.sendFundsToAddress('addr', 1.0)
        assert.ok(!connector.sendToAddress.firstCall.args[2])
    })

    it('keeps the positional form when the daemon refuses settxfee with another code', async function () {
        connector.setTxFee.rejects(settxfeeError({ rpcCode: -8 }))
        const miner = minerFor('regtest')

        assert.strictEqual(await miner.pinFundingFeeRate(), 'none')
        assert.ok(connector.setTxFee.calledOnce, 'a refusal repeats on every try')
    })

    it('never throws out of the pin when settxfee keeps timing out', async function () {
        connector.setTxFee.rejects(settxfeeError({ timedOut: true }))
        const miner = minerFor('litecoin-regtest')

        assert.strictEqual(await miner.pinFundingFeeRate(), 'none')
        assert.strictEqual(miner.fundingFeeRateSatPerVb, null)
    })
}

describe('XChainRegtestMiner', function () {
    beforeEach(function () {
        connector = {
            setTxFee: sinon.stub().resolves(true),
            sendToAddress: sinon.stub().resolves('txid_abc'),
        }
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    afterEach(function () {
        sinon.restore()
    })

    describe('funding fee pin retry', settxfeeRetryTests)
})
