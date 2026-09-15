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
const BlockchainConnector = require('../../src/rpc/blockchain_connector')

// ═══════════════════════════════════════════════════════════════════════
// Section A: BlockchainConnector RPC Method Regression
// ═══════════════════════════════════════════════════════════════════════

let connector
let axiosPostStub

function registerRpcHooks() {
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
}

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

describe('T1 Regression: BlockchainConnector RPC Methods', function () {
    registerRpcHooks()

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
})

describe('T1 Regression: BlockchainConnector RPC Methods', function () {
    registerRpcHooks()

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
})

describe('T1 Regression: BlockchainConnector RPC Methods', function () {
    registerRpcHooks()

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
})

describe('T1 Regression: BlockchainConnector RPC Methods', function () {
    registerRpcHooks()

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
})

describe('T1 Regression: BlockchainConnector RPC Methods', function () {
    registerRpcHooks()

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
})

describe('T1 Regression: BlockchainConnector RPC Methods', function () {
    registerRpcHooks()

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
})

describe('T1 Regression: BlockchainConnector RPC Methods', function () {
    registerRpcHooks()

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
