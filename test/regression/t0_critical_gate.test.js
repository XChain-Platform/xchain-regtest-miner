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
 **********************************************************************
 * T0 Regression Tests: Critical Gate
 *
 * The fastest, most essential regression tests. These MUST pass before any
 * code is pushed. Covers: constructor defaults, timer logic, wallet preparation
 * branching, mining loop core paths, and API health.
 *
 * Target runtime: < 15 seconds
 * Trigger: every commit (pre-push hook or first CI stage)
 */

const assert = require('assert')
const sinon = require('sinon')
const BlockchainConnector = require('../../src/rpc/blockchain_connector')

let XChainRegtestMiner
let miner
let connectorStub

function setUpMiner() {
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
}

function tearDownMiner() {
    sinon.restore()
    delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
}

describe('T0 Regression: Critical Gate', function () {
    beforeEach(setUpMiner)
    afterEach(tearDownMiner)

    // ═══════════════════════════════════════════════════════════════════
    // REG-T0-001: Constructor defaults
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T0-001: Constructor defaults', function () {
        it('initializes with correct default values', function () {
            assert.strictEqual(miner.walletNameParam, 'xchain_regtest_wallet')
            assert.strictEqual(miner.keepMining, false)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
            assert.strictEqual(miner.fillMempoolRunning, false)
            assert.ok(miner.connector)
        })
    })
})

describe('T0 Regression: Critical Gate', function () {
    beforeEach(setUpMiner)
    afterEach(tearDownMiner)

    // ═══════════════════════════════════════════════════════════════════
    // REG-T0-002: setMiningTime validation
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T0-002: setMiningTime validation', function () {
        it('accepts valid integer values', async function () {
            await miner.setMiningTime(10000, 2000)
            assert.strictEqual(miner.maxTimeToMineTxs, 10000)
            assert.strictEqual(miner.addedTimeToMineTxs, 2000)
        })

        it('rejects non-integer maxTime', async function () {
            await assert.rejects(() => miner.setMiningTime(10.5, 2000))
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })

        it('rejects zero values', async function () {
            await assert.rejects(() => miner.setMiningTime(0, 0))
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })

        it('rejects negative values', async function () {
            await assert.rejects(() => miner.setMiningTime(-1, -1))
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })

        it('rejects values below minimum (1000ms)', async function () {
            await assert.rejects(() => miner.setMiningTime(999, 999))
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })

        it('rejects values above maximum (3600000ms)', async function () {
            await assert.rejects(() => miner.setMiningTime(3600001, 3600001))
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })

        it('accepts boundary minimum (1000ms)', async function () {
            await miner.setMiningTime(1000, 1000)
            assert.strictEqual(miner.maxTimeToMineTxs, 1000)
            assert.strictEqual(miner.addedTimeToMineTxs, 1000)
        })

        it('accepts boundary maximum (3600000ms)', async function () {
            await miner.setMiningTime(3600000, 3600000)
            assert.strictEqual(miner.maxTimeToMineTxs, 3600000)
            assert.strictEqual(miner.addedTimeToMineTxs, 3600000)
        })
    })
})

describe('T0 Regression: Critical Gate', function () {
    beforeEach(setUpMiner)
    afterEach(tearDownMiner)

    // ═══════════════════════════════════════════════════════════════════
    // REG-T0-003: setDefaultMiningTime
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T0-003: setDefaultMiningTime resets to defaults', function () {
        it('restores 30000/5000 defaults', async function () {
            miner.maxTimeToMineTxs = 1000
            miner.addedTimeToMineTxs = 500
            await miner.setDefaultMiningTime()
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })
    })
})

describe('T0 Regression: Critical Gate', function () {
    beforeEach(setUpMiner)
    afterEach(tearDownMiner)

    // ═══════════════════════════════════════════════════════════════════
    // REG-T0-004: prepareWallet branching
    // ═══════════════════════════════════════════════════════════════════

    describe('REG-T0-004: prepareWallet branching', function () {
        it('skips load/create when wallet is already loaded', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'existing' })
            await miner.prepareWallet()
            assert(connectorStub.loadWallet.notCalled)
            assert(connectorStub.createWallet.notCalled)
            assert.strictEqual(miner.walletAddress, 'bcrt1qtest')
        })

        it('loads existing wallet when the probe fails', async function () {
            connectorStub.getNewAddress.rejects(new Error('no wallet loaded'))
            connectorStub.getNewAddress.onCall(10).resolves('bcrt1qtest')
            connectorStub.loadWallet.resolves({ name: 'xchain_regtest_wallet' })
            await miner.prepareWallet()
            assert(connectorStub.loadWallet.calledWith('xchain_regtest_wallet'))
            assert(connectorStub.createWallet.notCalled)
        })

        it('creates wallet when both the probe and loadWallet fail', async function () {
            connectorStub.getNewAddress.rejects(new Error('no wallet loaded'))
            connectorStub.getNewAddress.onCall(10).resolves('bcrt1qtest')
            connectorStub.loadWallet.rejects(new Error('not found'))
            connectorStub.createWallet.resolves({ name: 'xchain_regtest_wallet' })
            await miner.prepareWallet()
            assert(connectorStub.createWallet.calledWith('xchain_regtest_wallet'))
        })

        it('throws when all wallet methods fail', async function () {
            connectorStub.getNewAddress.rejects(new Error('no wallet loaded'))
            connectorStub.loadWallet.rejects(new Error('not found'))
            connectorStub.createWallet.rejects(new Error('disk full'))
            await assert.rejects(() => miner.prepareWallet(), /Could not create wallet/)
        })
    })
})

describe('T0 Regression: Critical Gate', function () {
    beforeEach(setUpMiner)
    afterEach(tearDownMiner)

    describe('REG-T0-004: prepareWallet branching', function () {
        it('mines 101 blocks when balance is zero and height <= 100', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.onFirstCall().resolves(0)
            connectorStub.getBlockchainInfo.resolves({ blocks: 50 })
            await miner.prepareWallet()
            assert(connectorStub.generateToAddress.calledWith(101, 'bcrt1qtest'))
        })

        it('mines 101 blocks when balance is zero and height > 100 (maturity depth is height-independent)', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.onFirstCall().resolves(0)
            connectorStub.getBlockchainInfo.resolves({ blocks: 200 })
            await miner.prepareWallet()
            assert(connectorStub.generateToAddress.calledWith(101, 'bcrt1qtest'))
        })

        it('does not mine when balance is positive', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.resolves(50.0)
            await miner.prepareWallet()
            assert(connectorStub.generateToAddress.notCalled)
        })
    })
})

require('./t0_critical_gate.test/01_mining_loop_core_paths.test')
require('./t0_critical_gate.test/02_fill_mempool_guards_w_3_bug_prevention.test')
require('./t0_critical_gate.test/03_send_funds_to_address_input_validation.test')
require('./t0_critical_gate.test/04_json_rpc_api_controller.test')
require('./t0_critical_gate.test/05_blockchain_connector_construction.test')
require('./t0_critical_gate.test/06_continue_mining_sets_keep_mining_flag.test')
