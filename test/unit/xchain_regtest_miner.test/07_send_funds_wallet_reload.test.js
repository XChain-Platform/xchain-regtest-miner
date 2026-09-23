// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.
//
// settxfee is in-memory wallet state, so a wallet reloaded after a node restart
// comes back with the default fee policy. The reload-and-retry in
// sendFundsToAddress must therefore pin the funding fee ceiling again, after the
// wallet is loaded and before the retried send, or LTC and DOGE funding sends
// fall back to estimatesmartfee for the rest of the run.

const assert = require('assert')
const sinon = require('sinon')
const XChainRegtestMiner = require('../../../src/XChainRegtestMiner')

let connector

function minerFor(network) {
    const miner = new XChainRegtestMiner(network, undefined, '18332', 'user', 'pass')
    miner.connector = connector
    return miner
}

// The first send finds the wallet gone, the retry after the reload succeeds.
function lostWalletOnce() {
    const gone = new Error('Error sending funds to address')
    gone.walletMissing = true
    connector.sendToAddress.onFirstCall().rejects(gone)
    connector.sendToAddress.onSecondCall().resolves('txidAfterReload')
}

describe('XChainRegtestMiner', function () {
    beforeEach(function () {
        connector = {
            loadWallet: sinon.stub().resolves({ name: 'xchain_regtest_wallet' }),
            setWalletName: sinon.stub(),
            setTxFee: sinon.stub().resolves(true),
            sendToAddress: sinon.stub(),
        }
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    afterEach(function () {
        sinon.restore()
    })

    describe('sendFundsToAddress wallet reload', function () {
        it('re-pins settxfee on LTC after reloading a lost wallet, before the retry', async function () {
            const miner = minerFor('litecoin-regtest')
            await miner.pinFundingFeeRate()
            connector.setTxFee.resetHistory()
            lostWalletOnce()

            assert.strictEqual(await miner.sendFundsToAddress('addr', 1.0), 'txidAfterReload')
            assert.ok(connector.setTxFee.calledOnce, 'the reloaded wallet must be pinned again')
            const pin = connector.setTxFee.firstCall
            assert.ok(pin.calledAfter(connector.setWalletName.firstCall), 'pin the wallet just loaded')
            assert.ok(pin.calledBefore(connector.sendToAddress.secondCall), 'pin before the retry')
            assert.ok(!connector.sendToAddress.secondCall.args[2], 'the LTC retry stays positional')
        })

        it('keeps the per-call BTC ceiling on the retry without calling settxfee', async function () {
            const miner = minerFor('bitcoin-regtest')
            await miner.pinFundingFeeRate()
            lostWalletOnce()

            assert.strictEqual(await miner.sendFundsToAddress('addr', 1.0), 'txidAfterReload')
            assert.ok(connector.setTxFee.notCalled, 'BTC must not call a deleted RPC')
            assert.ok(connector.sendToAddress.secondCall.args[2] > 0)
        })
    })
})
