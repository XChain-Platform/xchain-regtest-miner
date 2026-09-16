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
 * T1 Regression Tests: Standard Regression
 *
 * Comprehensive regression suite covering BlockchainConnector RPC methods,
 * integration seams (Miner↔Connector sequences), boundary conditions,
 * security validation, and fillMempool chunking logic.
 *
 * Target runtime: < 2 minutes
 * Trigger: every PR and merge to main
 */
const assert = require('assert')
const sinon = require('sinon')
const axios = require('axios')
const BlockchainConnector = require('../../../src/rpc/blockchain_connector')


// ═══════════════════════════════════════════════════════════════════════
// Section D: Security Regression
// ═══════════════════════════════════════════════════════════════════════

let XChainRegtestMiner, miner, connectorStub
let connector, axiosPostStub

function restoreMiner() {
    sinon.restore()
    delete require.cache[require.resolve('../../../src/XChainRegtestMiner')]
}

function registerSendFundsHooks() {
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
            setTxFee: sinon.stub().resolves(true),
            setWalletName: sinon.stub(),
        }

        sinon.stub(BlockchainConnector.prototype, 'constructor')
        XChainRegtestMiner = require('../../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        miner.connector = connectorStub
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })
    afterEach(restoreMiner)
}

function registerFillMempoolHooks() {
    beforeEach(function () {
        sinon.stub(BlockchainConnector.prototype, 'constructor')
        XChainRegtestMiner = require('../../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        miner.connector = {
            getWalletInfo: sinon.stub(),
            loadWallet: sinon.stub(),
            createWallet: sinon.stub(),
            getNewAddress: sinon.stub(),
            getBalance: sinon.stub(),
            getBlockchainInfo: sinon.stub(),
            generateToAddress: sinon.stub(),
            getRawMempool: sinon.stub(),
            sendToAddress: sinon.stub(),
            setTxFee: sinon.stub().resolves(true),
            setWalletName: sinon.stub(),
            getRawTransaction: sinon.stub(),
            sendRawTransaction: sinon.stub(),
        }
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })
    afterEach(restoreMiner)
}

function registerMiningTimeHooks() {
    beforeEach(function () {
        sinon.stub(BlockchainConnector.prototype, 'constructor')
        XChainRegtestMiner = require('../../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        miner.connector = {}
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })
    afterEach(restoreMiner)
}

function registerErrorSanitizationHooks() {
    beforeEach(function () {
        connector = new BlockchainConnector('localhost', '18332', 'secretuser', 'secretpass')
        axiosPostStub = sinon.stub(axios, 'post')
        sinon.stub(connector, 'sleep').resolves()
        sinon.stub(console, 'error')
        sinon.stub(console, 'log')
    })
    afterEach(function () {
        sinon.restore()
    })
}

// ─── REG-T1-D01: Input validation ──────────────────────────────

describe('T1 Regression: Security', function () {
    describe('REG-T1-D01: sendFundsToAddress input validation', function () {
        registerSendFundsHooks()

        it('rejects null address', async function () {
            await assert.rejects(() => miner.sendFundsToAddress(null, 1.0), /Invalid address/)
            assert.strictEqual(connectorStub.sendToAddress.callCount, 0)
        })

        it('rejects undefined address', async function () {
            await assert.rejects(() => miner.sendFundsToAddress(undefined, 1.0), /Invalid address/)
        })

        it('rejects object address', async function () {
            await assert.rejects(() => miner.sendFundsToAddress({ toString: 'bad' }, 1.0), /Invalid address/)
        })

        it('rejects array address', async function () {
            await assert.rejects(() => miner.sendFundsToAddress(['bcrt1qtest'], 1.0), /Invalid address/)
        })

        it('rejects boolean address', async function () {
            await assert.rejects(() => miner.sendFundsToAddress(true, 1.0), /Invalid address/)
        })

        it('rejects NaN amount', async function () {
            await assert.rejects(() => miner.sendFundsToAddress('addr', NaN), /Invalid amount/)
        })

        it('rejects Infinity amount', async function () {
            await assert.rejects(() => miner.sendFundsToAddress('addr', Infinity), /Invalid amount/)
        })

        it('rejects -Infinity amount', async function () {
            await assert.rejects(() => miner.sendFundsToAddress('addr', -Infinity), /Invalid amount/)
        })
    })
})

// ─── REG-T1-D02: fillMempool input validation ──────────────────

describe('T1 Regression: Security', function () {
    describe('REG-T1-D02: fillMempool input validation', function () {
        registerFillMempoolHooks()

        it('rejects zero', async function () {
            miner.keepMining = true
            await assert.rejects(() => miner.fillMempool(0), /positive integer/)
            assert.strictEqual(miner.keepMining, true, 'keepMining unchanged for invalid input')
        })

        it('rejects negative', async function () {
            miner.keepMining = true
            await assert.rejects(() => miner.fillMempool(-1), /positive integer/)
            assert.strictEqual(miner.keepMining, true)
        })

        it('rejects float', async function () {
            miner.keepMining = true
            await assert.rejects(() => miner.fillMempool(1.5), /positive integer/)
            assert.strictEqual(miner.keepMining, true)
        })

        it('rejects string', async function () {
            miner.keepMining = true
            await assert.rejects(() => miner.fillMempool('abc'), /positive integer/)
            assert.strictEqual(miner.keepMining, true)
        })

        it('rejects null', async function () {
            miner.keepMining = true
            await assert.rejects(() => miner.fillMempool(null), /positive integer/)
            assert.strictEqual(miner.keepMining, true)
        })

        it('rejects exceeding maximum (50001)', async function () {
            await assert.rejects(() => miner.fillMempool(50001), /maximum/)
        })

        it('rejects concurrent calls', async function () {
            miner.fillMempoolRunning = true
            await assert.rejects(() => miner.fillMempool(10), /already running/)
        })
    })
})

// ─── REG-T1-D03: setMiningTime input validation ────────────────

describe('T1 Regression: Security', function () {
    describe('REG-T1-D03: setMiningTime input validation', function () {
        registerMiningTimeHooks()

        it('rejects NaN maxTime', async function () {
            await assert.rejects(() => miner.setMiningTime(NaN, 5000))
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })

        it('rejects Infinity', async function () {
            await assert.rejects(() => miner.setMiningTime(Infinity, 5000))
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })

        it('rejects string', async function () {
            await assert.rejects(() => miner.setMiningTime('abc', 5000))
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })

        it('rejects null', async function () {
            await assert.rejects(() => miner.setMiningTime(null, 5000))
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })

        it('rejects undefined', async function () {
            await assert.rejects(() => miner.setMiningTime(undefined, 5000))
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
        })
    })
})

// ─── REG-T1-D04: Error sanitization (no credential leaks) ──────

describe('T1 Regression: Security', function () {
    describe('REG-T1-D04: Error sanitization, no credential leaks', function () {
        registerErrorSanitizationHooks()

        it('sendToAddress does not expose credentials in error', async function () {
            const axiosError = new Error('connect ECONNREFUSED http://localhost:18332')
            axiosError.config = { url: 'http://localhost:18332', auth: { username: 'secretuser', password: 'secretpass' } }
            axiosPostStub.rejects(axiosError)

            try {
                await connector.sendToAddress('bcrt1qtest', 1.0)
                assert.fail('should have thrown')
            } catch (err) {
                assert.ok(!err.message.includes('secretuser'))
                assert.ok(!err.message.includes('secretpass'))
            }
        })

        it('getRawMempool does not expose credentials in error', async function () {
            const axiosError = new Error('ECONNREFUSED')
            axiosError.config = { auth: { username: 'secretuser', password: 'secretpass' } }
            axiosPostStub.rejects(axiosError)

            try {
                await connector.getRawMempool()
                assert.fail('should have thrown')
            } catch (err) {
                assert.ok(!err.message.includes('secretuser'))
                assert.ok(!err.message.includes('secretpass'))
            }
        })

        it('generateToAddress does not expose credentials in error', async function () {
            const axiosError = new Error('timeout')
            axiosError.config = { auth: { username: 'secretuser', password: 'secretpass' } }
            axiosPostStub.rejects(axiosError)

            try {
                await connector.generateToAddress(1, 'addr')
                assert.fail('should have thrown')
            } catch (err) {
                assert.ok(!err.message.includes('secretuser'))
                assert.ok(!err.message.includes('secretpass'))
            }
        })

        it('getWalletInfo does not log credentials during retries', async function () {
            axiosPostStub.onFirstCall().rejects(new Error('fail'))
            axiosPostStub.onSecondCall().resolves({ data: { result: { walletname: 'w' } } })
            await connector.getWalletInfo(5)
            for (const call of console.error.getCalls()) {
                for (const arg of call.args) {
                    const str = typeof arg === 'string' ? arg : String(arg)
                    assert.ok(!str.includes('secretpass'), 'Logged credentials during retry')
                }
            }
        })
    })
})
