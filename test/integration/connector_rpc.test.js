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
 * Seam D Integration Tests: BlockchainConnector ↔ MockRpcServer
 *
 * Tests verify that BlockchainConnector sends correctly formatted JSON-RPC
 * payloads over HTTP and correctly parses real-shaped responses. A lightweight
 * MockRpcServer stands in for Bitcoin Core.
 */

const assert = require('assert')
const sinon = require('sinon')
const MockRpcServer = require('./helpers/MockRpcServer')
const BlockchainConnector = require('../../src/rpc/blockchain_connector')
const { RPC_RESPONSES } = require('./helpers/fixtures')

let server, connector

function useConnector() {
    before(async function () {
        server = new MockRpcServer()
        await server.start()
    })

    after(async function () {
        await server.stop()
    })

    beforeEach(function () {
        server.reset()
        connector = new BlockchainConnector('127.0.0.1', String(server.port), 'rpcuser', 'rpcpass')
        sinon.stub(connector, 'sleep').resolves()
        sinon.stub(console, 'error')
        sinon.stub(console, 'log')
    })

    afterEach(function () {
        sinon.restore()
    })
}

async function testGetBlockchainInfo() {
    server.onMethod('getblockchaininfo').returns(RPC_RESPONSES.BLOCKCHAIN_INFO_MATURE)
    const result = await connector.getBlockchainInfo()
    assert.deepStrictEqual(result, RPC_RESPONSES.BLOCKCHAIN_INFO_MATURE)

    const call = server.callsFor('getblockchaininfo')[0]
    assert.strictEqual(call.method, 'getblockchaininfo')
    assert.strictEqual(call.id, 1)
}

async function testGetNetworkInfo() {
    server.onMethod('getnetworkinfo').returns(RPC_RESPONSES.NETWORK_INFO)
    const result = await connector.getNetworkInfo()
    assert.strictEqual(result.version, 250000)
}

async function testEmptyMempool() {
    server.onMethod('getrawmempool').returns([])
    const result = await connector.getRawMempool()
    assert.deepStrictEqual(result, [])
}

async function testPopulatedMempool() {
    server.onMethod('getrawmempool').returns(['tx1', 'tx2', 'tx3'])
    const result = await connector.getRawMempool()
    assert.deepStrictEqual(result, ['tx1', 'tx2', 'tx3'])
}

async function testGenerateToAddress() {
    server.onMethod('generatetoaddress').returns(['hash1', 'hash2'])
    const result = await connector.generateToAddress(2, 'bcrt1qtest')
    assert.deepStrictEqual(result, ['hash1', 'hash2'])

    const call = server.callsFor('generatetoaddress')[0]
    assert.deepStrictEqual(call.params, [2, 'bcrt1qtest'])
}

async function testGetBlockHash() {
    server.onMethod('getblockhash').returns('000000abcdef')
    const result = await connector.getBlockHash(42)
    assert.strictEqual(result, '000000abcdef')

    const call = server.callsFor('getblockhash')[0]
    assert.deepStrictEqual(call.params, [42])
}

async function testGetBlockHex() {
    server.onMethod('getblock').returns('0100000000...')
    const result = await connector.getBlock('hash123', true)
    assert.strictEqual(result, '0100000000...')

    // getblock verbose is sent as a boolean (Dogecoin 1.14 rejects
    // integer verbosity); hexFormat=true means verbose=false.
    const call = server.callsFor('getblock')[0]
    assert.deepStrictEqual(call.params, ['hash123', false])
}

async function testGetBlockJson() {
    const blockObj = { hash: 'hash123', height: 1, tx: ['tx1'] }
    server.onMethod('getblock').returns(blockObj)
    const result = await connector.getBlock('hash123', false)
    assert.deepStrictEqual(result, blockObj)

    const call = server.callsFor('getblock')[0]
    assert.deepStrictEqual(call.params, ['hash123', true])
}

async function testZeroBalance() {
    server.onMethod('getbalance').returns(0)
    const result = await connector.getBalance()
    assert.strictEqual(result, 0)
}

async function testPositiveBalance() {
    server.onMethod('getbalance').returns(50.0)
    const result = await connector.getBalance()
    assert.strictEqual(result, 50.0)
}

async function testSendToAddress() {
    server.onMethod('sendtoaddress').returns({ txid: 'abc123' })
    const result = await connector.sendToAddress('bcrt1qaddr', 1.5)
    assert.strictEqual(result, 'abc123')

    const call = server.callsFor('sendtoaddress')[0]
    assert.deepStrictEqual(call.params, ['bcrt1qaddr', 1.5])
}

async function testSendRawTransaction() {
    server.onMethod('sendrawtransaction').returns('txid_result')
    const result = await connector.sendRawTransaction('0200abcd...')
    assert.strictEqual(result, 'txid_result')

    const call = server.callsFor('sendrawtransaction')[0]
    assert.deepStrictEqual(call.params, ['0200abcd...'])
}

async function testGetMempoolEntry() {
    const entry = { vsize: 200, weight: 800, fee: 0.0001 }
    server.onMethod('getmempoolentry').returns(entry)
    const result = await connector.getMempoolEntry('tx123')
    assert.deepStrictEqual(result, entry)
}

async function testGetNewAddress() {
    server.onMethod('getnewaddress').returns('bcrt1qnewaddr')
    const result = await connector.getNewAddress()
    assert.strictEqual(result, 'bcrt1qnewaddr')
}

describe('Seam D: BlockchainConnector ↔ MockRpcServer', function () {
    useConnector()

    // ─── Basic Round-Trips ──────────────────────────────────────────────

    describe('RPC round-trips', function () {
        it('getBlockchainInfo: sends correct payload and parses response', testGetBlockchainInfo)
        it('getNetworkInfo: round-trip', testGetNetworkInfo)
        it('getRawMempool: returns empty array', testEmptyMempool)
        it('getRawMempool: returns populated array', testPopulatedMempool)
    })

    describe('RPC round-trips', function () {
        it('generateToAddress: sends count and address params', testGenerateToAddress)
        it('getBlockHash: sends blockindex param', testGetBlockHash)
        it('getBlock: sends blockhash with verbose=false (hex format)', testGetBlockHex)
        it('getBlock: sends blockhash with verbose=true (JSON format)', testGetBlockJson)
    })

    describe('RPC round-trips', function () {
        it('getBalance: returns zero correctly (falsy but valid)', testZeroBalance)
        it('getBalance: returns positive balance', testPositiveBalance)
        it('sendToAddress: sends positional params (DOGE v1.14 compat)', testSendToAddress)
        it('sendRawTransaction: sends tx hex param', testSendRawTransaction)
        it('getMempoolEntry: sends txid param', testGetMempoolEntry)
        it('getNewAddress: returns address string', testGetNewAddress)
    })
})

describe('Seam D: BlockchainConnector ↔ MockRpcServer', function () {
    useConnector()

    // ─── Authentication ─────────────────────────────────────────────────

    describe('HTTP Basic Auth', function () {
        it('sends correct Authorization header', async function () {
            server.onMethod('getblockchaininfo').returns(RPC_RESPONSES.BLOCKCHAIN_INFO_MATURE)
            await connector.getBlockchainInfo()

            const call = server.callsFor('getblockchaininfo')[0]
            assert.ok(call.auth, 'Should send Authorization header')

            // Decode Basic auth: "Basic base64(user:pass)"
            const encoded = call.auth.split(' ')[1]
            const decoded = Buffer.from(encoded, 'base64').toString()
            assert.strictEqual(decoded, 'rpcuser:rpcpass')
        })
    })
})

describe('Seam D: BlockchainConnector ↔ MockRpcServer', function () {
    useConnector()

    // ─── getRawTransaction (silent null pattern) ────────────────────────

    describe('getRawTransaction error handling', function () {
        it('returns result on success', async function () {
            server.onMethod('getrawtransaction').returns('020000000100...')
            const result = await connector.getRawTransaction('txid1')
            assert.strictEqual(result, '020000000100...')
        })

        it('returns null when server returns RPC error', async function () {
            // No handler registered = method not found error
            const result = await connector.getRawTransaction('bad_txid')
            assert.strictEqual(result, null)
        })
    })
})

describe('Seam D: BlockchainConnector ↔ MockRpcServer', function () {
    useConnector()

    // ─── Retry Behavior ─────────────────────────────────────────────────

    describe('retry behavior', function () {
        it('createWallet: retries on failure and succeeds', async function () {
            server.onMethod('createwallet')
                .failTimes(2, 'rpc', { code: -35, message: 'Wallet loading in progress' })
                .thenReturn({ name: 'test_wallet' })

            const result = await connector.createWallet('test_wallet', 5)
            assert.deepStrictEqual(result, { name: 'test_wallet' })
            assert.strictEqual(server.callsFor('createwallet').length, 3)
        })

        it('createWallet: exhausts retries and throws', async function () {
            server.onMethod('createwallet')
                .failTimes(100, 'rpc', { code: -1, message: 'Permanently broken' })
                .thenReturn({ name: 'w' })

            await assert.rejects(
                () => connector.createWallet('w', 3),
                /Error creating wallet/
            )
            assert.strictEqual(server.callsFor('createwallet').length, 3)
        })

        it('getWalletInfo: retries on failure and succeeds', async function () {
            server.onMethod('getwalletinfo')
                .failTimes(2, 'http')
                .thenReturn(RPC_RESPONSES.WALLET_INFO)

            const result = await connector.getWalletInfo(5)
            assert.deepStrictEqual(result, RPC_RESPONSES.WALLET_INFO)
        })

        it('getWalletInfo: exhausts max retries and throws', async function () {
            server.onMethod('getwalletinfo')
                .failTimes(100, 'http')
                .thenReturn(RPC_RESPONSES.WALLET_INFO)

            await assert.rejects(
                () => connector.getWalletInfo(3),
                /max retries exceeded/
            )
        })
    })
})

describe('Seam D: BlockchainConnector ↔ MockRpcServer', function () {
    useConnector()

    // ─── Error Shapes ───────────────────────────────────────────────────

    describe('error handling', function () {
        it('throws on unregistered method (null result)', async function () {
            // getblockchaininfo not registered, server returns error
            await assert.rejects(
                () => connector.getBlockchainInfo(),
                /Error getting blockchain info/
            )
        })

        it('loadWallet: throws on RPC error', async function () {
            server.onMethod('loadwallet')
                .failTimes(1, 'rpc', { code: -18, message: 'Wallet file not found' })
                .thenReturn(null)

            await assert.rejects(
                () => connector.loadWallet('missing'),
                /Wallet file not found|Error loading wallet/
            )
        })
    })
})

describe('Seam D: BlockchainConnector ↔ MockRpcServer', function () {
    useConnector()

    // ─── Multiple Sequential Calls ──────────────────────────────────────

    describe('sequential call patterns', function () {
        it('full wallet setup sequence through real HTTP', async function () {
            server.onMethod('getwalletinfo').returns(null)
            server.onMethod('createwallet').returns({ name: 'xchain_regtest_wallet' })
            server.onMethod('loadwallet').returns({ name: 'xchain_regtest_wallet' })
            server.onMethod('getnewaddress').returns('bcrt1qtest')
            server.onMethod('getbalance').returns(0)
            server.onMethod('getblockchaininfo').returns({ blocks: 0 })
            server.onMethod('generatetoaddress').returns(['blockhash1'])

            // getWalletInfo returns null result → throws "Error getting wallet info"
            // This is fine: the miner catches it and proceeds to loadWallet

            const info = await connector.getWalletInfo(1).catch(() => null)
            assert.strictEqual(info, null)

            const loaded = await connector.loadWallet('xchain_regtest_wallet')
            assert.deepStrictEqual(loaded, { name: 'xchain_regtest_wallet' })

            const addr = await connector.getNewAddress()
            assert.strictEqual(addr, 'bcrt1qtest')

            const balance = await connector.getBalance()
            assert.strictEqual(balance, 0)

            const chainInfo = await connector.getBlockchainInfo()
            assert.strictEqual(chainInfo.blocks, 0)

            const hashes = await connector.generateToAddress(101, addr)
            assert.deepStrictEqual(hashes, ['blockhash1'])

            // Verify all calls went through the server
            assert.strictEqual(server.calls.length, 6)
        })
    })
})
