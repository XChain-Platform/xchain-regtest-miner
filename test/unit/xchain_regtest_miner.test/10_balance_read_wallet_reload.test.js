// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.
//
// A node restarted under a long-running miner loses the miner's wallet, and only
// the send path used to reload it, so status read wallet_funded false until a send
// happened along. The balance read now reloads it too, in the background, so the
// auto-mine loop (which awaits refreshWalletFunds inline) never waits on a reload.

const assert = require('assert')
const sinon = require('sinon')
const XChainRegtestMiner = require('../../../src/XChainRegtestMiner')

let connector
let nowMs

function lostWallet() {
    const err = new Error('Error getting balance')
    err.walletMissing = true
    return err
}

function minerFor(network) {
    const miner = new XChainRegtestMiner(network, undefined, '18332', 'user', 'pass')
    miner.connector = connector
    sinon.stub(miner, 'sleep').resolves()
    return miner
}

// A virtual clock and a connector whose wallet calls succeed unless a test says otherwise.
function setup() {
    nowMs = 1_000_000
    sinon.stub(Date, 'now').callsFake(() => nowMs)
    connector = {
        getBalance: sinon.stub(),
        loadWallet: sinon.stub().resolves({ name: 'xchain_regtest_wallet' }),
        setWalletName: sinon.stub(),
        setTxFee: sinon.stub().resolves(true),
    }
    sinon.stub(console, 'log')
    sinon.stub(console, 'error')
}

describe('XChainRegtestMiner', function () {
    beforeEach(setup)
    afterEach(() => sinon.restore())

    describe('refreshWalletFunds wallet reload', function () {
        it('reloads a lost wallet, re-pins settxfee on LTC, and the next read is numeric', async function () {
            const miner = minerFor('litecoin-regtest')
            connector.getBalance.onFirstCall().rejects(lostWallet())
            connector.getBalance.onSecondCall().resolves(12.5)

            assert.strictEqual(await miner.refreshWalletFunds(), null)
            assert.ok(miner.walletReloadInFlight, 'a reload is in flight')
            await miner.walletReloadInFlight
            assert.ok(connector.loadWallet.calledOnce)
            assert.ok(connector.setWalletName.calledOnceWith('xchain_regtest_wallet'))
            assert.ok(connector.setTxFee.calledOnce, 'the reloaded wallet is pinned again')
            assert.ok(connector.setTxFee.firstCall.calledAfter(connector.setWalletName.firstCall))

            nowMs += 5000
            assert.strictEqual(await miner.refreshWalletFunds(), 12.5)
            assert.strictEqual(miner.getStatus().wallet_funded, true)
        })

        it('never makes the balance read wait on the reload', async function () {
            const miner = minerFor('bitcoin-regtest')
            connector.getBalance.rejects(lostWallet())
            connector.loadWallet.returns(new Promise(() => {}))

            const settled = await Promise.race([
                miner.refreshWalletFunds().then(() => 'resolved'),
                new Promise(resolve => setImmediate(() => setImmediate(() => resolve('blocked'))))
            ])
            assert.strictEqual(settled, 'resolved')
            assert.strictEqual(miner.balance, null)
            assert.strictEqual(miner.getStatus().wallet_balance_at, nowMs)
        })

    })
})

describe('XChainRegtestMiner', function () {
    beforeEach(setup)
    afterEach(() => sinon.restore())

    describe('refreshWalletFunds wallet reload failures and pacing', function () {
        it('still resolves, with a null balance, when the reload itself fails', async function () {
            const miner = minerFor('bitcoin-regtest')
            connector.getBalance.rejects(lostWallet())
            sinon.stub(miner, 'ensureWalletLoaded').rejects(new Error('the node never confirmed it loaded'))

            assert.strictEqual(await miner.refreshWalletFunds(), null)
            await new Promise(resolve => setImmediate(resolve))
            assert.strictEqual(miner.walletReloadInFlight, null, 'the failed reload settled and cleared its slot')
            const logged = console.log.getCalls().map(c => c.args.join(' ')).join('\n')
            assert.match(logged, /Could not reload the wallet: the node never confirmed it loaded/)
            assert.strictEqual(miner.getStatus().wallet_balance_at, nowMs)
        })

        it('starts at most one reload per refresh interval while the wallet stays lost', async function () {
            const miner = minerFor('bitcoin-regtest')
            connector.getBalance.rejects(lostWallet())
            const reload = sinon.stub(miner, 'ensureWalletLoaded').resolves()

            await miner.refreshWalletFunds()
            await miner.refreshWalletFunds()
            await miner.walletReloadInFlight
            nowMs += 4999
            await miner.refreshWalletFunds()
            assert.strictEqual(reload.callCount, 1)
            nowMs += 1
            await miner.refreshWalletFunds()
            assert.strictEqual(reload.callCount, 2)
        })

        it('does not reload on a failure that is not a lost wallet', async function () {
            const miner = minerFor('bitcoin-regtest')
            connector.getBalance.rejects(new Error('Error getting balance'))
            const reload = sinon.stub(miner, 'ensureWalletLoaded').resolves()

            assert.strictEqual(await miner.refreshWalletFunds(), null)
            assert.strictEqual(reload.called, false)
            assert.strictEqual(miner.walletReloadInFlight, null)
        })
    })
})
