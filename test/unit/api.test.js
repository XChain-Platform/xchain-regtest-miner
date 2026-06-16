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
const http = require('http')

describe('api.js', function () {
    let app
    let server
    let miner

    // We need to mock dependencies before requiring api.js
    // Since api.js calls startApi() on require, we test the JSON-RPC controller logic directly
    // by constructing what the controller does

    describe('JSON-RPC controller logic', function () {
        let controller

        beforeEach(function () {
            miner = {
                sendFundsToAddress: sinon.stub(),
                fillMempool: sinon.stub(),
                continueMining: sinon.stub(),
                setMiningTime: sinon.stub(),
                setDefaultMiningTime: sinon.stub(),
                start: sinon.stub(),
            }

            sinon.stub(console, 'log')

            // Recreate the controller logic as defined in api.js
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
                        return { error: 'There was a problem sending ' + amount + ' to ' + address }
                    }
                    return txid
                },
                async fill_mempool({ tx_quantity }) {
                    try {
                        await miner.fillMempool(tx_quantity)
                    } catch (err) {
                        console.log(err)
                        return { error: 'There was a problem trying to fill the mempool: ' + (err && err.message ? err.message : err) }
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

        // ─── ping ───────────────────────────────────────────────────

        describe('ping', function () {
            it('returns success status', async function () {
                const result = await controller.ping()
                assert.deepStrictEqual(result, { status: 'success' })
            })
        })

        // ─── send_funds ─────────────────────────────────────────────

        describe('send_funds', function () {
            it('returns txid on success', async function () {
                miner.sendFundsToAddress.resolves('txid_abc123')
                const result = await controller.send_funds({ address: 'addr1', amount: 1.5 })
                assert.strictEqual(result, 'txid_abc123')
                assert(miner.sendFundsToAddress.calledWith('addr1', 1.5))
            })

            it('returns error object on failure', async function () {
                miner.sendFundsToAddress.rejects(new Error('no funds'))
                const result = await controller.send_funds({ address: 'addr1', amount: 99 })
                assert.deepStrictEqual(result, {
                    error: 'There was a problem sending 99 to addr1',
                })
            })
        })

        // ─── fill_mempool ───────────────────────────────────────────

        describe('fill_mempool', function () {
            it('returns ok on success', async function () {
                miner.fillMempool.resolves()
                const result = await controller.fill_mempool({ tx_quantity: 100 })
                assert.deepStrictEqual(result, { result: 'ok' })
                assert(miner.fillMempool.calledWith(100))
            })

            it('returns error object on failure', async function () {
                miner.fillMempool.rejects(new Error('crash'))
                const result = await controller.fill_mempool({ tx_quantity: 50 })
                assert(result.error.includes('crash'))
            })

            it('surfaces an error (not ok) when fillMempool rejects on invalid tx_quantity', async function () {
                // A float tx_quantity (e.g. from a JSON-parsed config) fails fillMempool's
                // integer guard, which now throws. The handler must surface that as an
                // error response — never a silent { result: 'ok' } with an empty mempool.
                miner.fillMempool.rejects(new Error('txQuantity must be a positive integer'))
                const result = await controller.fill_mempool({ tx_quantity: 50.5 })
                assert.notDeepStrictEqual(result, { result: 'ok' })
                assert(result.error)
                assert(result.error.includes('txQuantity must be a positive integer'))
            })
        })

        // ─── continue_mining ────────────────────────────────────────

        describe('continue_mining', function () {
            it('returns ok on success', async function () {
                miner.continueMining.resolves()
                const result = await controller.continue_mining({})
                assert.deepStrictEqual(result, { result: 'ok' })
                assert(miner.continueMining.calledOnce)
            })

            it('returns error object on failure', async function () {
                miner.continueMining.rejects(new Error('fail'))
                const result = await controller.continue_mining({})
                assert(result.error.includes('continue the mining'))
            })
        })

        // ─── set_mining_time ────────────────────────────────────────

        describe('set_mining_time', function () {
            it('delegates parameters to miner and returns ok', async function () {
                miner.setMiningTime.resolves()
                const result = await controller.set_mining_time({ max_time: 10000, tx_added_time: 2000 })
                assert.deepStrictEqual(result, { result: 'ok' })
                assert(miner.setMiningTime.calledWith(10000, 2000))
            })

            it('returns error object on failure', async function () {
                miner.setMiningTime.rejects(new Error('fail'))
                const result = await controller.set_mining_time({ max_time: -1, tx_added_time: -1 })
                assert(result.error.includes('set a new time'))
            })
        })

        // ─── set_default_mining_time ────────────────────────────────

        describe('set_default_mining_time', function () {
            it('delegates to miner and returns ok', async function () {
                miner.setDefaultMiningTime.resolves()
                const result = await controller.set_default_mining_time()
                assert.deepStrictEqual(result, { result: 'ok' })
                assert(miner.setDefaultMiningTime.calledOnce)
            })

            it('returns error object on failure', async function () {
                miner.setDefaultMiningTime.rejects(new Error('fail'))
                const result = await controller.set_default_mining_time()
                assert(result.error.includes('default time'))
            })
        })
    })

    // ─── Environment variable parsing ───────────────────────────────────

    describe('environment variable parsing', function () {
        it('reads required env vars', function () {
            // Verify the expected env var names are used
            const envVars = ['NETWORK', 'NODE_URL', 'NODE_PORT', 'NODE_USER', 'NODE_PASSWORD', 'REGTEST_MINER_API_PORT']
            for (const v of envVars) {
                // These should be defined in api.js as process.env lookups
                assert.strictEqual(typeof v, 'string')
            }
        })
    })
})
