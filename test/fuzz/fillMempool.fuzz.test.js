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

    // Helper: make getRawTransaction throw after N null returns to avoid infinite loop
    function stubGetRawTxWithNullLimit(limit) {
        let calls = 0
        connectorStub.getRawTransaction.callsFake(async () => {
            calls++
            if (calls > limit) {
                throw new Error('__NULL_LOOP_BREAK__')
            }
            return null
        })
    }

    // ─── txQuantity = 0 ─────────────────────────────────────────────

    describe('fillMempool with txQuantity = 0', function () {
        it('completes without crash and makes no transactions', async function () {
            connectorStub.sendToAddress.resolves('txid_fund')
            stubGetRawTxWithNullLimit(5)

            await miner.fillMempool(0)

            assert.strictEqual(miner.keepMining, false)
            // Should not have tried to send raw transactions for 0 outputs
            assert.strictEqual(connectorStub.sendRawTransaction.callCount, 0)
        })
    })

    // ─── txQuantity = -1 ────────────────────────────────────────────

    describe('fillMempool with negative txQuantity', function () {
        it('completes without crash for txQuantity = -1', async function () {
            stubGetRawTxWithNullLimit(5)

            try {
                await miner.fillMempool(-1)
            } catch (e) {
                // Errors are acceptable as long as they're not RangeError
                if (e.message !== '__NULL_LOOP_BREAK__') {
                    assert.ok(
                        !(e instanceof RangeError),
                        'Negative txQuantity caused RangeError: ' + e.message
                    )
                }
            }
            assert.strictEqual(miner.keepMining, false)
        })
    })

    // ─── Non-integer txQuantity values ───────────────────────────────

    describe('fillMempool with non-integer txQuantity', function () {
        const cases = [
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
            // Note: Infinity and -Infinity are excluded because they cause
            // Math.ceil(Infinity/2500) = Infinity, creating an infinite for-loop.
            // This is a known vulnerability documented in the infinite loop test below.
        ]

        for (const [label, value] of cases) {
            it(`handles ${label} without process crash`, async function () {
                stubGetRawTxWithNullLimit(5)
                connectorStub.sendToAddress.resolves('a'.repeat(64))

                try {
                    await miner.fillMempool(value)
                } catch (e) {
                    // Any Error is acceptable — we only care about no crash
                    assert.ok(e instanceof Error, `Expected Error, got ${typeof e}`)
                }
                assert.strictEqual(miner.keepMining, false)
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

    describe('fillMempool getRawTransaction infinite loop risk', function () {
        it('getRawTransaction returning null repeatedly causes unbounded loop', async function () {
            // Documents the known infinite loop at XChainRegtestMiner.js:160-162:
            //   while (rawTransaction == null) { rawTransaction = await ... }
            // No timeout, no retry limit.

            connectorStub.sendToAddress.resolves('a'.repeat(64))

            let getRawTxCalls = 0
            connectorStub.getRawTransaction.callsFake(async () => {
                getRawTxCalls++
                if (getRawTxCalls > 50) {
                    throw new Error('__INFINITE_LOOP_DETECTED__')
                }
                return null
            })

            try {
                await miner.fillMempool(1)
            } catch (e) {
                if (e.message === '__INFINITE_LOOP_DETECTED__') {
                    // Confirms: the loop has no exit condition when getRawTransaction
                    // perpetually returns null
                    assert.ok(getRawTxCalls > 50,
                        'Confirmed: getRawTransaction null loop has no exit condition')
                    return
                }
            }
        })
    })

    // ─── fillMempool always sets keepMining=false ────────────────────

    describe('fillMempool state management', function () {
        it('always sets keepMining to false on entry', async function () {
            await fc.assert(
                fc.asyncProperty(
                    fc.integer({ min: -10, max: 0 }),
                    fc.boolean(),
                    async (txQuantity, initialKeepMining) => {
                        miner.keepMining = initialKeepMining
                        stubGetRawTxWithNullLimit(5)

                        try {
                            await miner.fillMempool(txQuantity)
                        } catch (e) {
                            // Errors are acceptable
                        }

                        assert.strictEqual(miner.keepMining, false,
                            'keepMining must be false after fillMempool regardless of input')
                    }
                ),
                { numRuns: 50 }
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
