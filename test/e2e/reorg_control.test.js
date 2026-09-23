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
 * E2E Tests: Reorg and mock-clock primitives over the wire
 *
 * Drives invalidateblock, reconsiderblock and setmocktime from the miner
 * through real HTTP to the stateful mock node, including the error-less
 * 2xx replies the connector must refuse: those three RPCs answer
 * result:null on success, so anything else must never certify a rollback
 * or a clock change the node did not perform.
 */

const assert = require('assert')
const sinon = require('sinon')
const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
const StatefulMockNode = require('./helpers/StatefulMockNode')

const REWARD_ADDRESS = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'

let node

// Seed a loaded wallet on a chain of `height` blocks and return a miner on it.
function seededMiner(height) {
    node.reset()
    node._rpc_createwallet(['xchain_regtest_wallet'])
    node._rpc_generatetoaddress([height, REWARD_ADDRESS])
    node.calls = []
    const miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')
    miner.walletAddress = REWARD_ADDRESS
    return miner
}

function tipHash() {
    return node.blocks[node.blocks.length - 1].hash
}

async function testInvalidateRollsBack() {
    const miner = seededMiner(110)
    const forkParent = node.blocks[108].hash
    const tip = tipHash()

    assert.strictEqual(await miner.invalidateBlock(tip), true)
    assert.strictEqual(node.height, 109)
    assert.strictEqual(tipHash(), forkParent)
    assert.deepStrictEqual(node.callsFor('invalidateblock')[0].params, [tip])
}

async function testReconsiderRestoresLongerBranch() {
    const miner = seededMiner(113)
    const originalTip = tipHash()
    const branchRoot = node.blocks[110].hash

    await miner.invalidateBlock(branchRoot)
    assert.strictEqual(node.height, 110)
    await miner.generateBlocks(1)
    assert.strictEqual(node.height, 111)
    assert.notStrictEqual(tipHash(), originalTip)

    assert.strictEqual(await miner.reconsiderBlock(branchRoot), true)
    assert.strictEqual(node.height, 113)
    assert.strictEqual(tipHash(), originalTip)
}

async function testStandaloneReconsiderRestoresMining() {
    const miner = seededMiner(105)
    miner.keepMining = true

    assert.strictEqual(await miner.reconsiderBlock(tipHash()), true)
    assert.strictEqual(miner.keepMining, true, 'a standalone reconsider must hand mining back')
    assert.strictEqual(node.callsFor('reconsiderblock').length, 1)
}

async function testMockClockStampsBlocks() {
    const miner = seededMiner(105)
    const pinned = 2000000000

    assert.strictEqual(await miner.setMockTime(pinned), true)
    await miner.generateBlocks(1)
    const pinnedBlock = await miner.connector.getBlock(tipHash(), false)
    assert.strictEqual(pinnedBlock.time, pinned)

    assert.strictEqual(await miner.setMockTime(0), true)
    await miner.generateBlocks(1)
    const released = await miner.connector.getBlock(tipHash(), false)
    assert.ok(Math.abs(released.time - Math.floor(Date.now() / 1000)) < 60)
}

async function testUnknownBlockIsRefused() {
    const miner = seededMiner(105)
    await assert.rejects(() => miner.invalidateBlock('00'.repeat(32)), /^Error: Error invalidating block$/)
    assert.strictEqual(node.height, 105)
    const logged = console.error.getCalls().map(c => c.args.join(' ')).join('\n')
    assert.match(logged, /invalidateblock RPC error: Block not found/)
}

// Each case swaps one handler for a reply with no error member and no
// result:null, which is what a truncated or foreign 2xx body looks like.
const ERRORLESS_REPLIES = [
    ['invalidateblock', m => m.invalidateBlock(tipHash()), /Error invalidating block/],
    ['reconsiderblock', m => m.reconsiderBlock(tipHash()), /Error reconsidering block/],
    ['setmocktime', m => m.setMockTime(2000000000), /Error setting mock time/],
]

async function testErrorlessRepliesAreRefused() {
    for (const [method, call, expected] of ERRORLESS_REPLIES) {
        for (const reply of [{}, undefined, true]) {
            const miner = seededMiner(105)
            node['_rpc_' + method] = () => reply
            try {
                await assert.rejects(() => call(miner), expected, method + ' answered ' + JSON.stringify(reply))
            } finally {
                delete node['_rpc_' + method]
            }
            assert.strictEqual(node.height, 105)
        }
    }
}

describe('E2E: Reorg and mock-clock primitives over HTTP', function () {
    before(async function () {
        node = new StatefulMockNode()
        await node.start()
    })

    after(async function () {
        await node.stop()
    })

    beforeEach(function () {
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    afterEach(function () {
        sinon.restore()
    })

    it('invalidateblock rolls the node back to the fork point', testInvalidateRollsBack)
    it('reconsiderblock re-activates a branch that outworks the competing one', testReconsiderRestoresLongerBranch)
    it('a standalone reconsiderblock restores prior auto-mining', testStandaloneReconsiderRestoresMining)
    it('setmocktime stamps the next block and 0 releases the clock', testMockClockStampsBlocks)
    it('an unknown block hash is refused with the node error logged', testUnknownBlockIsRefused)
    it('refuses an error-less 2xx reply that is not result:null', testErrorlessRepliesAreRefused)
})
