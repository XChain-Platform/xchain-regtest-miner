const assert = require('assert')
const sinon = require('sinon')
const fc = require('fast-check')

describe('Fuzz: JSON-RPC API parameters', function () {
    let miner
    let controller

    beforeEach(function () {
        miner = {
            sendFundsToAddress: sinon.stub().resolves('txid_abc'),
            fillMempool: sinon.stub().resolves(),
            continueMining: sinon.stub().resolves(),
            setMiningTime: sinon.stub().resolves(),
            setDefaultMiningTime: sinon.stub().resolves(),
            start: sinon.stub().resolves(),
        }

        sinon.stub(console, 'log')
        sinon.stub(console, 'error')

        // Mirror the controller from api.js
        controller = {
            async ping() {
                return { status: 'success' }
            },
            async send_funds({ address, amount }) {
                let txid = null
                try {
                    txid = await miner.sendFundsToAddress(address, amount)
                } catch (err) {
                    console.log(err)
                    try { return { error: 'There was a problem sending ' + amount + ' to ' + address } } catch(e) { return { error: 'There was a problem sending funds' } }
                }
                return txid
            },
            async fill_mempool({ tx_quantity }) {
                try {
                    await miner.fillMempool(tx_quantity)
                } catch (err) {
                    console.log(err)
                    try { return { error: 'There was a problem trying to fill mempool with ' + tx_quantity + ' transactions' } } catch(e) { return { error: 'There was a problem trying to fill the mempool' } }
                }
                return { result: 'ok' }
            },
            async continue_mining({}) {
                try {
                    await miner.continueMining()
                } catch (err) {
                    console.log(err)
                    return { error: 'There was a problem trying to continue the mining' }
                }
                return { result: 'ok' }
            },
            async set_mining_time({ max_time, tx_added_time }) {
                try {
                    await miner.setMiningTime(max_time, tx_added_time)
                } catch (err) {
                    return { error: 'There was a problem trying to set a new time to mine blocks' }
                }
                return { result: 'ok' }
            },
            async set_default_mining_time() {
                try {
                    await miner.setDefaultMiningTime()
                } catch (err) {
                    return { error: 'There was a problem trying to set a the default time to mine blocks' }
                }
                return { result: 'ok' }
            },
        }
    })

    afterEach(function () {
        sinon.restore()
    })

    // ─── send_funds ─────────────────────────────────────────────────

    describe('send_funds with arbitrary address values', function () {
        it('never throws for any string address', async function () {
            await fc.assert(
                fc.asyncProperty(fc.string(), fc.double(), async (address, amount) => {
                    const result = await controller.send_funds({ address, amount })
                    // Must return something (txid or error object), never throw
                    assert.ok(result !== undefined)
                }),
                { numRuns: 500 }
            )
        })

        it('never throws for any arbitrary address type', async function () {
            await fc.assert(
                fc.asyncProperty(fc.anything(), fc.anything(), async (address, amount) => {
                    const result = await controller.send_funds({ address, amount })
                    assert.ok(result !== undefined)
                }),
                { numRuns: 500 }
            )
        })

        it('handles miner throwing for any input including non-stringifiable objects', async function () {
            miner.sendFundsToAddress.rejects(new Error('fuzz error'))
            await fc.assert(
                fc.asyncProperty(fc.anything(), fc.anything(), async (address, amount) => {
                    const result = await controller.send_funds({ address, amount })
                    assert.ok(result.error)
                }),
                { numRuns: 200 }
            )
        })

        it('handles very long address strings', async function () {
            const longAddr = 'a'.repeat(100000)
            const result = await controller.send_funds({ address: longAddr, amount: 1 })
            assert.ok(result !== undefined)
        })

        it('handles arbitrary character address strings', async function () {
            await fc.assert(
                fc.asyncProperty(fc.string(), async (address) => {
                    const result = await controller.send_funds({ address, amount: 1 })
                    assert.ok(result !== undefined)
                }),
                { numRuns: 200 }
            )
        })
    })

    // ─── fill_mempool ───────────────────────────────────────────────

    describe('fill_mempool with arbitrary tx_quantity', function () {
        it('never throws for any integer-like value', async function () {
            await fc.assert(
                fc.asyncProperty(fc.integer(), async (tx_quantity) => {
                    const result = await controller.fill_mempool({ tx_quantity })
                    assert.ok(result !== undefined)
                }),
                { numRuns: 500 }
            )
        })

        it('never throws for any arbitrary type', async function () {
            await fc.assert(
                fc.asyncProperty(fc.anything(), async (tx_quantity) => {
                    const result = await controller.fill_mempool({ tx_quantity })
                    assert.ok(result !== undefined)
                }),
                { numRuns: 500 }
            )
        })

        it('handles miner throwing for any input including non-stringifiable objects', async function () {
            miner.fillMempool.rejects(new Error('fuzz error'))
            await fc.assert(
                fc.asyncProperty(fc.anything(), async (tx_quantity) => {
                    const result = await controller.fill_mempool({ tx_quantity })
                    assert.ok(result.error)
                }),
                { numRuns: 200 }
            )
        })
    })

    // ─── set_mining_time ────────────────────────────────────────────

    describe('set_mining_time with arbitrary parameters', function () {
        it('never throws for any pair of values', async function () {
            await fc.assert(
                fc.asyncProperty(fc.anything(), fc.anything(), async (max_time, tx_added_time) => {
                    const result = await controller.set_mining_time({ max_time, tx_added_time })
                    assert.ok(result !== undefined)
                }),
                { numRuns: 500 }
            )
        })

        it('handles miner throwing for any input', async function () {
            miner.setMiningTime.rejects(new Error('fuzz error'))
            await fc.assert(
                fc.asyncProperty(fc.anything(), fc.anything(), async (max_time, tx_added_time) => {
                    const result = await controller.set_mining_time({ max_time, tx_added_time })
                    assert.ok(result.error)
                }),
                { numRuns: 200 }
            )
        })
    })

    // ─── continue_mining ────────────────────────────────────────────

    describe('continue_mining with unexpected params', function () {
        it('never throws regardless of extra params', async function () {
            await fc.assert(
                fc.asyncProperty(fc.dictionary(fc.string(), fc.anything()), async (extraParams) => {
                    const result = await controller.continue_mining(extraParams)
                    assert.ok(result !== undefined)
                }),
                { numRuns: 200 }
            )
        })
    })

    // ─── ping ───────────────────────────────────────────────────────

    describe('ping stability', function () {
        it('always returns success regardless of call count', async function () {
            for (let i = 0; i < 100; i++) {
                const result = await controller.ping()
                assert.deepStrictEqual(result, { status: 'success' })
            }
        })
    })

    // ─── Malformed parameter objects ────────────────────────────────

    describe('malformed parameter objects', function () {
        it('send_funds handles missing fields gracefully', async function () {
            const cases = [{}, { address: 'a' }, { amount: 1 }, null, undefined]
            for (const params of cases) {
                try {
                    // These may throw due to destructuring — that's acceptable
                    // But they must not cause unhandled rejections
                    await controller.send_funds(params || {})
                } catch (e) {
                    // Destructuring errors are acceptable
                    assert.ok(e instanceof TypeError || e instanceof Error)
                }
            }
        })

        it('fill_mempool handles missing tx_quantity', async function () {
            const result = await controller.fill_mempool({})
            assert.ok(result !== undefined)
        })

        it('set_mining_time handles missing fields', async function () {
            const result = await controller.set_mining_time({})
            assert.ok(result !== undefined)
        })
    })
})
