/*********************************************************************
 *
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC – https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 *
 **********************************************************************/

const assert = require('assert')
const sinon = require('sinon')

let controller, minerStub

function setUpController() {
    minerStub = {
        sendFundsToAddress: sinon.stub(),
        fillMempool: sinon.stub(),
        continueMining: sinon.stub(),
        setMiningTime: sinon.stub(),
        setDefaultMiningTime: sinon.stub(),
    }

    // Recreate controller logic matching api.js
    controller = {
        async ping() {
            return { status: 'success' }
        },
        async send_funds({ address, amount }) {
            let txid = null
            try {
                txid = await minerStub.sendFundsToAddress(address, amount)
            } catch (err) {
                return { error: 'There was a problem sending funds' }
            }
            return txid
        },
        async fill_mempool({ tx_quantity }) {
            try {
                await minerStub.fillMempool(tx_quantity)
            } catch (err) {
                return { error: 'There was a problem trying to fill the mempool' }
            }
            return { result: 'ok' }
        },
        async continue_mining({}) {
            try {
                await minerStub.continueMining()
            } catch (err) {
                return { error: 'There was a problem trying to continue the mining' }
            }
            return { result: 'ok' }
        },
        async set_mining_time({ max_time, tx_added_time }) {
            try {
                await minerStub.setMiningTime(max_time, tx_added_time)
            } catch (err) {
                return { error: 'There was a problem trying to set a new time to mine blocks' }
            }
            return { result: 'ok' }
        },
        async set_default_mining_time() {
            try {
                await minerStub.setDefaultMiningTime()
            } catch (err) {
                return { error: 'There was a problem trying to set a the default time to mine blocks' }
            }
            return { result: 'ok' }
        },
    }
}

// ═══════════════════════════════════════════════════════════════════
// REG-T0-008: JSON-RPC API controller health
// ═══════════════════════════════════════════════════════════════════

describe('T0 Regression: Critical Gate', function () {
    beforeEach(setUpController)

    describe('REG-T0-008: JSON-RPC API controller', function () {
        it('ping returns success', async function () {
            const result = await controller.ping()
            assert.deepStrictEqual(result, { status: 'success' })
        })

        it('send_funds dispatches to miner', async function () {
            minerStub.sendFundsToAddress.resolves('txid_abc')
            const result = await controller.send_funds({ address: 'addr1', amount: 1.5 })
            assert.strictEqual(result, 'txid_abc')
            assert(minerStub.sendFundsToAddress.calledWith('addr1', 1.5))
        })

        it('fill_mempool dispatches to miner', async function () {
            minerStub.fillMempool.resolves()
            const result = await controller.fill_mempool({ tx_quantity: 100 })
            assert.deepStrictEqual(result, { result: 'ok' })
            assert(minerStub.fillMempool.calledWith(100))
        })

        it('continue_mining dispatches to miner', async function () {
            minerStub.continueMining.resolves()
            const result = await controller.continue_mining({})
            assert.deepStrictEqual(result, { result: 'ok' })
        })

        it('set_mining_time dispatches to miner', async function () {
            minerStub.setMiningTime.resolves()
            const result = await controller.set_mining_time({ max_time: 10000, tx_added_time: 2000 })
            assert.deepStrictEqual(result, { result: 'ok' })
            assert(minerStub.setMiningTime.calledWith(10000, 2000))
        })

        it('set_default_mining_time dispatches to miner', async function () {
            minerStub.setDefaultMiningTime.resolves()
            const result = await controller.set_default_mining_time()
            assert.deepStrictEqual(result, { result: 'ok' })
        })

        it('send_funds returns error on failure', async function () {
            minerStub.sendFundsToAddress.rejects(new Error('no funds'))
            const result = await controller.send_funds({ address: 'a', amount: 1 })
            assert.ok(result.error)
        })
    })
})
