/*********************************************************************
 *
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC – https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available —
 * contact legal@dankest.llc.
 *
 **********************************************************************
 * Chaos Tests — CE-08: Process Lifecycle
 *
 * Documents W-4: no SIGTERM handler exists — process terminates immediately.
 * Tests clean restart after simulated crash.
 *
 * Note: SIGTERM cannot be tested in-process (it would kill Mocha).
 * These tests characterize existing behavior and verify restart resilience.
 */

const assert = require('assert')
const sinon = require('sinon')
const ChaosNode = require('./helpers/ChaosNode')
const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
const { createMiner, seedWallet, startMinerLoop, stopMinerLoop, waitFor, sleep } = require('./helpers/chaosSetup')

describe('Chaos: Process Lifecycle (CE-08)', function () {
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
        seedWallet(node)
    })

    // ─── CE-08: No SIGTERM handler (W-4 characterization) ──────────

    it('CE-08: W-4 fixed — SIGTERM handler registered by start(), not constructor', async function () {
        const miner = createMiner(node)

        // Constructor should NOT register a handler
        const listenersBefore = process.listeners('SIGTERM').length

        const miner2 = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')
        assert.strictEqual(process.listeners('SIGTERM').length, listenersBefore,
            'Constructor should not register SIGTERM handler')

        // start() SHOULD register a handler
        const { startPromise } = startMinerLoop(miner)
        await waitFor(() => miner.keepMining === true)

        assert.strictEqual(process.listeners('SIGTERM').length, listenersBefore + 1,
            'start() should register a SIGTERM handler')

        // Clean up the handler
        await stopMinerLoop(miner, startPromise)
        if (miner._sigTermHandler) {
            process.removeListener('SIGTERM', miner._sigTermHandler)
        }
    })

    // ─── CE-08a: Clean restart after simulated crash ────────────────

    it('CE-08a: miner re-initializes cleanly after simulated crash and restart', async function () {
        // Phase 1: Start a miner and mine one block
        const miner1 = createMiner(node)
        miner1.maxTimeToMineTxs = 300
        miner1.addedTimeToMineTxs = 80

        const { startPromise: sp1 } = startMinerLoop(miner1)
        await waitFor(() => miner1.keepMining === true)

        const heightBefore = node.height
        node.injectMempoolTx('txid_ce08_phase1')
        await waitFor(() => node.height > heightBefore, 3000)

        // Phase 2: Simulate crash — kill the miner loop
        await stopMinerLoop(miner1, sp1)
        const heightAfterCrash = node.height

        // Phase 3: Create a brand new miner (simulating process restart)
        const miner2 = createMiner(node)
        miner2.maxTimeToMineTxs = 300
        miner2.addedTimeToMineTxs = 80

        // Start the new miner — it should re-initialize cleanly
        // (wallet already exists, so prepareWallet takes the loadWallet path)
        const { startPromise: sp2 } = startMinerLoop(miner2)
        await waitFor(() => miner2.keepMining === true, 3000)

        // Verify the restarted miner mines correctly
        node.injectMempoolTx('txid_ce08_phase3')
        await waitFor(() => node.height > heightAfterCrash, 3000)

        assert.ok(node.height > heightAfterCrash,
            'Restarted miner should mine blocks successfully')

        // Verify the new transaction was included
        const lastBlock = node.blocks[node.blocks.length - 1]
        assert.ok(lastBlock.txids.includes('txid_ce08_phase3'),
            'Transaction should be included in block mined by restarted miner')

        // Miner2 has valid state
        assert.ok(miner2.walletAddress, 'Restarted miner should have a wallet address')
        assert.strictEqual(miner2.keepMining, true)

        await stopMinerLoop(miner2, sp2)
    })
})
