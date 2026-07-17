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
 * Chaos Tests: CE-05: Node Down During Startup
 *
 * Tests miner initialization when Bitcoin Core is unavailable.
 * Documents W-2: finite retry window causes unrecoverable crash.
 */

const assert = require('assert')
const sinon = require('sinon')
const ChaosNode = require('./helpers/ChaosNode')
const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
const { sleep } = require('./helpers/chaosSetup')

describe('Chaos: Startup Under Node Unavailability (CE-05)', function () {
    let node

    before(async function () {
        node = new ChaosNode()
        await node.start()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    after(async function () {
        sinon.restore()
        await node.stop()
    })

    beforeEach(function () {
        node.reset()
    })

    // ─── CE-05a: Node comes online within retry window ──────────────

    it('CE-05a: miner initializes successfully if node comes online within retry window', async function () {
        // Node starts offline: no wallet, no blocks
        node.goOffline()

        const miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')

        // Use a small real delay (5ms) so retries don't exhaust instantly.
        // getWalletInfo has 50 retries × 5ms = 250ms window.
        // We bring the node online at ~50ms, so around retry 10 it should succeed.
        sinon.stub(miner.connector, 'sleep').callsFake(async () => sleep(5))

        // Start prepareWallet in background
        const preparePromise = miner.prepareWallet().catch(e => e)

        // Bring node online within the retry window
        await sleep(50)
        node.goOnline()

        const result = await preparePromise

        // Should have succeeded (not an Error)
        assert.ok(!(result instanceof Error),
            'prepareWallet should succeed after node comes online: ' + (result && result.message))

        // Wallet was created
        assert.strictEqual(node.wallet.exists, true)
        assert.strictEqual(node.wallet.loaded, true)

        // Miner has an address and generated initial blocks
        assert.ok(miner.walletAddress, 'Miner should have a wallet address')
        assert.ok(node.height >= 101, 'Initial blocks should have been generated')

        miner.connector.sleep.restore()
    })

    // ─── CE-05b: Node stays offline, retries exhausted (W-2) ────────

    it('CE-05b: miner initialization fails after exhausting retry windows (documented W-2)', async function () {
        // Node stays offline for the entire test
        node.goOffline()

        const miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')

        // Stub connector.sleep so retries are instant (otherwise 50+ seconds)
        sinon.stub(miner.connector, 'sleep').resolves()

        // prepareWallet will call:
        //   1. getNewAddress probe (bounded retries): fails, falls through
        //   2. loadWallet: fails, falls through
        //   3. createWallet (50 retries): fails, throws
        await assert.rejects(
            () => miner.prepareWallet(),
            /Could not create wallet/,
            'W-2: prepareWallet should throw after exhausting all retry windows'
        )

        // Verify retries occurred
        // getWalletInfo uses 50 retries, createWallet uses 50
        // Both go through the connector which hits the offline node
        assert.ok(node.calls.length === 0,
            'No calls should reach the node when offline (socket destroyed)')

        node.goOnline()
        miner.connector.sleep.restore()
    })

    // ─── CE-05c: Restart with existing wallet after outage ──────────

    it('CE-05c: miner re-initializes with existing wallet after node outage and recovery', async function () {
        // First: create a wallet and seed it while online
        node._rpc_createwallet(['xchain_regtest_wallet'])
        node._rpc_generatetoaddress([110, 'bcrt1qseed'])

        // Now simulate a "restart after outage" scenario:
        // Node goes offline briefly during miner init, then comes back
        node.goOffline()

        const miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')

        // Small real delay so retries don't exhaust before goOnline
        sinon.stub(miner.connector, 'sleep').callsFake(async () => sleep(5))

        const preparePromise = miner.prepareWallet().catch(e => e)

        // Brief outage, then restore
        await sleep(30)
        node.goOnline()

        const result = await preparePromise

        assert.ok(!(result instanceof Error),
            'prepareWallet should succeed after brief outage: ' + (result && result.message))

        // Wallet was loaded (it already existed, not re-created)
        assert.strictEqual(node.wallet.loaded, true)
        assert.ok(miner.walletAddress, 'Miner should have obtained a wallet address')

        miner.connector.sleep.restore()
    })
})
