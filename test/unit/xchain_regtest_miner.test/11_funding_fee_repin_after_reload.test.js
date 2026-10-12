// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.
//
// A wallet reload re-runs the funding fee pin. Only the wallet-wide settxfee pin is
// lost with the wallet, so a re-pin whose settxfee cannot be reached keeps a per-call
// rate already in force, and still ends on the estimate when settxfee was the pin.

const assert = require('assert')
const sinon = require('sinon')
const XChainRegtestMiner = require('../../../src/XChainRegtestMiner')
const { FUNDING_FEE_RATE_SAT_PER_VB } = require('../../../src/XChainRegtestMiner/constants')

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

// The first send finds the wallet gone, the retry after the reload succeeds.
function lostWalletOnce() {
    const gone = new Error('Error sending funds to address')
    gone.walletMissing = true
    connector.sendToAddress.onFirstCall().rejects(gone)
    connector.sendToAddress.onSecondCall().resolves('txidAfterReload')
}

function repinAfterReloadTests() {
    it('keeps the per-call rate on a bare network when the re-pin cannot reach settxfee', async function () {
        connector.setTxFee.onFirstCall().rejects(settxfeeError({ rpcCode: -32601 }))
        connector.setTxFee.rejects(settxfeeError({}))
        const miner = minerFor('regtest')
        assert.strictEqual(await miner.pinFundingFeeRate(), 'fee_rate')
        lostWalletOnce()

        assert.strictEqual(await miner.sendFundsToAddress('addr', 1.0), 'txidAfterReload')
        assert.strictEqual(connector.setTxFee.callCount, 4, 'the re-pin must retry settxfee')
        assert.strictEqual(connector.sendToAddress.secondCall.args[2], FUNDING_FEE_RATE_SAT_PER_VB)
        assert.strictEqual(miner.fundingFeeRateSatPerVb, FUNDING_FEE_RATE_SAT_PER_VB)
    })

    it('keeps the per-call rate on Litecoin when a re-pin after a missing settxfee times out', async function () {
        connector.setTxFee.onFirstCall().rejects(settxfeeError({ rpcCode: -32601 }))
        connector.setTxFee.rejects(settxfeeError({ timedOut: true }))
        const miner = minerFor('litecoin-regtest')

        assert.strictEqual(await miner.pinFundingFeeRate(), 'fee_rate')
        assert.strictEqual(await miner.pinFundingFeeRate(), 'fee_rate')
        assert.strictEqual(miner.fundingFeeRateSatPerVb, FUNDING_FEE_RATE_SAT_PER_VB)
    })

    it('ends on the estimate when the lost pin was settxfee and the re-pin cannot reach it', async function () {
        connector.setTxFee.onFirstCall().resolves(true)
        connector.setTxFee.rejects(settxfeeError({}))
        const miner = minerFor('regtest')

        assert.strictEqual(await miner.pinFundingFeeRate(), 'settxfee')
        assert.strictEqual(await miner.pinFundingFeeRate(), 'none')
        assert.strictEqual(miner.fundingFeeRateSatPerVb, null)
    })

    it('drops the per-call rate when the re-pin is refused outright', async function () {
        connector.setTxFee.onFirstCall().rejects(settxfeeError({ rpcCode: -32601 }))
        connector.setTxFee.rejects(settxfeeError({ rpcCode: -8 }))
        const miner = minerFor('regtest')

        assert.strictEqual(await miner.pinFundingFeeRate(), 'fee_rate')
        assert.strictEqual(await miner.pinFundingFeeRate(), 'none')
        assert.strictEqual(miner.fundingFeeRateSatPerVb, null)
    })
}

describe('XChainRegtestMiner', function () {
    beforeEach(function () {
        connector = {
            loadWallet: sinon.stub().resolves({ name: 'xchain_regtest_wallet' }),
            setWalletName: sinon.stub(),
            setTxFee: sinon.stub().resolves(true),
            sendToAddress: sinon.stub().resolves('txid_abc'),
        }
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    afterEach(function () {
        sinon.restore()
    })

    describe('funding fee re-pin after a wallet reload', repinAfterReloadTests)
})
