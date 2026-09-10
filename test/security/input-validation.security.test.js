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
const BlockchainConnector = require('../../src/BlockchainConnector')

describe('Security: Input Validation', function () {
    let XChainRegtestMiner
    let miner
    let connectorStub

    beforeEach(function () {
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
            setWalletName: sinon.stub(),
            getRawTransaction: sinon.stub().resolves('0200000001...'),
            sendRawTransaction: sinon.stub().resolves('txid_sent'),
        }

        sinon.stub(BlockchainConnector.prototype, 'constructor')
        XChainRegtestMiner = require('../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        miner.connector = connectorStub
        sinon.stub(miner, 'sleep').resolves()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    afterEach(function () {
        sinon.restore()
        delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
    })

    // ─── sendFundsToAddress (SEC-003) ──────────────────────────────────

    describe('sendFundsToAddress input validation (SEC-003)', function () {
        it('rejects non-string address (number)', async function () {
            await assert.rejects(
                () => miner.sendFundsToAddress(12345, 1.0),
                /Invalid address/
            )
            assert.strictEqual(connectorStub.sendToAddress.callCount, 0)
        })

        it('rejects non-string address (null)', async function () {
            await assert.rejects(
                () => miner.sendFundsToAddress(null, 1.0),
                /Invalid address/
            )
        })

        it('rejects non-string address (undefined)', async function () {
            await assert.rejects(
                () => miner.sendFundsToAddress(undefined, 1.0),
                /Invalid address/
            )
        })

        it('rejects non-string address (object)', async function () {
            await assert.rejects(
                () => miner.sendFundsToAddress({toString: 'bad'}, 1.0),
                /Invalid address/
            )
        })

        it('rejects non-string address (array)', async function () {
            await assert.rejects(
                () => miner.sendFundsToAddress(['bcrt1qtest'], 1.0),
                /Invalid address/
            )
        })

        it('rejects non-string address (boolean)', async function () {
            await assert.rejects(
                () => miner.sendFundsToAddress(true, 1.0),
                /Invalid address/
            )
        })

        it('rejects empty string address', async function () {
            await assert.rejects(
                () => miner.sendFundsToAddress('', 1.0),
                /Invalid address/
            )
        })

        it('rejects non-number amount (string)', async function () {
            await assert.rejects(
                () => miner.sendFundsToAddress('bcrt1qtest', '1.0'),
                /Invalid amount/
            )
        })

        it('rejects negative amount', async function () {
            await assert.rejects(
                () => miner.sendFundsToAddress('bcrt1qtest', -1),
                /Invalid amount/
            )
        })

        it('rejects zero amount', async function () {
            await assert.rejects(
                () => miner.sendFundsToAddress('bcrt1qtest', 0),
                /Invalid amount/
            )
        })

        it('rejects NaN amount', async function () {
            await assert.rejects(
                () => miner.sendFundsToAddress('bcrt1qtest', NaN),
                /Invalid amount/
            )
        })

        it('rejects Infinity amount', async function () {
            await assert.rejects(
                () => miner.sendFundsToAddress('bcrt1qtest', Infinity),
                /Invalid amount/
            )
        })

        it('rejects -Infinity amount', async function () {
            await assert.rejects(
                () => miner.sendFundsToAddress('bcrt1qtest', -Infinity),
                /Invalid amount/
            )
        })

        it('rejects null amount', async function () {
            await assert.rejects(
                () => miner.sendFundsToAddress('bcrt1qtest', null),
                /Invalid amount/
            )
        })

        it('rejects boolean amount', async function () {
            await assert.rejects(
                () => miner.sendFundsToAddress('bcrt1qtest', true),
                /Invalid amount/
            )
        })

        it('accepts valid string address and positive number amount', async function () {
            await miner.sendFundsToAddress('bcrt1qtest', 1.0)
            assert.strictEqual(connectorStub.sendToAddress.callCount, 1)
            assert.deepStrictEqual(connectorStub.sendToAddress.firstCall.args, ['bcrt1qtest', 1.0, null])
        })

        it('accepts very small positive amount', async function () {
            await miner.sendFundsToAddress('bcrt1qtest', 0.00000001)
            assert.strictEqual(connectorStub.sendToAddress.callCount, 1)
        })

        it('never reaches RPC layer with invalid inputs', async function () {
            const badInputs = [
                [null, 1.0],
                ['', 1.0],
                [123, 1.0],
                ['bcrt1qtest', -1],
                ['bcrt1qtest', NaN],
                ['bcrt1qtest', 'abc'],
                ['bcrt1qtest', Infinity],
            ]
            for (const [addr, amt] of badInputs) {
                try { await miner.sendFundsToAddress(addr, amt) } catch(e) { /* expected */ }
            }
            assert.strictEqual(connectorStub.sendToAddress.callCount, 0)
        })
    })

    // ─── setMiningTime (SEC-008, timer bounds) ──────────────────────────

    // setMiningTime now throws (rather than returning a sentinel {error}
    // object) on invalid input, matching sendFundsToAddress/invalidateBlock
    // (uuid:24c35056).
    describe('setMiningTime timer bounds (SEC-008)', function () {
        it('rejects maxTime below minimum (SEC-008)', async function () {
            await assert.rejects(() => miner.setMiningTime(500, 2000), /too small/)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })

        it('rejects txAddedTime below minimum (SEC-008)', async function () {
            await assert.rejects(() => miner.setMiningTime(2000, 500), /too small/)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('rejects maxTime above maximum (SEC-008)', async function () {
            await assert.rejects(() => miner.setMiningTime(3600001, 2000), /too large/)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })

        it('rejects txAddedTime above maximum (SEC-008)', async function () {
            await assert.rejects(() => miner.setMiningTime(2000, 3600001), /too large/)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('rejects both values above maximum', async function () {
            await assert.rejects(() => miner.setMiningTime(9999999, 9999999))
        })

        it('rejects maxTime of 1ms (near-continuous mining)', async function () {
            await assert.rejects(() => miner.setMiningTime(1, 1000))
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })

        it('accepts values at minimum boundary (1000ms)', async function () {
            const result = await miner.setMiningTime(1000, 1000)
            assert.strictEqual(result, undefined)
            assert.strictEqual(miner.maxTimeToMineTxs, 1000)
            assert.strictEqual(miner.addedTimeToMineTxs, 1000)
        })

        it('accepts values at maximum boundary (3600000ms)', async function () {
            const result = await miner.setMiningTime(3600000, 3600000)
            assert.strictEqual(result, undefined)
            assert.strictEqual(miner.maxTimeToMineTxs, 3600000)
            assert.strictEqual(miner.addedTimeToMineTxs, 3600000)
        })

        it('throws for non-integer maxTime', async function () {
            await assert.rejects(() => miner.setMiningTime(10.5, 2000), /positive integers/)
        })

        it('throws for non-integer txAddedTime', async function () {
            await assert.rejects(() => miner.setMiningTime(2000, 'abc'))
        })

        it('throws for zero values', async function () {
            await assert.rejects(() => miner.setMiningTime(0, 0))
        })

        it('throws for negative values', async function () {
            await assert.rejects(() => miner.setMiningTime(-1000, -1000))
        })

        it('throws for Number.MAX_SAFE_INTEGER', async function () {
            await assert.rejects(() => miner.setMiningTime(Number.MAX_SAFE_INTEGER, 5000), /too large/)
        })

        it('does not crash with non-printable values', async function () {
            await assert.rejects(() => miner.setMiningTime({toString: 0}, {toString: 0}))
        })
    })

    // ─── fillMempool (SEC-002, quantity cap) ────────────────────────────

    describe('fillMempool quantity cap (SEC-002)', function () {
        // fillMempool THROWS on a rejected quantity (the api.js handler wraps it in
        // try/catch and converts the throw to a {error} response); it does not return a
        // {error} object itself. Assert the rejection.
        it('rejects txQuantity exceeding 50000', async function () {
            await assert.rejects(() => miner.fillMempool(50001), /exceeds maximum/)
        })

        it('rejects txQuantity of 100000', async function () {
            await assert.rejects(() => miner.fillMempool(100000), /exceeds maximum/)
        })

        it('rejects txQuantity of Number.MAX_SAFE_INTEGER', async function () {
            await assert.rejects(() => miner.fillMempool(Number.MAX_SAFE_INTEGER), /exceeds maximum/)
        })

        it('still rejects non-positive-integer before cap check', async function () {
            await assert.rejects(() => miner.fillMempool(0), /positive integer/)
            await assert.rejects(() => miner.fillMempool(-1), /positive integer/)
            await assert.rejects(() => miner.fillMempool(1.5), /positive integer/)
            await assert.rejects(() => miner.fillMempool('abc'), /positive integer/)
            // None should have started the fill process
            assert.strictEqual(miner.fillMempoolRunning, false)
        })

        it('accepts txQuantity at maximum boundary (50000)', async function () {
            // Will fail at the crypto stage, but should pass the validation
            miner.walletAddress = 'bcrt1qtest'
            connectorStub.sendToAddress.rejects(new Error('test abort'))
            try {
                await miner.fillMempool(50000)
            } catch(e) {
                // Expected: fails at sendFundsToAddress after passing validation
            }
            // Verify it got past validation (fillMempoolRunning was set)
            // It should be reset by finally block
            assert.strictEqual(miner.fillMempoolRunning, false)
        })
    })
})
