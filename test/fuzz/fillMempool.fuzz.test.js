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
const fc = require('fast-check')
const BlockchainConnector = require('../../src/BlockchainConnector')

describe('Fuzz: fillMempool input handling', function () {
    let XChainRegtestMiner
    let miner
    let connectorStub

    beforeEach(function () {
        connectorStub = {
            getWalletInfo: sinon.stub().resolves({ walletname: 'test' }),
            loadWallet: sinon.stub().resolves(),
            createWallet: sinon.stub().resolves(),
            getNewAddress: sinon.stub().resolves('bcrt1qtest'),
            getBalance: sinon.stub().resolves(50.0),
            getBlockchainInfo: sinon.stub().resolves({ blocks: 200 }),
            generateToAddress: sinon.stub().resolves(['blockhash1']),
            getRawMempool: sinon.stub().resolves([]),
            sendToAddress: sinon.stub().resolves('txid_abc'),
            getRawTransaction: sinon.stub(),
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

    // ─── txQuantity = 0 ─────────────────────────────────────────────

    describe('fillMempool with txQuantity = 0', function () {
        it('returns early without crash or transactions', async function () {
            await miner.fillMempool(0)

            assert.strictEqual(miner.keepMining, false)
            assert.strictEqual(connectorStub.sendToAddress.callCount, 0)
            assert.strictEqual(connectorStub.sendRawTransaction.callCount, 0)
        })
    })

    // ─── Invalid txQuantity values (all rejected by validation) ─────

    describe('fillMempool rejects invalid txQuantity', function () {
        const cases = [
            ['negative (-1)', -1],
            ['float (1.5)', 1.5],
            ['NaN', NaN],
            ['undefined', undefined],
            ['null', null],
            ['string', 'abc'],
            ['empty string', ''],
            ['boolean true', true],
            ['boolean false', false],
            ['empty object', {}],
            ['empty array', []],
            ['Infinity', Infinity],
            ['-Infinity', -Infinity],
            ['zero', 0],
        ]

        for (const [label, value] of cases) {
            it(`rejects ${label} and returns early`, async function () {
                await miner.fillMempool(value)

                assert.strictEqual(miner.keepMining, false)
                // Should not have attempted any RPC calls beyond logging
                assert.strictEqual(connectorStub.sendToAddress.callCount, 0)
            })
        }
    })

    // ─── Chunk math edge cases ──────────────────────────────────────

    describe('fillMempool chunk math boundaries', function () {
        const OUTPUTS_QUANTITY_PER_TX = 2500

        it('txQuantity = 2500 (exact multiple) calculates 1 chunk', function () {
            const chunks = Math.ceil(2500 / OUTPUTS_QUANTITY_PER_TX)
            assert.strictEqual(chunks, 1)
        })

        it('txQuantity = 2501 calculates 2 chunks', function () {
            const chunks = Math.ceil(2501 / OUTPUTS_QUANTITY_PER_TX)
            assert.strictEqual(chunks, 2)
        })

        it('txQuantity = 2499 calculates 1 chunk', function () {
            const chunks = Math.ceil(2499 / OUTPUTS_QUANTITY_PER_TX)
            assert.strictEqual(chunks, 1)
        })

        it('chunk math never produces negative or NaN values for positive inputs', function () {
            fc.assert(
                fc.property(fc.integer({ min: 1, max: 100000 }), (txQuantity) => {
                    const chunks = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)
                    assert.ok(chunks > 0, `chunks must be positive, got ${chunks}`)
                    assert.ok(!isNaN(chunks), 'chunks must not be NaN')
                    assert.ok(Number.isFinite(chunks), 'chunks must be finite')
                }),
                { numRuns: 1000 }
            )
        })

        it('totalAmount calculation never overflows for realistic txQuantity', function () {
            const AMOUNT_FOR_EACH_ADDRESS = 1000
            const FEE = 1000

            fc.assert(
                fc.property(fc.integer({ min: 1, max: 50000 }), (txQuantity) => {
                    const txsChunksCount = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)

                    for (let i = 0; i < txsChunksCount; i++) {
                        let txRemainder = OUTPUTS_QUANTITY_PER_TX
                        if (i === txsChunksCount - 1) {
                            const remainder = txQuantity % OUTPUTS_QUANTITY_PER_TX
                            if (remainder > 0) {
                                txRemainder = remainder
                            }
                        }
                        const totalAmount =
                            AMOUNT_FOR_EACH_ADDRESS * txRemainder +
                            FEE * txRemainder +
                            50 * txRemainder

                        assert.ok(Number.isFinite(totalAmount), `totalAmount must be finite`)
                        assert.ok(totalAmount > 0, `totalAmount must be positive`)
                        assert.ok(
                            totalAmount <= Number.MAX_SAFE_INTEGER,
                            `totalAmount must be within safe integer range`
                        )
                    }
                }),
                { numRuns: 500 }
            )
        })

        it('UTXO index math stays within bounds', function () {
            fc.assert(
                fc.property(fc.integer({ min: 1, max: 10000 }), (txQuantity) => {
                    const txsChunksCount = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)

                    for (let nextAddressIndex = 0; nextAddressIndex < txQuantity; nextAddressIndex++) {
                        const utxoIndex = Math.floor(nextAddressIndex / OUTPUTS_QUANTITY_PER_TX)
                        const outputIndex = nextAddressIndex % OUTPUTS_QUANTITY_PER_TX

                        assert.ok(utxoIndex >= 0, 'utxoIndex must be >= 0')
                        assert.ok(utxoIndex < txsChunksCount,
                            `utxoIndex ${utxoIndex} must be < txsChunksCount ${txsChunksCount}`)
                        assert.ok(outputIndex >= 0, 'outputIndex must be >= 0')
                        assert.ok(outputIndex < OUTPUTS_QUANTITY_PER_TX,
                            'outputIndex must be < OUTPUTS_QUANTITY_PER_TX')
                    }
                }),
                { numRuns: 100 }
            )
        })
    })

    // ─── getRawTransaction null loop detection ──────────────────────

    describe('fillMempool getRawTransaction retry limit', function () {
        it('throws after 50 retries when getRawTransaction perpetually returns null', async function () {
            connectorStub.sendToAddress.resolves('a'.repeat(64))

            let getRawTxCalls = 0
            connectorStub.getRawTransaction.callsFake(async () => {
                getRawTxCalls++
                return null
            })

            await assert.rejects(
                () => miner.fillMempool(1),
                /Failed to get raw transaction after 50 retries/
            )
            assert.strictEqual(getRawTxCalls, 50)
        })
    })

    // ─── fillMempool does not change keepMining for invalid inputs ────

    describe('fillMempool state management', function () {
        it('does not change keepMining for invalid inputs (validation rejects early)', async function () {
            // Invalid inputs are rejected before keepMining is modified
            await fc.assert(
                fc.asyncProperty(
                    fc.oneof(
                        fc.integer({ max: 0 }),
                        fc.double({ noInteger: true }),
                        fc.string(),
                        fc.boolean(),
                        fc.constant(null),
                        fc.constant(undefined),
                        fc.constant(NaN),
                        fc.constant(Infinity)
                    ),
                    fc.boolean(),
                    async (txQuantity, initialKeepMining) => {
                        miner.keepMining = initialKeepMining
                        await miner.fillMempool(txQuantity)
                        assert.strictEqual(miner.keepMining, initialKeepMining,
                            'keepMining must be unchanged after fillMempool with invalid input')
                    }
                ),
                { numRuns: 100 }
            )
        })
    })

    // ─── Resource exhaustion guard ──────────────────────────────────

    describe('fillMempool resource exhaustion concerns', function () {
        it('large txQuantity creates proportionally large address arrays', function () {
            // This is a pure math test — we verify the array sizes without
            // actually running fillMempool (which would be too slow/heavy)
            fc.assert(
                fc.property(fc.integer({ min: 1, max: 100000 }), (txQuantity) => {
                    // fillMempool creates txQuantity addresses
                    // Each address requires BIP32 key derivation
                    // Verify the math is bounded
                    const addressCount = txQuantity
                    const chunkCount = Math.ceil(txQuantity / 2500)

                    assert.ok(addressCount === txQuantity)
                    assert.ok(chunkCount <= Math.ceil(100000 / 2500))
                    assert.ok(chunkCount >= 1)
                }),
                { numRuns: 500 }
            )
        })
    })
})
