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
const { createRpcMethods: createJsonRpcController } = require('../../src/api/rpc_methods')

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

        // ─── status ─────────────────────────────────────────────────

        describe('status', function () {
            it('returns the miner status snapshot unchanged', async function () {
                const snapshot = { wallet_ready: true, mine_failures: 0 }
                miner.getStatus.returns(snapshot)
                const result = await controller.status()
                assert.strictEqual(result, snapshot)
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

        // ─── pause_mining ───────────────────────────────────────────

        describe('pause_mining', function () {
            it('returns ok on success', async function () {
                miner.pauseMining.resolves()
                const result = await controller.pause_mining({})
                assert.strictEqual(result, 'ok')
                assert(miner.pauseMining.calledOnce)
            })

            it('returns error object on failure', async function () {
                miner.pauseMining.rejects(new Error('fail'))
                const result = await controller.pause_mining({})
                assert(result.error.includes('pause the mining'))
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

        // ─── set_idle_mine_interval ─────────────────────────────────

        describe('set_idle_mine_interval', function () {
            it('delegates the interval to miner and returns ok', async function () {
                miner.setIdleMineInterval.resolves()
                const result = await controller.set_idle_mine_interval({ interval_ms: 5000 })
                assert.strictEqual(result, 'ok')
                assert(miner.setIdleMineInterval.calledWith(5000))
            })

            it('returns error object on failure', async function () {
                miner.setIdleMineInterval.rejects(new Error('fail'))
                const result = await controller.set_idle_mine_interval({ interval_ms: 0 })
                assert(result.error.includes('setting the idle mine interval'))
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

        // ─── generate_blocks ────────────────────────────────────────

        describe('generate_blocks', function () {
            it('returns the count and hashes on success', async function () {
                miner.generateBlocks.resolves(['hash1', 'hash2'])
                const result = await controller.generate_blocks({ count: 2 })
                assert.deepStrictEqual(result, { count: 2, hashes: ['hash1', 'hash2'] })
                assert(miner.generateBlocks.calledWith(2))
            })

            it('returns error object on failure', async function () {
                miner.generateBlocks.rejects(new Error('fail'))
                const result = await controller.generate_blocks({ count: 1 })
                assert(result.error.includes('generating blocks'))
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

        // ─── invalidate_block ───────────────────────────────────────

        describe('invalidate_block', function () {
            it('returns ok on success', async function () {
                miner.invalidateBlock.resolves()
                const result = await controller.invalidate_block({ block_hash: 'abc' })
                assert.strictEqual(result, 'ok')
                assert(miner.invalidateBlock.calledWith('abc'))
            })

            it('returns error object on failure', async function () {
                miner.invalidateBlock.rejects(new Error('fail'))
                const result = await controller.invalidate_block({ block_hash: 'abc' })
                assert(result.error.includes('invalidating the block'))
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

        // ─── reconsider_block ───────────────────────────────────────

        describe('reconsider_block', function () {
            it('returns ok on success', async function () {
                miner.reconsiderBlock.resolves()
                const result = await controller.reconsider_block({ block_hash: 'abc' })
                assert.strictEqual(result, 'ok')
                assert(miner.reconsiderBlock.calledWith('abc'))
            })

            it('returns error object on failure', async function () {
                miner.reconsiderBlock.rejects(new Error('fail'))
                const result = await controller.reconsider_block({ block_hash: 'abc' })
                assert(result.error.includes('reconsidering the block'))
            })
        })
    })
})
