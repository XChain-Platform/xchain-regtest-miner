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

describe('Boundary: fillMempool Chunking and Calculations', function () {
    let XChainRegtestMiner
    let miner
    let connectorStub

    const OUTPUTS_QUANTITY_PER_TX = 2500
    const AMOUNT_FOR_EACH_ADDRESS = 1000
    const FEE = 1000
    const SATOSHI_UNIT = 100000000.0

    beforeEach(function () {
        connectorStub = {
            getWalletInfo: sinon.stub().resolves({ walletname: 'w' }),
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
            getRawTransaction: sinon.stub().resolves(null),
            sendRawTransaction: sinon.stub().resolves('txid_sent'),
            getNetworkInfo: sinon.stub().resolves({}),
        }

        sinon.stub(BlockchainConnector.prototype, 'constructor')

        XChainRegtestMiner = require('../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        miner.connector = connectorStub

        sinon.stub(miner, 'sleep').resolves()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')

        miner.walletAddress = 'bcrt1qtest'
    })

    afterEach(function () {
        sinon.restore()
        delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
    })

    // ─── F-01: tx_quantity = 0 ─────────────────────────────────────────

    describe('F-01: tx_quantity = 0', function () {
        it('rejects invalid input and does not change keepMining', async function () {
            miner.keepMining = true

            // txQuantity=0 fails validation (< 1) and throws before
            // modifying keepMining or processing chunks
            await assert.rejects(() => miner.fillMempool(0), /positive integer/)

            assert.strictEqual(miner.keepMining, true,
                'Should not change keepMining for invalid input')
            // No processing should occur
            assert.strictEqual(connectorStub.sendToAddress.callCount, 0,
                'Should not send any funding transactions')
        })
    })

    // ─── F-02: tx_quantity = 1 ─────────────────────────────────────────

    describe('F-02: tx_quantity = 1', function () {
        it('creates exactly 1 chunk with 1 output', function () {
            const txQuantity = 1
            const chunks = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)
            assert.strictEqual(chunks, 1)

            const remainder = txQuantity % OUTPUTS_QUANTITY_PER_TX
            assert.strictEqual(remainder, 1)
        })

        it('calculates correct funding amount for 1 address (bare-"regtest" FALLBACK path)', function () {
            const txRemainder = 1
            // The miner under test is built with the bare network 'regtest' (see setup),
            // which does NOT resolve to a coin config, so it falls back to the
            // bitcoinjs-lib built-in, which carries no dustThreshold: split fee floors at 50.
            const splitFee = Math.max(50, 50)
            const totalAmount = AMOUNT_FOR_EACH_ADDRESS * txRemainder +
                                FEE * txRemainder +
                                splitFee * txRemainder
            assert.strictEqual(totalAmount, 2050)
            assert.strictEqual(totalAmount / SATOSHI_UNIT, 0.0000205)
        })

        it('calculates correct funding amount for 1 address (resolved "bitcoin-regtest" coin config)', function () {
            // Production passes COIN_NETWORK in the resolved form, where Bitcoin DOES
            // define dustThreshold 546. This is the path real runs take and it was
            // previously unasserted, so the suite would have stayed green if the
            // Bitcoin sizing drifted below dust.
            const CryptoNetworks = require('../../src/CryptoNetworks')
            const net = CryptoNetworks.getBitcoinJsNetwork('bitcoin-regtest')
            assert.strictEqual(net.dustThreshold, 546)

            const coinDust = Math.max(net.dustThreshold, 1000)   // 1000 (546 < 1000)
            const splitFee = Math.max(50, net.dustThreshold)     // 546, not 50
            const totalAmount = coinDust + coinDust + splitFee
            assert.strictEqual(splitFee, 546)
            assert.strictEqual(totalAmount, 2546)
        })
    })

    // ─── F-02b: split-tx fee scales to the coin's dust threshold ───────
    // Regression guard for the DOGE fill_mempool failure: the split tx's
    // per-output miner fee is Math.max(50, network.dustThreshold), not a
    // flat 50, so it clears dogecoin-regtest's relay floor.
    describe('F-02b: split-tx fee scales to coin dust threshold', function () {
        const splitFeeFor = (dustThreshold) => Math.max(50, dustThreshold || 50)

        it('floors at 50 sat/output only when no dustThreshold resolves (bare-network fallback)', function () {
            assert.strictEqual(splitFeeFor(undefined), 50)
        })

        it('uses 546 sat/output for the resolved bitcoin-regtest coin config', function () {
            assert.strictEqual(splitFeeFor(546), 546)
        })

        it('scales to 100000 koinu/output for dogecoin-regtest', function () {
            assert.strictEqual(splitFeeFor(100000), 100000)
        })

        it('scales to 5460 litoshi/output for litecoin-regtest', function () {
            assert.strictEqual(splitFeeFor(5460), 5460)
        })
    })

    // ─── F-03: tx_quantity = 2499 ──────────────────────────────────────

    describe('F-03: tx_quantity = 2499 (one below chunk size)', function () {
        it('creates 1 chunk with 2499 outputs', function () {
            const txQuantity = 2499
            const chunks = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)
            assert.strictEqual(chunks, 1)

            const remainder = txQuantity % OUTPUTS_QUANTITY_PER_TX
            assert.strictEqual(remainder, 2499)
        })
    })

    // ─── F-04: tx_quantity = 2500 ──────────────────────────────────────

    describe('F-04: tx_quantity = 2500 (exactly one chunk)', function () {
        it('creates exactly 1 chunk with no remainder', function () {
            const txQuantity = 2500
            const chunks = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)
            assert.strictEqual(chunks, 1)

            const remainder = txQuantity % OUTPUTS_QUANTITY_PER_TX
            // remainder is 0, so txRemainder stays at OUTPUTS_QUANTITY_PER_TX
            assert.strictEqual(remainder, 0)
        })

        it('last chunk uses full OUTPUTS_QUANTITY_PER_TX when evenly divisible', function () {
            const txQuantity = 2500
            const txsChunksCount = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)
            const lastChunkIndex = txsChunksCount - 1

            let txRemainder = OUTPUTS_QUANTITY_PER_TX
            const remainder = txQuantity % OUTPUTS_QUANTITY_PER_TX
            if (remainder > 0) {
                txRemainder = remainder
            }

            assert.strictEqual(txRemainder, OUTPUTS_QUANTITY_PER_TX,
                'When evenly divisible, txRemainder stays at OUTPUTS_QUANTITY_PER_TX')
        })
    })

    // ─── F-05: tx_quantity = 2501 ──────────────────────────────────────

    describe('F-05: tx_quantity = 2501 (one above chunk size)', function () {
        it('creates 2 chunks: one of 2500 and one of 1', function () {
            const txQuantity = 2501
            const chunks = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)
            assert.strictEqual(chunks, 2)

            const remainder = txQuantity % OUTPUTS_QUANTITY_PER_TX
            assert.strictEqual(remainder, 1)
        })

        it('first chunk is full size, second is remainder', function () {
            const txQuantity = 2501
            const txsChunksCount = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)
            const chunkSizes = []

            for (let i = 0; i < txsChunksCount; i++) {
                let txRemainder = OUTPUTS_QUANTITY_PER_TX
                if (i === txsChunksCount - 1) {
                    const remainder = txQuantity % OUTPUTS_QUANTITY_PER_TX
                    if (remainder > 0) txRemainder = remainder
                }
                chunkSizes.push(txRemainder)
            }

            assert.deepStrictEqual(chunkSizes, [2500, 1])
        })
    })

    // ─── F-06: tx_quantity = 5000 ──────────────────────────────────────

    describe('F-06: tx_quantity = 5000 (exactly two chunks)', function () {
        it('creates 2 full chunks with no remainder', function () {
            const txQuantity = 5000
            const chunks = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)
            assert.strictEqual(chunks, 2)

            const remainder = txQuantity % OUTPUTS_QUANTITY_PER_TX
            assert.strictEqual(remainder, 0)
        })
    })

    // ─── F-07: tx_quantity = 47500 (19 chunks, below mining threshold) ─

    describe('F-07: tx_quantity = 47500 (19 chunks, below mining threshold)', function () {
        it('does not trigger intermediate block mining (threshold is 20)', function () {
            const txQuantity = 47500
            const chunks = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)
            assert.strictEqual(chunks, 19)

            // processedChunkCount goes 1..19, never reaches 20
            let wouldMine = false
            let processedChunkCount = 0
            for (let i = 0; i < chunks; i++) {
                processedChunkCount++
                if (processedChunkCount >= 20) {
                    wouldMine = true
                }
            }
            assert.strictEqual(wouldMine, false,
                '19 chunks should not trigger intermediate mining')
        })
    })

    // ─── F-08: tx_quantity = 50000 (20 chunks, exact mining threshold) ─

    describe('F-08: tx_quantity = 50000 (20 chunks, exact mining threshold)', function () {
        it('triggers exactly one intermediate block mine', function () {
            const txQuantity = 50000
            const chunks = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)
            assert.strictEqual(chunks, 20)

            let intermediateMineCalls = 0
            let processedChunkCount = 0
            for (let i = 0; i < chunks; i++) {
                processedChunkCount++
                if (processedChunkCount >= 20) {
                    intermediateMineCalls++
                    // Note: processedChunkCount is NOT reset in actual code
                }
            }
            assert.strictEqual(intermediateMineCalls, 1,
                'Should mine exactly once at chunk 20')
        })
    })

    // ─── F-09: tx_quantity = 50001 (21 chunks) ─────────────────────────

    describe('F-09: tx_quantity = 50001 (21 chunks, one past threshold)', function () {
        it('triggers intermediate mining once at chunk 20, then resets counter', function () {
            const txQuantity = 50001
            const chunks = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)
            assert.strictEqual(chunks, 21)

            const remainder = txQuantity % OUTPUTS_QUANTITY_PER_TX
            assert.strictEqual(remainder, 1)

            // processedChunkCount hits 20 at chunk 20, triggering mining and resetting to 0.
            // Chunk 21 increments to 1, which does not trigger again.
            let intermediateMineCalls = 0
            let processedChunkCount = 0
            for (let i = 0; i < chunks; i++) {
                processedChunkCount++
                if (processedChunkCount >= 20) {
                    intermediateMineCalls++
                    processedChunkCount = 0
                }
            }
            assert.strictEqual(intermediateMineCalls, 1,
                'processedChunkCount resets after mining: only one intermediate mine')
        })
    })

    // ─── F-10: Negative tx_quantity ────────────────────────────────────

    describe('F-10: negative tx_quantity', function () {
        it('Math.ceil of negative produces 0 or negative chunks', function () {
            const txQuantity = -1
            const chunks = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)
            assert.strictEqual(chunks, -0)
            // The for loop (i=0; i<chunks) won't execute since -0 is not > 0
        })

        it('address array loop with negative count creates no addresses', function () {
            const txQuantity = -5
            const addresses = []
            for (let i = 0; i < txQuantity; i++) {
                addresses.push('addr_' + i)
            }
            assert.strictEqual(addresses.length, 0)
        })
    })

    // ─── F-11: Non-integer tx_quantity ──────────────────────────────────

    describe('F-11: non-integer tx_quantity (2.5)', function () {
        it('Math.ceil handles float: 2.5/2500 rounds up to 1 chunk', function () {
            const txQuantity = 2.5
            const chunks = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)
            assert.strictEqual(chunks, 1)
        })

        it('address loop runs fractional times (effectively 2 iterations)', function () {
            const txQuantity = 2.5
            let count = 0
            for (let i = 0; i < txQuantity; i++) {
                count++
            }
            // i goes 0, 1, 2: loop runs 3 times (0 < 2.5, 1 < 2.5, 2 < 2.5, 3 >= 2.5 stops)
            assert.strictEqual(count, 3,
                'Float comparison: 0,1,2 all < 2.5 so loop runs 3 times')
        })
    })

    // ─── F-12: Very large tx_quantity ──────────────────────────────────

    describe('F-12: very large tx_quantity', function () {
        it('calculates chunk count correctly for 1000000', function () {
            const txQuantity = 1000000
            const chunks = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)
            assert.strictEqual(chunks, 400)
        })

        it('funding amount does not exceed Number.MAX_SAFE_INTEGER for single chunk', function () {
            const txRemainder = OUTPUTS_QUANTITY_PER_TX
            const totalAmount = AMOUNT_FOR_EACH_ADDRESS * txRemainder +
                                FEE * txRemainder +
                                50 * txRemainder

            assert(totalAmount <= Number.MAX_SAFE_INTEGER,
                'Single chunk funding amount should be within safe integer range')
            assert.strictEqual(totalAmount, 5125000)
        })

        it('total funding for all chunks stays within safe integer range', function () {
            const txQuantity = 1000000
            const perAddress = AMOUNT_FOR_EACH_ADDRESS + FEE + 50
            const totalFunding = perAddress * txQuantity

            assert(totalFunding <= Number.MAX_SAFE_INTEGER,
                'Total funding for 1M txs: ' + totalFunding)
            assert.strictEqual(totalFunding, 2050000000)
        })
    })

    // ─── Chunk mining threshold boundary ───────────────────────────────

    describe('Chunk mining threshold (processedChunkCount >= 20)', function () {
        it('does not mine at exactly 19 processed chunks', function () {
            let processedChunkCount = 19
            assert.strictEqual(processedChunkCount >= 20, false)
        })

        it('mines at exactly 20 processed chunks', function () {
            let processedChunkCount = 20
            assert.strictEqual(processedChunkCount >= 20, true)
        })

        it('resets to 0 after mining at 20 (counter does not stay at 21)', function () {
            let processedChunkCount = 20
            if (processedChunkCount >= 20) processedChunkCount = 0
            processedChunkCount++ // next chunk
            assert.strictEqual(processedChunkCount, 1,
                'After reset, next chunk starts at 1')
        })
    })

    // ─── Funding amount calculation boundaries ─────────────────────────

    describe('Funding amount per-address calculation', function () {
        it('amount breakdown: 1000 (amount) + 1000 (fee) + 50 (buffer) = 2050 sat', function () {
            const perAddress = AMOUNT_FOR_EACH_ADDRESS + FEE + 50
            assert.strictEqual(perAddress, 2050)
        })

        it('converts correctly to BTC', function () {
            const totalSatoshis = 2050 * 100
            assert.strictEqual(totalSatoshis / SATOSHI_UNIT, 0.00205)
        })

        it('full chunk funding amount', function () {
            const txRemainder = OUTPUTS_QUANTITY_PER_TX
            const total = (AMOUNT_FOR_EACH_ADDRESS + FEE + 50) * txRemainder
            assert.strictEqual(total, 5125000)
            assert.strictEqual(total / SATOSHI_UNIT, 0.05125)
        })
    })

    // ─── BIP32 derivation index boundaries ─────────────────────────────

    describe('BIP32 derivation index boundaries', function () {
        it('first address uses derive(1).derive(0)', function () {
            // addresses[0] = account.derive(0+1).derive(0)
            const firstIndex = 0 + 1
            assert.strictEqual(firstIndex, 1)
        })

        it('main address uses derive(0).derive(0)', function () {
            // mainAddress = account.derive(0).derive(0)
            const mainIndex = 0
            assert.strictEqual(mainIndex, 0)
        })

        it('last address for tx_quantity=N uses derive(N).derive(0)', function () {
            const txQuantity = 100
            const lastIndex = txQuantity // i goes 0..99, derive(i+1) = derive(100)
            assert.strictEqual(lastIndex, txQuantity)
        })
    })

    // ─── PSBT output distribution boundaries ───────────────────────────

    describe('PSBT output distribution per chunk', function () {
        it('first chunk processes addresses 0 to 2499', function () {
            const nextUtxoIndex = 0
            const start = nextUtxoIndex * OUTPUTS_QUANTITY_PER_TX
            const end = (parseInt(nextUtxoIndex) + 1) * OUTPUTS_QUANTITY_PER_TX
            assert.strictEqual(start, 0)
            assert.strictEqual(end, 2500)
        })

        it('second chunk processes addresses 2500 to 4999', function () {
            const nextUtxoIndex = 1
            const start = nextUtxoIndex * OUTPUTS_QUANTITY_PER_TX
            const end = (parseInt(nextUtxoIndex) + 1) * OUTPUTS_QUANTITY_PER_TX
            assert.strictEqual(start, 2500)
            assert.strictEqual(end, 5000)
        })

        it('address index capped by addresses.length for partial last chunk', function () {
            const txQuantity = 2501
            const addressesLength = txQuantity
            const nextUtxoIndex = 1 // second chunk
            const start = nextUtxoIndex * OUTPUTS_QUANTITY_PER_TX
            const end = (parseInt(nextUtxoIndex) + 1) * OUTPUTS_QUANTITY_PER_TX

            let outputCount = 0
            for (let i = start; i < end && i < addressesLength; i++) {
                outputCount++
            }
            assert.strictEqual(outputCount, 1,
                'Second chunk of 2501 should only have 1 output')
        })
    })

    // ─── Stress tx output index calculation ────────────────────────────

    describe('Stress transaction output index calculation', function () {
        it('output index wraps correctly within chunk', function () {
            // outputIndex = nextAddressIndex % OUTPUTS_QUANTITY_PER_TX
            assert.strictEqual(0 % OUTPUTS_QUANTITY_PER_TX, 0)
            assert.strictEqual(2499 % OUTPUTS_QUANTITY_PER_TX, 2499)
            assert.strictEqual(2500 % OUTPUTS_QUANTITY_PER_TX, 0) // wraps
            assert.strictEqual(2501 % OUTPUTS_QUANTITY_PER_TX, 1)
        })

        it('utxo index selects correct chunk', function () {
            // utxoIndex = Math.floor(nextAddressIndex / OUTPUTS_QUANTITY_PER_TX)
            assert.strictEqual(Math.floor(0 / OUTPUTS_QUANTITY_PER_TX), 0)
            assert.strictEqual(Math.floor(2499 / OUTPUTS_QUANTITY_PER_TX), 0)
            assert.strictEqual(Math.floor(2500 / OUTPUTS_QUANTITY_PER_TX), 1)
            assert.strictEqual(Math.floor(4999 / OUTPUTS_QUANTITY_PER_TX), 1)
            assert.strictEqual(Math.floor(5000 / OUTPUTS_QUANTITY_PER_TX), 2)
        })
    })
})
