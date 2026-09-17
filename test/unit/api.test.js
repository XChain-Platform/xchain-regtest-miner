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
const { createJsonRpcController, REQUIRED_ENV_VARS } = require('../../src/api')

function createMinerStub() {
    return {
        sendFundsToAddress: sinon.stub(),
        fillMempool: sinon.stub(),
        continueMining: sinon.stub(),
        setMiningTime: sinon.stub(),
        setDefaultMiningTime: sinon.stub(),
        setMockTime: sinon.stub(),
        pauseMining: sinon.stub(),
        setIdleMineInterval: sinon.stub(),
        generateBlocks: sinon.stub(),
        invalidateBlock: sinon.stub(),
        reconsiderBlock: sinon.stub(),
        getStatus: sinon.stub(),
        start: sinon.stub(),
    }
}

describe('api.js', function () {
    let miner

    describe('JSON-RPC controller logic', function () {
        let controller

        beforeEach(function () {
            miner = createMinerStub()
            controller = createJsonRpcController(miner)
        })

        afterEach(function () {
            sinon.restore()
        })

        // ─── ping ───────────────────────────────────────────────────

        describe('ping', function () {
            it('returns success status', async function () {
                const result = await controller.ping()
                assert.deepStrictEqual(result, { status: 'success', ready: false })
            })

            it('uses the complete production controller surface', function () {
                assert.deepStrictEqual(Object.keys(controller), [
                    'ping', 'status', 'health', 'send_funds', 'fill_mempool',
                    'pause_mining', 'continue_mining', 'set_mining_time',
                    'set_default_mining_time', 'set_mock_time',
                    'set_idle_mine_interval', 'generate_blocks',
                    'invalidate_block', 'reconsider_block'
                ])
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
                    error: 'There was a problem sending funds: no funds',
                })
            })
        })
    })
})

describe('api.js', function () {
    let miner

    describe('JSON-RPC controller logic', function () {
        let controller

        beforeEach(function () {
            miner = createMinerStub()
            controller = createJsonRpcController(miner)
        })

        afterEach(function () {
            sinon.restore()
        })

        // ─── fill_mempool ───────────────────────────────────────────

        describe('fill_mempool', function () {
            it('returns ok on success', async function () {
                miner.fillMempool.resolves()
                const result = await controller.fill_mempool({ tx_quantity: 100 })
                assert.strictEqual(result, 'ok')
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
                // error response, never a silent { result: 'ok' } with an empty mempool.
                miner.fillMempool.rejects(new Error('txQuantity must be a positive integer'))
                const result = await controller.fill_mempool({ tx_quantity: 50.5 })
                assert.notStrictEqual(result, 'ok')
                assert(result.error)
                assert(result.error.includes('txQuantity must be a positive integer'))
            })
        })
    })
})

describe('api.js', function () {
    let miner

    describe('JSON-RPC controller logic', function () {
        let controller

        beforeEach(function () {
            miner = createMinerStub()
            controller = createJsonRpcController(miner)
        })

        afterEach(function () {
            sinon.restore()
        })

        // ─── continue_mining ────────────────────────────────────────

        describe('continue_mining', function () {
            it('returns ok on success', async function () {
                miner.continueMining.resolves()
                const result = await controller.continue_mining({})
                assert.strictEqual(result, 'ok')
                assert(miner.continueMining.calledOnce)
            })

            it('returns error object on failure', async function () {
                miner.continueMining.rejects(new Error('fail'))
                const result = await controller.continue_mining({})
                assert(result.error.includes('continue the mining'))
            })
        })
    })
})

describe('api.js', function () {
    let miner

    describe('JSON-RPC controller logic', function () {
        let controller

        beforeEach(function () {
            miner = createMinerStub()
            controller = createJsonRpcController(miner)
        })

        afterEach(function () {
            sinon.restore()
        })

        // ─── set_mining_time ────────────────────────────────────────

        describe('set_mining_time', function () {
            it('delegates parameters to miner and returns ok', async function () {
                miner.setMiningTime.resolves()
                const result = await controller.set_mining_time({ max_time: 10000, tx_added_time: 2000 })
                assert.strictEqual(result, 'ok')
                assert(miner.setMiningTime.calledWith(10000, 2000))
            })

            it('returns error object on failure', async function () {
                miner.setMiningTime.rejects(new Error('fail'))
                const result = await controller.set_mining_time({ max_time: -1, tx_added_time: -1 })
                assert.deepStrictEqual(result, { error: 'fail' })
            })
        })
    })
})

describe('api.js', function () {
    let miner

    describe('JSON-RPC controller logic', function () {
        let controller

        beforeEach(function () {
            miner = createMinerStub()
            controller = createJsonRpcController(miner)
        })

        afterEach(function () {
            sinon.restore()
        })

        // ─── set_default_mining_time ────────────────────────────────

        describe('set_default_mining_time', function () {
            it('delegates to miner and returns ok', async function () {
                miner.setDefaultMiningTime.resolves()
                const result = await controller.set_default_mining_time()
                assert.strictEqual(result, 'ok')
                assert(miner.setDefaultMiningTime.calledOnce)
            })

            it('returns error object on failure', async function () {
                miner.setDefaultMiningTime.rejects(new Error('fail'))
                const result = await controller.set_default_mining_time()
                assert(result.error.includes('default time'))
            })
        })
    })
})

describe('api.js', function () {
    let miner

    describe('JSON-RPC controller logic', function () {
        let controller

        beforeEach(function () {
            miner = createMinerStub()
            controller = createJsonRpcController(miner)
        })

        afterEach(function () {
            sinon.restore()
        })

        // ─── set_mock_time ──────────────────────────────────────────

        describe('set_mock_time', function () {
            it('delegates the timestamp to miner and returns ok', async function () {
                miner.setMockTime.resolves(true)
                const result = await controller.set_mock_time({ timestamp: 1900000000 })
                assert.strictEqual(result, 'ok')
                assert(miner.setMockTime.calledWith(1900000000))
            })

            it('returns an error envelope when the miner refuses (e.g. mainnet)', async function () {
                miner.setMockTime.rejects(new Error('setMockTime is refused on mainnet'))
                const result = await controller.set_mock_time({ timestamp: 1900000000 })
                assert(result.error.includes('setting the mock time'))
                assert(result.error.includes('refused on mainnet'))
            })
        })
    })
})

describe('api.js', function () {
    // ─── Environment variable parsing ───────────────────────────────────

    describe('environment variable parsing', function () {
        it('reads required env vars', function () {
            assert.deepStrictEqual(REQUIRED_ENV_VARS, [
                'NETWORK', 'NODE_URL', 'NODE_PORT', 'NODE_USER',
                'NODE_PASSWORD', 'REGTEST_MINER_API_PORT'
            ])
        })
    })
})
