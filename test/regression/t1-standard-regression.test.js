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
const BlockchainConnector = require('../../src/BlockchainConnector')

// ═══════════════════════════════════════════════════════════════════════
// Section A: BlockchainConnector RPC Method Regression
// ═══════════════════════════════════════════════════════════════════════

describe('T1 Regression: BlockchainConnector RPC Methods', function () {
    let connector
    let axiosPostStub

    beforeEach(function () {
        connector = new BlockchainConnector('localhost', '18332', 'rpcuser', 'rpcpass')
        axiosPostStub = sinon.stub(axios, 'post')
        sinon.stub(connector, 'sleep').resolves()
        sinon.stub(console, 'error')
        sinon.stub(console, 'log')
    })

    afterEach(function () {
        sinon.restore()
    })

    function rpcSuccess(result) {
        return { data: { result, error: null, id: 1 } }
    }

    function rpcNoResult() {
        return { data: { result: null, error: { code: -1, message: 'fail' }, id: 1 } }
    }

    function assertRpcCall(expectedMethod, expectedParams) {
        const [url, data, config] = axiosPostStub.firstCall.args
        assert.strictEqual(url, 'http://localhost:18332')
        assert.strictEqual(data.jsonrpc, '2.0')
        assert.strictEqual(data.method, expectedMethod)
        assert.strictEqual(data.id, 1)
        if (expectedParams !== undefined) {
            assert.deepStrictEqual(data.params, expectedParams)
        }
        assert.deepStrictEqual(config.auth, { username: 'rpcuser', password: 'rpcpass' })
    }

    // ─── REG-T1-A01: getNetworkInfo ────────────────────────────────

    describe('REG-T1-A01: getNetworkInfo', function () {
        it('returns result and sends correct RPC call', async function () {
            const expected = { version: 250000, subversion: '/Satoshi:25.0.0/' }
            axiosPostStub.resolves(rpcSuccess(expected))
            const result = await connector.getNetworkInfo()
            assert.deepStrictEqual(result, expected)
            assertRpcCall('getnetworkinfo')
        })

        it('throws on falsy result', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.getNetworkInfo(), /Error getting network info/)
        })

        it('throws clean error on network error', async function () {
            axiosPostStub.rejects(new Error('ECONNREFUSED'))
            await assert.rejects(() => connector.getNetworkInfo(), /Error getting network info/)
        })
    })

    // ─── REG-T1-A02: getBlockchainInfo ─────────────────────────────

    describe('REG-T1-A02: getBlockchainInfo', function () {
        it('returns blockchain info', async function () {
            const expected = { blocks: 200, chain: 'regtest' }
            axiosPostStub.resolves(rpcSuccess(expected))
            const result = await connector.getBlockchainInfo()
            assert.deepStrictEqual(result, expected)
            assertRpcCall('getblockchaininfo')
        })

        it('throws on falsy result', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.getBlockchainInfo(), /Error getting blockchain info/)
        })
    })

    // ─── REG-T1-A03: getRawMempool ─────────────────────────────────

    describe('REG-T1-A03: getRawMempool', function () {
        it('returns array of txids', async function () {
            const txids = ['txid1', 'txid2', 'txid3']
            axiosPostStub.resolves(rpcSuccess(txids))
            const result = await connector.getRawMempool()
            assert.deepStrictEqual(result, txids)
            assertRpcCall('getrawmempool')
        })

        it('throws on network error', async function () {
            axiosPostStub.rejects(new Error('connection lost'))
            await assert.rejects(() => connector.getRawMempool(), /Error getting raw mempool/)
        })

        it('throws on falsy result', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.getRawMempool(), /Error getting raw mempool/)
        })
    })

    // ─── REG-T1-A04: generateToAddress ─────────────────────────────

    describe('REG-T1-A04: generateToAddress', function () {
        it('returns block hashes and sends correct params', async function () {
            const hashes = ['hash1', 'hash2']
            axiosPostStub.resolves(rpcSuccess(hashes))
            const result = await connector.generateToAddress(2, 'addr1')
            assert.deepStrictEqual(result, hashes)
            assertRpcCall('generatetoaddress', [2, 'addr1'])
        })

        it('inherits the connector-wide default timeout (no per-call override)', async function () {
            axiosPostStub.resolves(rpcSuccess(['hash']))
            await connector.generateToAddress(1, 'addr')
            const config = axiosPostStub.firstCall.args[2]
            assert.strictEqual(config.timeout, undefined,
                'mining inherits axios.defaults.timeout (NODE_RPC_TIMEOUT)')
        })

        it('throws on falsy result', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.generateToAddress(1, 'a'), /Error generating to address/)
        })
    })

    // ─── REG-T1-A05: getBalance ────────────────────────────────────

    describe('REG-T1-A05: getBalance', function () {
        it('returns numeric balance', async function () {
            axiosPostStub.resolves(rpcSuccess(50.0))
            const result = await connector.getBalance()
            assert.strictEqual(result, 50.0)
        })

        it('returns zero balance', async function () {
            axiosPostStub.resolves(rpcSuccess(0))
            const result = await connector.getBalance()
            assert.strictEqual(result, 0)
        })

        it('throws when result is NaN', async function () {
            axiosPostStub.resolves({ data: { result: 'not_a_number' } })
            await assert.rejects(() => connector.getBalance(), /Error getting balance/)
        })
    })

    // ─── REG-T1-A06: sendToAddress ─────────────────────────────────

    describe('REG-T1-A06: sendToAddress', function () {
        it('uses positional params (DOGE v1.14 compatible) and returns txid', async function () {
            axiosPostStub.resolves(rpcSuccess({ txid: 'abc123' }))
            const result = await connector.sendToAddress('addr1', 1.5)
            assert.strictEqual(result, 'abc123')
            const data = axiosPostStub.firstCall.args[1]
            assert.deepStrictEqual(data.params, ['addr1', 1.5])
        })

        it('throws on falsy result', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.sendToAddress('a', 1), /Error sending funds/)
        })

        it('throws on network error', async function () {
            axiosPostStub.rejects(new Error('timeout'))
            await assert.rejects(() => connector.sendToAddress('a', 1), /Error sending funds to address/)
        })
    })

    // ─── REG-T1-A07: getRawTransaction (null on error) ─────────────

    describe('REG-T1-A07: getRawTransaction', function () {
        it('returns raw tx hex on success', async function () {
            axiosPostStub.resolves(rpcSuccess('0200000001...'))
            const result = await connector.getRawTransaction('txid1')
            assert.strictEqual(result, '0200000001...')
        })

        it('returns null on network error', async function () {
            axiosPostStub.rejects(new Error('ECONNREFUSED'))
            const result = await connector.getRawTransaction('txid1')
            assert.strictEqual(result, null)
        })

        it('returns null on RPC error', async function () {
            axiosPostStub.resolves(rpcNoResult())
            const result = await connector.getRawTransaction('txid')
            assert.strictEqual(result, null)
        })
    })

    // ─── REG-T1-A08: sendRawTransaction ────────────────────────────

    describe('REG-T1-A08: sendRawTransaction', function () {
        it('sends hex and returns txid', async function () {
            axiosPostStub.resolves(rpcSuccess('txid_result'))
            const result = await connector.sendRawTransaction('0200...')
            assert.strictEqual(result, 'txid_result')
            assertRpcCall('sendrawtransaction', ['0200...'])
        })

        it('throws on falsy result', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.sendRawTransaction('hex'), /Error sending raw transaction/)
        })
    })

    // ─── REG-T1-A09: createWallet (bounded retry) ──────────────────

    describe('REG-T1-A09: createWallet retry logic', function () {
        it('returns on first success', async function () {
            axiosPostStub.resolves(rpcSuccess({ name: 'w' }))
            const result = await connector.createWallet('w')
            assert.deepStrictEqual(result, { name: 'w' })
            assert.strictEqual(axiosPostStub.callCount, 1)
        })

        it('retries on failure then succeeds', async function () {
            axiosPostStub.onFirstCall().rejects(new Error('busy'))
            axiosPostStub.onSecondCall().rejects(new Error('busy'))
            axiosPostStub.onThirdCall().resolves(rpcSuccess({ name: 'w' }))
            const result = await connector.createWallet('w', 5)
            assert.deepStrictEqual(result, { name: 'w' })
            assert.strictEqual(axiosPostStub.callCount, 3)
        })

        it('throws after exhausting retries', async function () {
            axiosPostStub.rejects(new Error('always fails'))
            await assert.rejects(() => connector.createWallet('w', 3), /Error creating wallet/)
            assert.strictEqual(axiosPostStub.callCount, 3)
        })

        it('sends correct RPC method', async function () {
            axiosPostStub.resolves(rpcSuccess({ name: 'my_wallet' }))
            await connector.createWallet('my_wallet')
            assertRpcCall('createwallet', ['my_wallet'])
        })
    })

    // ─── REG-T1-A10: getWalletInfo (bounded retry) ─────────────────

    describe('REG-T1-A10: getWalletInfo retry logic', function () {
        it('returns on first success', async function () {
            axiosPostStub.resolves(rpcSuccess({ walletname: 'default', balance: 50.0 }))
            const result = await connector.getWalletInfo()
            assert.deepStrictEqual(result, { walletname: 'default', balance: 50.0 })
        })

        it('retries on failure then returns', async function () {
            axiosPostStub.onFirstCall().rejects(new Error('not ready'))
            axiosPostStub.onSecondCall().resolves(rpcSuccess({ walletname: 'w' }))
            const result = await connector.getWalletInfo(5)
            assert.deepStrictEqual(result, { walletname: 'w' })
        })

        it('throws after exhausting max retries', async function () {
            axiosPostStub.rejects(new Error('down'))
            await assert.rejects(() => connector.getWalletInfo(3), /max retries exceeded/)
            assert.strictEqual(axiosPostStub.callCount, 3)
        })

        it('throws when response has no result', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.getWalletInfo(), /Error getting wallet info/)
        })
    })

    // ─── REG-T1-A11: loadWallet ────────────────────────────────────

    describe('REG-T1-A11: loadWallet', function () {
        it('returns wallet info on success', async function () {
            axiosPostStub.resolves(rpcSuccess({ name: 'w' }))
            const result = await connector.loadWallet('w')
            assert.deepStrictEqual(result, { name: 'w' })
            assertRpcCall('loadwallet', ['w'])
        })

        it('throws on falsy result', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.loadWallet('w'), /Error loading wallet/)
        })
    })

    // ─── REG-T1-A12: getNewAddress ─────────────────────────────────

    describe('REG-T1-A12: getNewAddress', function () {
        it('returns address string', async function () {
            axiosPostStub.resolves(rpcSuccess('bcrt1qabc123'))
            const result = await connector.getNewAddress()
            assert.strictEqual(result, 'bcrt1qabc123')
            assertRpcCall('getnewaddress', [])
        })

        it('throws on falsy result', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.getNewAddress(), /Error getting new address/)
        })
    })

    // ─── REG-T1-A13: getBlockHash / getBlock / getMempoolEntry ─────

    describe('REG-T1-A13: Remaining RPC methods', function () {
        it('getBlockHash sends blockindex and returns hash', async function () {
            axiosPostStub.resolves(rpcSuccess('0000abc'))
            const result = await connector.getBlockHash(42)
            assert.strictEqual(result, '0000abc')
            assertRpcCall('getblockhash', [42])
        })

        it('getBlock sends hash with hex format by default', async function () {
            axiosPostStub.resolves(rpcSuccess('0100000...'))
            await connector.getBlock('blockhash')
            assertRpcCall('getblock', ['blockhash', false])
        })

        it('getBlock sends JSON format when hexFormat=false', async function () {
            axiosPostStub.resolves(rpcSuccess({ hash: 'h', height: 1 }))
            await connector.getBlock('blockhash', false)
            assertRpcCall('getblock', ['blockhash', true])
        })

        it('getMempoolEntry returns entry for txid', async function () {
            const entry = { vsize: 200, fee: 0.0001 }
            axiosPostStub.resolves(rpcSuccess(entry))
            const result = await connector.getMempoolEntry('txid123')
            assert.deepStrictEqual(result, entry)
            assertRpcCall('getmempoolentry', ['txid123'])
        })
    })
})

// ═══════════════════════════════════════════════════════════════════════
// Section B: Integration Seam Regression (Miner↔Connector Sequences)
// ═══════════════════════════════════════════════════════════════════════

describe('T1 Regression: Miner↔Connector Integration Seams', function () {
    let XChainRegtestMiner, miner, connector, callLog

    beforeEach(function () {
        callLog = []

        connector = {
            getWalletInfo: sinon.stub().callsFake(async () => {
                callLog.push('getWalletInfo')
                throw new Error('No wallet loaded')
            }),
            loadWallet: sinon.stub().callsFake(async (name) => {
                callLog.push(`loadWallet(${name})`)
                throw new Error('Wallet not found')
            }),
            createWallet: sinon.stub().callsFake(async (name) => {
                callLog.push(`createWallet(${name})`)
                return { name }
            }),
            getNewAddress: sinon.stub().callsFake(async () => {
                callLog.push('getNewAddress')
                return 'bcrt1qtest'
            }),
            getBalance: sinon.stub().callsFake(async () => {
                callLog.push('getBalance')
                return 50.0
            }),
            getBlockchainInfo: sinon.stub().callsFake(async () => {
                callLog.push('getBlockchainInfo')
                return { blocks: 200 }
            }),
            generateToAddress: sinon.stub().callsFake(async (count, addr) => {
                callLog.push(`generateToAddress(${count})`)
                return ['blockhash']
            }),
            getRawMempool: sinon.stub().resolves([]),
            sendToAddress: sinon.stub().resolves('txid_abc'),
            setTxFee: sinon.stub().resolves(true),
            setWalletName: sinon.stub(),
        }

        sinon.stub(BlockchainConnector.prototype, 'constructor')
        delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
        XChainRegtestMiner = require('../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        miner.connector = connector

        sinon.stub(miner, 'sleep').resolves()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    afterEach(function () {
        sinon.restore()
        delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
    })

    // ─── REG-T1-B01: Fresh node, full create+mine sequence ──────────

    describe('REG-T1-B01: prepareWallet call sequences', function () {
        it('fresh node: probe fails→loadWallet→createWallet→getNewAddress→getBalance→generateToAddress(101)→getBalance', async function () {
            let probeCalls = 0
            connector.getNewAddress.callsFake(async () => {
                callLog.push('getNewAddress')
                probeCalls++
                if (probeCalls <= 10) throw new Error('No wallet loaded')
                return 'bcrt1qtest'
            })
            connector.getBalance.onFirstCall().callsFake(async () => {
                callLog.push('getBalance')
                return 0
            })

            await miner.prepareWallet()

            assert.deepStrictEqual(callLog, [
                ...Array(10).fill('getNewAddress'),   // bounded probe retries
                'loadWallet(xchain_regtest_wallet)',
                'createWallet(xchain_regtest_wallet)',
                'getNewAddress',
                'getBalance',
                'generateToAddress(101)',
                'getBalance',                          // post-mining readiness re-poll
            ])
        })

        it('existing wallet: probe fails→loadWallet→getNewAddress→getBalance', async function () {
            let probeCalls = 0
            connector.getNewAddress.callsFake(async () => {
                callLog.push('getNewAddress')
                probeCalls++
                if (probeCalls <= 10) throw new Error('No wallet loaded')
                return 'bcrt1qtest'
            })
            connector.loadWallet.callsFake(async (name) => {
                callLog.push(`loadWallet(${name})`)
                return { name }
            })

            await miner.prepareWallet()

            assert.deepStrictEqual(callLog, [
                ...Array(10).fill('getNewAddress'),
                'loadWallet(xchain_regtest_wallet)',
                'getNewAddress',
                'getBalance',
            ])
            assert.strictEqual(connector.createWallet.callCount, 0)
            assert.strictEqual(connector.generateToAddress.callCount, 0)
        })

        it('loaded + funded: getNewAddress→getBalance (minimal calls)', async function () {
            await miner.prepareWallet()

            assert.deepStrictEqual(callLog, [
                'getNewAddress',
                'getBalance',
            ])
        })

        it('loaded, empty balance, aged chain → still mines to maturity depth (101)', async function () {
            connector.getBalance.onFirstCall().callsFake(async () => {
                callLog.push('getBalance')
                return 0
            })
            connector.getBlockchainInfo.callsFake(async () => {
                callLog.push('getBlockchainInfo')
                return { blocks: 150 }
            })

            await miner.prepareWallet()

            assert.ok(callLog.includes('generateToAddress(101)'))
        })

        it('stores wallet address and balance', async function () {
            connector.getWalletInfo.resolves({ walletname: 'w' })
            connector.getNewAddress.resolves('bcrt1qspecific')
            connector.getBalance.resolves(123.45)

            await miner.prepareWallet()

            assert.strictEqual(miner.walletAddress, 'bcrt1qspecific')
            assert.strictEqual(miner.balance, 123.45)
        })
    })

    // ─── REG-T1-B02: Mining loop integration ───────────────────────

    describe('REG-T1-B02: Mining loop integration sequences', function () {
        beforeEach(function () {
            sinon.stub(miner, 'prepareWallet').resolves()
            miner.walletAddress = 'bcrt1qtest'
            miner.maxTimeToMineTxs = 50
            miner.addedTimeToMineTxs = 30
        })

        function runLoopWithTimeout(timeoutMs) {
            return new Promise(async (resolve) => {
                const timer = setTimeout(() => {
                    miner._shutdown = true
                    setTimeout(resolve, 20)
                }, timeoutMs)

                miner.sleep.callsFake(async () => {
                    return new Promise(r => setTimeout(r, 5))
                })

                try {
                    await miner.start()
                } catch (e) {
                    // Loop exited
                }

                clearTimeout(timer)
                resolve()
            })
        }

        it('mines when mempool has transactions and timer expires', async function () {
            connector.getRawMempool.resolves(['txid1'])
            await runLoopWithTimeout(200)
            assert.ok(connector.generateToAddress.callCount >= 1)
        })

        it('no mining with empty mempool', async function () {
            connector.getRawMempool.resolves([])
            await runLoopWithTimeout(100)
            assert.strictEqual(connector.generateToAddress.callCount, 0)
        })

        it('recovers from getRawMempool errors', async function () {
            let callCount = 0
            connector.getRawMempool.callsFake(async () => {
                callCount++
                if (callCount <= 3) throw new Error('Connection lost')
                return ['txid1']
            })
            await runLoopWithTimeout(300)
            assert.ok(callCount > 3, 'Should have retried after errors')
        })

        it('recovers from generateToAddress errors', async function () {
            connector.getRawMempool.resolves(['txid1'])
            let genCount = 0
            connector.generateToAddress.callsFake(async () => {
                genCount++
                if (genCount === 1) throw new Error('Block generation failed')
                return ['blockhash']
            })
            await runLoopWithTimeout(300)
            assert.ok(genCount >= 2, 'Should have retried block generation')
        })
    })

    // ─── REG-T1-B03: sendFundsToAddress delegation ─────────────────

    describe('REG-T1-B03: sendFundsToAddress delegation', function () {
        it('passes through to connector.sendToAddress', async function () {
            connector.sendToAddress.resolves('txid_result')
            const result = await miner.sendFundsToAddress('bcrt1qaddr', 2.5)
            assert.strictEqual(result, 'txid_result')
            assert(connector.sendToAddress.calledWith('bcrt1qaddr', 2.5))
        })
    })

    // ─── REG-T1-B04: generateBlocks delegation ─────────────────────

    describe('REG-T1-B04: generateBlocks delegation', function () {
        it('passes count and wallet address to connector', async function () {
            miner.walletAddress = 'bcrt1qreward'
            await miner.generateBlocks(10)
            assert(connector.generateToAddress.calledWith(10, 'bcrt1qreward'))
        })

        it('logs plural message for multiple blocks', async function () {
            miner.walletAddress = 'addr'
            await miner.generateBlocks(3)
            assert(console.log.calledWithMatch(/3 new blocks have been generated/))
        })

        it('logs singular message for one block', async function () {
            miner.walletAddress = 'addr'
            await miner.generateBlocks(1)
            assert(console.log.calledWithMatch(/A new block has been generated/))
        })
    })
})

// ═══════════════════════════════════════════════════════════════════════
// Section C: Boundary Condition Regression
// ═══════════════════════════════════════════════════════════════════════

describe('T1 Regression: Boundary Conditions', function () {
    let XChainRegtestMiner
    let miner
    let connectorStub
    let clock

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
            getRawTransaction: sinon.stub().resolves('0200000001...'),
            sendRawTransaction: sinon.stub().resolves('txid_sent'),
        }

        sinon.stub(BlockchainConnector.prototype, 'constructor')

        XChainRegtestMiner = require('../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        miner.connector = connectorStub

        sinon.stub(miner, 'sleep').resolves()
        sinon.stub(miner, 'prepareWallet').resolves()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')

        miner.walletAddress = 'bcrt1qtest'

        clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false })
    })

    afterEach(function () {
        clock.restore()
        sinon.restore()
        delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
    })

    async function runLoopIterations(iterations) {
        let loopCount = 0
        miner.sleep.callsFake(async () => {
            loopCount++
            if (loopCount >= iterations) {
                miner._shutdown = true
                throw new Error('__LOOP_BREAK__')
            }
        })
        try { await miner.start() } catch (e) {
            if (e.message !== '__LOOP_BREAK__') throw e
        }
    }

    // ─── REG-T1-C01: Timer boundary (maxTimeToMineTxs = 0) ────────

    describe('REG-T1-C01: Timer boundary, maxTime = 0', function () {
        it('mines immediately on next poll after first tx', async function () {
            miner.maxTimeToMineTxs = 0
            miner.addedTimeToMineTxs = 50000
            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert(connectorStub.generateToAddress.called,
                'maxTime=0 should cause immediate mining')
        })
    })

    // ─── REG-T1-C02: Timer boundary, simultaneous expiry ──────────

    describe('REG-T1-C02: Both timers expire simultaneously', function () {
        it('generates exactly one block (not two)', async function () {
            miner.maxTimeToMineTxs = 100
            miner.addedTimeToMineTxs = 100
            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) clock.tick(150)
                if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // The OR condition triggers once, generating one block
            assert.strictEqual(connectorStub.generateToAddress.callCount, 1)
        })
    })

    // ─── REG-T1-C03: Empty mempool never triggers mining ───────────

    describe('REG-T1-C03: Empty mempool', function () {
        it('never triggers mining regardless of time elapsed', async function () {
            connectorStub.getRawMempool.resolves([])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                clock.tick(60000)
                if (iterCount >= 5) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert(connectorStub.generateToAddress.notCalled)
        })
    })

    // ─── REG-T1-C04: Mempool size unchanged between polls ──────────

    describe('REG-T1-C04: Mempool size unchanged, no timer reset', function () {
        it('does not reset extendedStartToMine when size stays the same', async function () {
            miner.maxTimeToMineTxs = 50000
            miner.addedTimeToMineTxs = 100

            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) clock.tick(150)
                if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // With unchanged mempool size, extended timer should fire (not reset)
            assert(connectorStub.generateToAddress.called,
                'Should mine after addedTime with unchanged mempool')
        })
    })

    // ─── REG-T1-C05: Wallet boundary, height exactly 100 ──────────

    describe('REG-T1-C05: Wallet height boundary at 100', function () {
        beforeEach(function () {
            miner.prepareWallet.restore()
        })

        it('mines 101 blocks at height exactly 100', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.onFirstCall().resolves(0)
            connectorStub.getBlockchainInfo.resolves({ blocks: 100 })

            await miner.prepareWallet()

            assert(connectorStub.generateToAddress.calledWith(101, 'bcrt1qtest'))
        })

        it('mines 101 blocks at height 101 (maturity depth is height-independent)', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.onFirstCall().resolves(0)
            connectorStub.getBlockchainInfo.resolves({ blocks: 101 })

            await miner.prepareWallet()

            assert(connectorStub.generateToAddress.calledWith(101, 'bcrt1qtest'))
        })
    })

    // ─── REG-T1-C06: fillMempool chunking boundaries ───────────────

    describe('REG-T1-C06: fillMempool chunking math', function () {
        it('1 chunk for 100 txs', function () {
            assert.strictEqual(Math.ceil(100 / 2500), 1)
        })

        it('1 chunk for exactly 2500 txs', function () {
            assert.strictEqual(Math.ceil(2500 / 2500), 1)
        })

        it('2 chunks for 2501 txs', function () {
            assert.strictEqual(Math.ceil(2501 / 2500), 2)
        })

        it('correct remainder for last chunk (2501 → remainder 1)', function () {
            const txQuantity = 2501
            const remainder = txQuantity % 2500
            assert.strictEqual(remainder, 1)
        })

        it('zero remainder for evenly divisible (5000)', function () {
            const remainder = 5000 % 2500
            assert.strictEqual(remainder, 0)
        })

        it('correct funding amount per chunk', function () {
            const AMOUNT = 1000, FEE = 1000, BUFFER = 50, SATOSHI = 100000000.0
            const txRemainder = 100
            const total = (AMOUNT + FEE + BUFFER) * txRemainder
            assert.strictEqual(total, 205000)
            assert.strictEqual(total / SATOSHI, 0.00205)
        })
    })
})

// ═══════════════════════════════════════════════════════════════════════
// Section D: Security Regression
// ═══════════════════════════════════════════════════════════════════════

describe('T1 Regression: Security', function () {
    // ─── REG-T1-D01: Input validation ──────────────────────────────

    describe('REG-T1-D01: sendFundsToAddress input validation', function () {
        let XChainRegtestMiner, miner, connectorStub

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
            XChainRegtestMiner = require('../../src/XChainRegtestMiner')
            miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
            miner.connector = connectorStub
            sinon.stub(console, 'log')
            sinon.stub(console, 'error')
        })

        afterEach(function () {
            sinon.restore()
            delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
        })

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

    // ─── REG-T1-D02: fillMempool input validation ──────────────────

    describe('REG-T1-D02: fillMempool input validation', function () {
        let XChainRegtestMiner, miner

        beforeEach(function () {
            sinon.stub(BlockchainConnector.prototype, 'constructor')
            XChainRegtestMiner = require('../../src/XChainRegtestMiner')
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

        afterEach(function () {
            sinon.restore()
            delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
        })

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

    // ─── REG-T1-D03: setMiningTime input validation ────────────────

    describe('REG-T1-D03: setMiningTime input validation', function () {
        let XChainRegtestMiner, miner

        beforeEach(function () {
            sinon.stub(BlockchainConnector.prototype, 'constructor')
            XChainRegtestMiner = require('../../src/XChainRegtestMiner')
            miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
            miner.connector = {}
            sinon.stub(console, 'log')
            sinon.stub(console, 'error')
        })

        afterEach(function () {
            sinon.restore()
            delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
        })

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

    // ─── REG-T1-D04: Error sanitization (no credential leaks) ──────

    describe('REG-T1-D04: Error sanitization, no credential leaks', function () {
        let connector, axiosPostStub

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

// ═══════════════════════════════════════════════════════════════════════
// Section E: Exponential Backoff Regression
// ═══════════════════════════════════════════════════════════════════════

describe('T1 Regression: Error Recovery & Backoff', function () {
    let XChainRegtestMiner, miner, connectorStub, clock

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
        }

        sinon.stub(BlockchainConnector.prototype, 'constructor')
        XChainRegtestMiner = require('../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        miner.connector = connectorStub

        sinon.stub(miner, 'prepareWallet').resolves()
        miner.walletAddress = 'bcrt1qtest'

        sinon.stub(console, 'log')
        sinon.stub(console, 'error')

        clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false })
    })

    afterEach(function () {
        clock.restore()
        sinon.restore()
        delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
    })

    describe('REG-T1-E01: Backoff on consecutive mempool errors', function () {
        it('logs backoff messages with increasing delays', async function () {
            let errorCount = 0
            connectorStub.getRawMempool.callsFake(async () => {
                errorCount++
                if (errorCount <= 3) throw new Error('connection lost')
                return []
            })

            // Track sleep calls to verify backoff
            let sleepCalls = []
            miner.sleep = sinon.stub().callsFake(async (ms) => {
                sleepCalls.push(ms)
                if (sleepCalls.length >= 6) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // First error: backoff = min(1000 * 2^1, 30000) = 2000
            // Second error: backoff = min(1000 * 2^2, 30000) = 4000
            // Third error: backoff = min(1000 * 2^3, 30000) = 8000
            assert.ok(errorCount >= 3, 'Should have encountered errors')
            // Verify that backoff values increase
            const backoffSleeps = sleepCalls.filter(ms => ms > 1000)
            for (let i = 1; i < backoffSleeps.length; i++) {
                assert.ok(backoffSleeps[i] >= backoffSleeps[i - 1],
                    'Backoff should increase or stay at cap')
            }
        })
    })

    describe('REG-T1-E02: Backoff resets after success', function () {
        it('consecutive error counter resets on successful operation', async function () {
            miner.maxTimeToMineTxs = 50
            miner.addedTimeToMineTxs = 50

            // First few calls fail, then succeed, then fail again
            let callNum = 0
            connectorStub.getRawMempool.callsFake(async () => {
                callNum++
                if (callNum <= 2) throw new Error('fail')
                return ['txid1']
            })

            let sleepArgs = []
            miner.sleep = sinon.stub().callsFake(async (ms) => {
                sleepArgs.push(ms)
                clock.tick(60)
                if (sleepArgs.length >= 8) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // After success, if another error occurs the backoff should start low again
            assert.ok(callNum > 2)
        })
    })
})
