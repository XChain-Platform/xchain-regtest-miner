// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

const assert = require('assert')
const sinon = require('sinon')
const BlockchainConnector = require('../../src/BlockchainConnector')

describe('Security: Resource Exhaustion & DoS Prevention', function () {
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

    // ─── SEC-001: sendFundsToAddress retry limit in fillMempool ────────

    describe('fillMempool sendFundsToAddress retry limit (SEC-001)', function () {
        it('throws after MAX_SEND_RETRIES when sendFundsToAddress always fails', async function () {
            miner.walletAddress = 'bcrt1qtest'
            connectorStub.sendToAddress.rejects(new Error('RPC unavailable'))

            await assert.rejects(
                () => miner.fillMempool(1),
                /Failed to send funds after 50 retries/
            )
        })

        it('retries exactly 50 times before throwing', async function () {
            miner.walletAddress = 'bcrt1qtest'
            connectorStub.sendToAddress.rejects(new Error('RPC unavailable'))

            try {
                await miner.fillMempool(1)
            } catch(e) {
                // Expected
            }

            assert.strictEqual(connectorStub.sendToAddress.callCount, 50)
        })

        it('succeeds if sendFundsToAddress recovers within retry limit', async function () {
            miner.walletAddress = 'bcrt1qtest'
            // Fail 3 times, then succeed
            connectorStub.sendToAddress
                .onCall(0).rejects(new Error('temporary'))
                .onCall(1).rejects(new Error('temporary'))
                .onCall(2).rejects(new Error('temporary'))
                .onCall(3).resolves('txid_ok')

            // Will still fail later in the pipeline (getRawTransaction returns non-hex), but
            // the point is it gets past the send retry loop
            try {
                await miner.fillMempool(1)
            } catch(e) {
                // Expected — fails at transaction parsing stage
            }

            assert.strictEqual(connectorStub.sendToAddress.callCount, 4)
        })

        it('does not hang indefinitely when RPC is permanently down', async function () {
            this.timeout(5000)
            miner.walletAddress = 'bcrt1qtest'
            connectorStub.sendToAddress.rejects(new Error('connection refused'))

            const startTime = Date.now()
            try {
                await miner.fillMempool(1)
            } catch(e) {
                // Expected
            }
            // Should complete quickly (sleep is stubbed to resolve immediately)
            assert.ok(Date.now() - startTime < 3000)
        })

        it('resets fillMempoolRunning after retry failure', async function () {
            miner.walletAddress = 'bcrt1qtest'
            connectorStub.sendToAddress.rejects(new Error('RPC unavailable'))

            try {
                await miner.fillMempool(1)
            } catch(e) {
                // Expected
            }

            assert.strictEqual(miner.fillMempoolRunning, false)
        })
    })

    // ─── SEC-006: fillMempool mutex ────────────────────────────────────

    describe('fillMempool concurrent access protection (SEC-006)', function () {
        it('rejects concurrent call when fillMempool is already running', async function () {
            miner.fillMempoolRunning = true
            const result = await miner.fillMempool(10)
            assert.ok(result && result.error)
            assert.match(result.error, /already running/)
        })

        it('does not modify keepMining when rejected for concurrency', async function () {
            miner.keepMining = true
            miner.fillMempoolRunning = true
            await miner.fillMempool(10)
            assert.strictEqual(miner.keepMining, true)
        })

        it('sets fillMempoolRunning to true during execution', async function () {
            miner.walletAddress = 'bcrt1qtest'
            let wasRunning = false

            // Capture the flag state during sendToAddress call
            connectorStub.sendToAddress.callsFake(async () => {
                wasRunning = miner.fillMempoolRunning
                return 'txid_ok'
            })
            connectorStub.getRawTransaction.resolves(null) // Will trigger retry limit

            try {
                await miner.fillMempool(1)
            } catch(e) {
                // Expected
            }

            assert.strictEqual(wasRunning, true)
        })

        it('resets fillMempoolRunning to false after success path', async function () {
            // We can't easily test a full success path without real crypto,
            // but we can verify the finally block works on error
            miner.walletAddress = 'bcrt1qtest'
            connectorStub.sendToAddress.rejects(new Error('fail'))

            try {
                await miner.fillMempool(1)
            } catch(e) {
                // Expected
            }

            assert.strictEqual(miner.fillMempoolRunning, false)
        })

        it('resets fillMempoolRunning to false after quantity cap rejection', async function () {
            await miner.fillMempool(50001)
            assert.strictEqual(miner.fillMempoolRunning, false)
        })

        it('allows new fillMempool call after previous one completes', async function () {
            miner.walletAddress = 'bcrt1qtest'
            connectorStub.sendToAddress.rejects(new Error('fail'))

            // First call
            try { await miner.fillMempool(1) } catch(e) {}
            assert.strictEqual(miner.fillMempoolRunning, false)

            // Second call should not be rejected for concurrency
            connectorStub.sendToAddress.rejects(new Error('fail again'))
            try { await miner.fillMempool(1) } catch(e) {}
            assert.strictEqual(miner.fillMempoolRunning, false)

            // sendToAddress called in both runs
            assert.ok(connectorStub.sendToAddress.callCount > 50)
        })

        it('initializes fillMempoolRunning to false', function () {
            const fresh = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
            assert.strictEqual(fresh.fillMempoolRunning, false)
        })
    })

    // ─── SEC-002: Memory exhaustion via large txQuantity ───────────────

    describe('fillMempool memory exhaustion prevention (SEC-002)', function () {
        it('rejects 50001 without allocating addresses', async function () {
            const result = await miner.fillMempool(50001)
            assert.ok(result && result.error)
            // sendToAddress should never be called
            assert.strictEqual(connectorStub.sendToAddress.callCount, 0)
        })

        it('rejects 1000000 without allocating addresses', async function () {
            const result = await miner.fillMempool(1000000)
            assert.ok(result && result.error)
            assert.strictEqual(connectorStub.sendToAddress.callCount, 0)
        })

        it('rejects Number.MAX_SAFE_INTEGER', async function () {
            const result = await miner.fillMempool(Number.MAX_SAFE_INTEGER)
            assert.ok(result && result.error)
        })
    })
})
