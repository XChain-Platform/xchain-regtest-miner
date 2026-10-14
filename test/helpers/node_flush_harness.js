// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.
//
// Shared fixture for the node flush tests: a real miner with a stub RPC client
// and a fake clock, rebuilt before every test.

const sinon = require('sinon')

const START = 1000000
const TICK_MS = 1000
const MINER_PATH = '../../src/XChainRegtestMiner'

// Registers beforeEach/afterEach on the calling describe and returns the live
// fixture; fields are refreshed per test.
function useFlushHarness() {
    const h = { TICK_MS }
    beforeEach(function () { setup(h) })
    afterEach(function () { teardown(h) })
    h.runLoop = (passes, onPass) => runLoop(h, passes, onPass)
    return h
}

function stubMinerCalls(h) {
    h.flush = sinon.stub().resolves()
    h.miner.connector.flushNodeState = h.flush
    h.miner.connector.getRawMempool = sinon.stub().resolves([])
    h.miner.prepareWallet = sinon.stub().resolves()
    h.miner.refreshWalletFunds = sinon.stub().resolves()
    h.miner.walletRefreshDue = () => false
    h.miner.generateBlocks = sinon.stub().callsFake(async () => { h.miner._lastMineAt = Date.now(); return ['h'] })
}

function setup(h) {
    sinon.stub(console, 'log')
    h.clock = sinon.useFakeTimers({ now: START, toFake: ['Date'] })
    h.XChainRegtestMiner = require(MINER_PATH)
    h.miner = new h.XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
    stubMinerCalls(h)
    h.miner.idleMineIntervalMs = 1000
    h.miner.nodeFlushIntervalMs = 10000
    process.removeAllListeners('SIGTERM')
    process.removeAllListeners('SIGINT')
}

function teardown(h) {
    h.clock.restore()
    sinon.restore()
    delete require.cache[require.resolve(MINER_PATH)]
}

// Runs the real start() loop for `passes` sleeps. Each sleep advances the fake
// clock by TICK_MS; onPass(n) runs before pass n's sleep resolves.
async function runLoop(h, passes, onPass) {
    let n = 0
    h.miner.sleep = async () => {
        n++
        if (onPass) await onPass(n)
        h.clock.tick(TICK_MS)
        if (n >= passes) h.miner._shutdown = true
    }
    await h.miner.start()
    if (h.miner._nodeFlushInFlight) await h.miner._nodeFlushInFlight
}

module.exports = { useFlushHarness }
