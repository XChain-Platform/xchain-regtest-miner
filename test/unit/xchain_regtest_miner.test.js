// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const assert = require('assert')
const sinon = require('sinon')

// Stub BlockchainConnector before requiring XChainRegtestMiner
const BlockchainConnector = require('../../src/rpc/blockchain_connector')

let XChainRegtestMiner
let miner
let connectorStub

function registerMinerHooks() {
    beforeEach(function () {
        // Create a stub for every BlockchainConnector method
        connectorStub = {
            getWalletInfo: sinon.stub(),
            loadWallet: sinon.stub(),
            createWallet: sinon.stub(),
            getNewAddress: sinon.stub().resolves('bcrt1qtest'),
            getBalance: sinon.stub().resolves(50.0),
            getBlockchainInfo: sinon.stub().resolves({ blocks: 200 }),
            generateToAddress: sinon.stub().resolves(['blockhash1']),
            getRawMempool: sinon.stub().resolves([]),
            sendToAddress: sinon.stub().resolves('txid_abc'),
            setTxFee: sinon.stub().resolves(true),
            getRawTransaction: sinon.stub().resolves('0200000001...'),
            sendRawTransaction: sinon.stub().resolves('txid_sent'),
            getNetworkInfo: sinon.stub().resolves({}),
            setWalletName: sinon.stub(),
        }

        // Stub the BlockchainConnector constructor
        sinon.stub(BlockchainConnector.prototype, 'constructor')

        XChainRegtestMiner = require('../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', undefined, '18332', 'user', 'pass')
        miner.connector = connectorStub

        sinon.stub(miner, 'sleep').resolves()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    afterEach(function () {
        sinon.restore()
        // Clear module cache so fresh require works each time
        delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
    })
}

// ─── Constructor ────────────────────────────────────────────────────

function constructorTests() {
    it('initializes with correct defaults', function () {
        assert.strictEqual(miner.walletNameParam, 'xchain_regtest_wallet')
        assert.strictEqual(miner.keepMining, false)
        assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        assert.strictEqual(miner.addedTimeToMineTxs, 5000)
    })

    it('creates a BlockchainConnector instance', function () {
        assert.ok(miner.connector)
    })
}

// ─── setMiningTime ──────────────────────────────────────────────────

function setMiningTimeTests() {
    it('updates both timing values with valid integers', async function () {
        await miner.setMiningTime(10000, 2000)
        assert.strictEqual(miner.maxTimeToMineTxs, 10000)
        assert.strictEqual(miner.addedTimeToMineTxs, 2000)
    })

    it('does not update with non-integer maxTime', async function () {
        await assert.rejects(() => miner.setMiningTime(10.5, 2000), /Invalid mining times/)
        assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        assert.strictEqual(miner.addedTimeToMineTxs, 5000)
    })

    it('does not update with non-integer txAddedTime', async function () {
        await assert.rejects(() => miner.setMiningTime(10000, 'abc'), /Invalid mining times/)
        assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        assert.strictEqual(miner.addedTimeToMineTxs, 5000)
    })

    it('rejects zero values', async function () {
        await assert.rejects(() => miner.setMiningTime(0, 0), /Invalid mining times/)
        assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        assert.strictEqual(miner.addedTimeToMineTxs, 5000)
    })

    it('rejects negative integers', async function () {
        await assert.rejects(() => miner.setMiningTime(-1, -1), /Invalid mining times/)
        assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        assert.strictEqual(miner.addedTimeToMineTxs, 5000)
    })

    it('is isolated per instance', async function () {
        const miner2 = new XChainRegtestMiner('regtest', undefined, '18332', 'u', 'p')
        await miner.setMiningTime(1000, 1000)
        assert.strictEqual(miner2.maxTimeToMineTxs, 30000)
    })
}

// ─── setDefaultMiningTime ───────────────────────────────────────────

function setDefaultMiningTimeTests() {
    it('resets timing to defaults', async function () {
        miner.maxTimeToMineTxs = 1000
        miner.addedTimeToMineTxs = 500
        await miner.setDefaultMiningTime()
        assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        assert.strictEqual(miner.addedTimeToMineTxs, 5000)
    })
}

// ─── continueMining ─────────────────────────────────────────────────

function continueMiningTests() {
    it('sets keepMining to true', async function () {
        miner.keepMining = false
        await miner.continueMining()
        assert.strictEqual(miner.keepMining, true)
    })
}

// ─── sendFundsToAddress ─────────────────────────────────────────────

function sendFundsToAddressTests() {
    it('delegates to connector.sendToAddress and returns txid', async function () {
        connectorStub.sendToAddress.resolves('txid123')
        const result = await miner.sendFundsToAddress('addr', 1.0)
        assert.strictEqual(result, 'txid123')
        assert(connectorStub.sendToAddress.calledWith('addr', 1.0))
    })

    it('propagates errors', async function () {
        connectorStub.sendToAddress.rejects(new Error('insufficient funds'))
        await assert.rejects(() => miner.sendFundsToAddress('a', 1), /insufficient funds/)
    })

    // A node restarted under a long-running miner comes back with no wallet
    // loaded, and the wallet is bootstrapped exactly once, at startup. Every
    // funding call then fails FOREVER while mining keeps working, because
    // generatetoaddress reuses the address cached before the restart - so
    // the venue looks alive and is unusable. Measured on BTC regtest
    // 2026-08-11, 30 hours in that state.
    it('reloads the wallet and retries once when the node lost it', async function () {
        const gone = new Error('Error sending funds to address')
        gone.walletMissing = true
        connectorStub.sendToAddress.onFirstCall().rejects(gone)
        connectorStub.sendToAddress.onSecondCall().resolves('txidAfterReload')
        connectorStub.loadWallet.resolves({ name: 'xchain_regtest_wallet' })

        const result = await miner.sendFundsToAddress('addr', 1.0)

        assert.strictEqual(result, 'txidAfterReload')
        assert(connectorStub.loadWallet.calledWith('xchain_regtest_wallet'))
        assert.strictEqual(connectorStub.sendToAddress.callCount, 2)
    })

    it('does NOT retry a send that failed for any other reason', async function () {
        // The retry is for one recoverable fault. Insufficient funds, a bad
        // address or a dead RPC must fail on the first answer, or a broken
        // venue turns every call into two.
        connectorStub.sendToAddress.rejects(new Error('Error sending funds to address'))
        await assert.rejects(() => miner.sendFundsToAddress('a', 1), /Error sending funds/)
        assert.strictEqual(connectorStub.sendToAddress.callCount, 1)
        assert(connectorStub.loadWallet.notCalled)
    })

    it('gives up after ONE reload, rather than looping on a node that stays broken', async function () {
        const gone = new Error('Error sending funds to address')
        gone.walletMissing = true
        connectorStub.sendToAddress.rejects(gone)
        connectorStub.loadWallet.resolves({ name: 'xchain_regtest_wallet' })

        await assert.rejects(() => miner.sendFundsToAddress('a', 1), /Error sending funds/)
        assert.strictEqual(connectorStub.sendToAddress.callCount, 2)
        assert.strictEqual(connectorStub.loadWallet.callCount, 1)
    })
}

// ─── funding fee ceiling ──────────────────────────────────

// Bitcoin Core 31 deleted settxfee. The wallet-wide pin therefore answers
// "no" forever on BTC, and the old code read that as "fall back to the fee
// estimate" - which is precisely the state the pin exists to prevent:
// estimatesmartfee inflates on a matured regtest chain, the wallet exceeds
// -maxtxfee, and every funding send dies with RPC -6 late in a long run.
// These assert the CEILING reaches the send, whichever mechanism carries it.
function minerFor(network) {
    const m = new XChainRegtestMiner(network, undefined, '18332', 'user', 'pass')
    m.connector = connectorStub
    return m
}

function fundingFeeCeilingTestsA() {
    it('pins BTC per call, because settxfee no longer exists there', async function () {
        const m = minerFor('bitcoin-regtest')
        const mode = await m.pinFundingFeeRate()

        assert.strictEqual(mode, 'fee_rate')
        assert.ok(connectorStub.setTxFee.notCalled, 'BTC must not call a deleted RPC')

        await m.sendFundsToAddress('addr', 1.0)
        const rate = connectorStub.sendToAddress.firstCall.args[2]
        assert.ok(rate > 0, 'the funding send must carry a fee ceiling, got ' + rate)
    })

    it('keeps the wallet-wide settxfee pin for LTC and DOGE', async function () {
        for (const coin of ['litecoin', 'dogecoin']) {
            connectorStub.setTxFee.resetHistory()
            connectorStub.sendToAddress.resetHistory()

            const m = minerFor(coin + '-regtest')
            const mode = await m.pinFundingFeeRate()

            assert.strictEqual(mode, 'settxfee', coin + ' must pin wallet-wide')
            assert.ok(connectorStub.setTxFee.calledOnce, coin + ' must call settxfee')
            assert.ok(connectorStub.setTxFee.firstCall.args[0] > 0)

            await m.sendFundsToAddress('addr', 1.0)
            // These daemons have no fee_rate argument; a named-param send
            // would be rejected outright (DOGE v1.14 predates named params).
            assert.ok(
                !connectorStub.sendToAddress.firstCall.args[2],
                coin + ' sends must stay on the positional form'
            )
        }
    })
}

function fundingFeeCeilingTestsB() {
    it('does not invent a fee_rate for a coin that has no such argument', async function () {
        connectorStub.setTxFee.resolves(false)
        const m = minerFor('dogecoin-regtest')

        assert.strictEqual(await m.pinFundingFeeRate(), 'none')

        await m.sendFundsToAddress('addr', 1.0)
        assert.ok(!connectorStub.sendToAddress.firstCall.args[2])
    })

    // The regression itself: a Core 31 node reached through a bare NETWORK
    // (no coin half) answers settxfee with "no". Falling back to the
    // estimate there is the silent ceiling loss; fall back to fee_rate.
    it('falls back to the per-call rate when a daemon has dropped settxfee', async function () {
        connectorStub.setTxFee.resolves(false)
        const m = minerFor('regtest')

        assert.strictEqual(await m.pinFundingFeeRate(), 'fee_rate')

        await m.sendFundsToAddress('addr', 1.0)
        const rate = connectorStub.sendToAddress.firstCall.args[2]
        assert.ok(rate > 0, 'a dropped settxfee must not leave the send uncapped, got ' + rate)
    })

    it('leaves a working settxfee daemon on the wallet-wide pin', async function () {
        const m = minerFor('regtest')
        assert.strictEqual(await m.pinFundingFeeRate(), 'settxfee')

        await m.sendFundsToAddress('addr', 1.0)
        assert.ok(!connectorStub.sendToAddress.firstCall.args[2])
    })
}

// ─── createWallet ───────────────────────────────────────────────────

function createWalletTests() {
    it('delegates to connector.createWallet and returns true', async function () {
        connectorStub.createWallet.resolves({ name: 'w' })
        const result = await miner.createWallet('w')
        assert.strictEqual(result, true)
    })

    it('throws on connector error', async function () {
        connectorStub.createWallet.rejects(new Error('already exists'))
        await assert.rejects(() => miner.createWallet('w'), /Error creating wallet/)
    })
}

// ─── generateBlocks ─────────────────────────────────────────────────

function generateBlocksTests() {
    it('calls generateToAddress with count and wallet address', async function () {
        miner.walletAddress = 'bcrt1qreward'
        await miner.generateBlocks(5)
        assert(connectorStub.generateToAddress.calledWith(5, 'bcrt1qreward'))
    })

    it('logs plural message for multiple blocks', async function () {
        miner.walletAddress = 'addr'
        await miner.generateBlocks(3)
        assert(console.log.calledWithMatch(/3 new blocks have been generated/))
    })

    it('logs singular message for one block', async function () {
        miner.walletAddress = 'addr'
        await miner.generateBlocks(1)
        assert(console.log.calledWithMatch(/A new block has been generated/))
    })

    it('throws for zero blocks and does not log a generation message', async function () {
        miner.walletAddress = 'addr'
        // Reset console.log call tracking
        console.log.resetHistory()
        // generateBlocks is async: an invalid count surfaces as a rejection.
        await assert.rejects(() => miner.generateBlocks(0), /count must be a positive integer/)
        // Only the generic logs from other setup, not block generation messages
        const blockMessages = console.log.args.filter(
            args => args[0] && typeof args[0] === 'string' && args[0].includes('generated')
        )
        assert.strictEqual(blockMessages.length, 0)
    })

    // Resource-exhaustion cap: an unbounded generate_blocks count would block the
    // node synchronously and, since every mining caller serializes behind
    // _generateQueue, wedge the auto-mine loop and every pause/fill barrier behind
    // it. Mirrors the MAX_FILL_MEMPOOL_QUANTITY guard on fillMempool.
    it('throws for a count above the maximum instead of driving the node', async function () {
        miner.walletAddress = 'addr'
        await assert.rejects(() => miner.generateBlocks(10001), /exceeds maximum/)
        // The node must never be asked to mine an over-cap count.
        assert(connectorStub.generateToAddress.notCalled)
    })

    it('throws for an absurd count (Number.MAX_SAFE_INTEGER)', async function () {
        miner.walletAddress = 'addr'
        await assert.rejects(() => miner.generateBlocks(Number.MAX_SAFE_INTEGER), /exceeds maximum/)
        assert(connectorStub.generateToAddress.notCalled)
    })

    it('accepts the maximum count and does not poison the queue after an over-cap throw', async function () {
        miner.walletAddress = 'addr'
        // An over-cap call rejects before touching _generateQueue, so a subsequent
        // legitimate call must still run.
        await assert.rejects(() => miner.generateBlocks(10001), /exceeds maximum/)
        await miner.generateBlocks(1)
        assert(connectorStub.generateToAddress.calledWith(1, 'addr'))
    })
}

// ─── invalidateBlock / reconsiderBlock ──────────────────────────────

function invalidateBlockTests() {
    it('pauses mining and calls connector.invalidateBlock', async function () {
        connectorStub.invalidateBlock = sinon.stub().resolves(true)
        const pauseSpy = sinon.spy(miner, 'pauseMining')
        await miner.invalidateBlock('deadbeef')
        assert(pauseSpy.calledOnce, 'pauseMining should be called before invalidating')
        assert(connectorStub.invalidateBlock.calledWith('deadbeef'))
    })

    it('rejects when blockHash is not a string', async function () {
        connectorStub.invalidateBlock = sinon.stub().resolves(true)
        await assert.rejects(() => miner.invalidateBlock(null), /blockHash must be a non-empty string/)
    })
}

describe('XChainRegtestMiner', function () {
    registerMinerHooks()
    describe('constructor', constructorTests)
    describe('setMiningTime', setMiningTimeTests)
    describe('setDefaultMiningTime', setDefaultMiningTimeTests)
    describe('continueMining', continueMiningTests)
    describe('sendFundsToAddress', sendFundsToAddressTests)
    describe('funding fee ceiling', fundingFeeCeilingTestsA)
    describe('funding fee ceiling', fundingFeeCeilingTestsB)
    describe('createWallet', createWalletTests)
    describe('generateBlocks', generateBlocksTests)
    describe('invalidateBlock', invalidateBlockTests)
})
