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
const axios = require('axios')
const BlockchainConnector = require('../../src/BlockchainConnector')

describe('BlockchainConnector', function () {
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

    // ─── Constructor ────────────────────────────────────────────────────

    describe('constructor', function () {
        it('builds the correct URL from host and port', function () {
            assert.strictEqual(connector.url, 'http://localhost:18332')
        })

        it('stores RPC credentials', function () {
            assert.strictEqual(connector.rpcUser, 'rpcuser')
            assert.strictEqual(connector.rpcPassword, 'rpcpass')
        })

        it('stores the port', function () {
            assert.strictEqual(connector.port, '18332')
        })

        it('handles special characters in host/port', function () {
            const c = new BlockchainConnector('192.168.1.100', '8332', 'u', 'p')
            assert.strictEqual(c.url, 'http://192.168.1.100:8332')
        })
    })

    // ─── Helper: assert standard RPC call shape ─────────────────────────

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

    function rpcSuccess(result) {
        return { data: { result, error: null, id: 1 } }
    }

    function rpcNoResult() {
        return { data: { result: null, error: { code: -1, message: 'fail' }, id: 1 } }
    }

    // ─── getNetworkInfo ─────────────────────────────────────────────────

    describe('getNetworkInfo', function () {
        it('returns the result on success', async function () {
            const expected = { version: 250000, subversion: '/Satoshi:25.0.0/' }
            axiosPostStub.resolves(rpcSuccess(expected))
            const result = await connector.getNetworkInfo()
            assert.deepStrictEqual(result, expected)
            assertRpcCall('getnetworkinfo')
        })

        it('throws when result is falsy', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.getNetworkInfo(), /Error getting network info/)
        })

        it('throws clean error on network error', async function () {
            axiosPostStub.rejects(new Error('ECONNREFUSED'))
            await assert.rejects(() => connector.getNetworkInfo(), /Error getting network info/)
        })
    })

    // ─── getBlockchainInfo ──────────────────────────────────────────────

    describe('getBlockchainInfo', function () {
        it('returns blockchain info on success', async function () {
            const expected = { blocks: 200, chain: 'regtest' }
            axiosPostStub.resolves(rpcSuccess(expected))
            const result = await connector.getBlockchainInfo()
            assert.deepStrictEqual(result, expected)
            assertRpcCall('getblockchaininfo')
        })

        it('throws when result is falsy', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.getBlockchainInfo(), /Error getting blockchain info/)
        })
    })

    // ─── getBlockHash ───────────────────────────────────────────────────

    describe('getBlockHash', function () {
        it('sends blockindex as param and returns hash', async function () {
            axiosPostStub.resolves(rpcSuccess('0000abc123'))
            const result = await connector.getBlockHash(42)
            assert.strictEqual(result, '0000abc123')
            assertRpcCall('getblockhash', [42])
        })

        it('throws clean error on network error', async function () {
            axiosPostStub.rejects(new Error('timeout'))
            await assert.rejects(() => connector.getBlockHash(0), /Error getting block hash/)
        })

        it('throws when result is falsy', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.getBlockHash(0), /Error getting block hash/)
        })
    })

    // ─── getBlock ───────────────────────────────────────────────────────

    describe('getBlock', function () {
        it('sends boolean false verbose for hex format (default)', async function () {
            axiosPostStub.resolves(rpcSuccess('0100000000...'))
            const result = await connector.getBlock('blockhash123')
            assert.strictEqual(result, '0100000000...')
            // getblock verbose is a boolean (false=hex); Dogecoin 1.14 rejects integer verbosity.
            assertRpcCall('getblock', ['blockhash123', false])
        })

        it('sends boolean true verbose when hexFormat is false', async function () {
            const blockObj = { hash: 'blockhash123', height: 1 }
            axiosPostStub.resolves(rpcSuccess(blockObj))
            const result = await connector.getBlock('blockhash123', false)
            assert.deepStrictEqual(result, blockObj)
            assertRpcCall('getblock', ['blockhash123', true])
        })

        it('throws clean error on network error', async function () {
            axiosPostStub.rejects(new Error('fail'))
            await assert.rejects(() => connector.getBlock('hash'), /Error getting block/)
        })

        it('throws when result is falsy', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.getBlock('hash'), /Error getting block/)
        })
    })

    // ─── getRawMempool ──────────────────────────────────────────────────

    describe('getRawMempool', function () {
        it('returns array of txids', async function () {
            const txids = ['txid1', 'txid2', 'txid3']
            axiosPostStub.resolves(rpcSuccess(txids))
            const result = await connector.getRawMempool()
            assert.deepStrictEqual(result, txids)
            assertRpcCall('getrawmempool')
        })

        it('throws clean error on network error', async function () {
            axiosPostStub.rejects(new Error('connection lost'))
            await assert.rejects(() => connector.getRawMempool(), /Error getting raw mempool/)
        })

        it('throws when result is falsy', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.getRawMempool(), /Error getting raw mempool/)
        })
    })

    // ─── getMempoolEntry ────────────────────────────────────────────────

    describe('getMempoolEntry', function () {
        it('sends txid as param and returns entry', async function () {
            const entry = { vsize: 200, fee: 0.0001 }
            axiosPostStub.resolves(rpcSuccess(entry))
            const result = await connector.getMempoolEntry('txid123')
            assert.deepStrictEqual(result, entry)
            assertRpcCall('getmempoolentry', ['txid123'])
        })

        it('throws when result is falsy', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.getMempoolEntry('txid'), /Error getting mempool entry/)
        })
    })

    // ─── getRawTransaction (silent null pattern) ────────────────────────

    describe('getRawTransaction', function () {
        it('returns raw tx hex on success', async function () {
            axiosPostStub.resolves(rpcSuccess('0200000001...'))
            const result = await connector.getRawTransaction('txid1')
            assert.strictEqual(result, '0200000001...')
            assertRpcCall('getrawtransaction', ['txid1'])
        })

        it('returns null on network error instead of throwing', async function () {
            axiosPostStub.rejects(new Error('ECONNREFUSED'))
            const result = await connector.getRawTransaction('txid1')
            assert.strictEqual(result, null)
        })

        it('returns null on RPC error instead of throwing', async function () {
            axiosPostStub.rejects(new Error('RPC error'))
            const result = await connector.getRawTransaction('bad_txid')
            assert.strictEqual(result, null)
        })

        it('throws when result is falsy (caught internally, returns null)', async function () {
            // When the RPC returns no result, the internal throw is caught and null is returned
            axiosPostStub.resolves(rpcNoResult())
            const result = await connector.getRawTransaction('txid')
            assert.strictEqual(result, null)
        })
    })

    // ─── createWallet (bounded retry pattern) ───────────────────────────

    describe('createWallet', function () {
        it('returns wallet info on first success', async function () {
            const walletInfo = { name: 'test_wallet' }
            axiosPostStub.resolves(rpcSuccess(walletInfo))
            const result = await connector.createWallet('test_wallet')
            assert.deepStrictEqual(result, walletInfo)
            assert.strictEqual(axiosPostStub.callCount, 1)
        })

        it('retries on failure and succeeds', async function () {
            axiosPostStub.onFirstCall().rejects(new Error('busy'))
            axiosPostStub.onSecondCall().rejects(new Error('busy'))
            axiosPostStub.onThirdCall().resolves(rpcSuccess({ name: 'w' }))
            const result = await connector.createWallet('w', 5)
            assert.deepStrictEqual(result, { name: 'w' })
            assert.strictEqual(axiosPostStub.callCount, 3)
        })

        it('retries on falsy result and succeeds', async function () {
            axiosPostStub.onFirstCall().resolves(rpcNoResult())
            axiosPostStub.onSecondCall().resolves(rpcSuccess({ name: 'w' }))
            const result = await connector.createWallet('w', 5)
            assert.deepStrictEqual(result, { name: 'w' })
            assert.strictEqual(axiosPostStub.callCount, 2)
        })

        it('exhausts retries and throws', async function () {
            axiosPostStub.rejects(new Error('always fails'))
            await assert.rejects(() => connector.createWallet('w', 3), /Error creating wallet/)
            assert.strictEqual(axiosPostStub.callCount, 3)
        })

        it('defaults to 50 retries', async function () {
            axiosPostStub.rejects(new Error('fail'))
            await assert.rejects(() => connector.createWallet('w'))
            assert.strictEqual(axiosPostStub.callCount, 50)
        })

        it('sleeps between retries', async function () {
            axiosPostStub.onFirstCall().rejects(new Error('fail'))
            axiosPostStub.onSecondCall().resolves(rpcSuccess({ name: 'w' }))
            await connector.createWallet('w', 3)
            assert(connector.sleep.calledWith(1000))
        })

        it('sends correct RPC method and params', async function () {
            axiosPostStub.resolves(rpcSuccess({ name: 'my_wallet' }))
            await connector.createWallet('my_wallet')
            assertRpcCall('createwallet', ['my_wallet'])
        })
    })

    // ─── getWalletInfo (bounded retry with max retries) ─────────────────

    describe('getWalletInfo', function () {
        it('returns wallet info on first success', async function () {
            const info = { walletname: 'default', balance: 50.0 }
            axiosPostStub.resolves(rpcSuccess(info))
            const result = await connector.getWalletInfo()
            assert.deepStrictEqual(result, info)
            assert.strictEqual(axiosPostStub.callCount, 1)
        })

        it('retries on failure and returns on success', async function () {
            axiosPostStub.onFirstCall().rejects(new Error('not ready'))
            axiosPostStub.onSecondCall().rejects(new Error('not ready'))
            axiosPostStub.onThirdCall().resolves(rpcSuccess({ walletname: 'w' }))
            const result = await connector.getWalletInfo(5)
            assert.deepStrictEqual(result, { walletname: 'w' })
            assert.strictEqual(axiosPostStub.callCount, 3)
        })

        it('throws after exhausting max retries', async function () {
            axiosPostStub.rejects(new Error('down'))
            await assert.rejects(() => connector.getWalletInfo(3), /max retries exceeded/)
            assert.strictEqual(axiosPostStub.callCount, 3)
        })

        it('defaults to 50 max retries', async function () {
            axiosPostStub.rejects(new Error('down'))
            await assert.rejects(() => connector.getWalletInfo())
            assert.strictEqual(axiosPostStub.callCount, 50)
        })

        it('sleeps 1s between retries', async function () {
            axiosPostStub.onFirstCall().rejects(new Error('fail'))
            axiosPostStub.onSecondCall().resolves(rpcSuccess({ walletname: 'w' }))
            await connector.getWalletInfo(5)
            assert(connector.sleep.calledWith(1000))
        })

        it('throws when response has no result', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.getWalletInfo(), /Error getting wallet info/)
        })

        it('silently retries without logging credentials', async function () {
            axiosPostStub.onFirstCall().rejects(new Error('fail'))
            axiosPostStub.onSecondCall().resolves(rpcSuccess({ walletname: 'w' }))
            await connector.getWalletInfo(5)
            // Should not log errors containing credentials
            for (const call of console.error.getCalls()) {
                for (const arg of call.args) {
                    const str = typeof arg === 'string' ? arg : String(arg)
                    assert.ok(!str.includes('rpcpass'), 'Logged credentials during retry')
                }
            }
        })
    })

    // ─── loadWallet ─────────────────────────────────────────────────────

    describe('loadWallet', function () {
        it('returns wallet info on success', async function () {
            axiosPostStub.resolves(rpcSuccess({ name: 'w' }))
            const result = await connector.loadWallet('w')
            assert.deepStrictEqual(result, { name: 'w' })
            assertRpcCall('loadwallet', ['w'])
        })

        it('throws when result is falsy', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.loadWallet('w'), /Error loading wallet/)
        })

        it('throws clean error on network error', async function () {
            axiosPostStub.rejects(new Error('refused'))
            await assert.rejects(() => connector.loadWallet('w'), /Error loading wallet/)
        })
    })

    // ─── getNewAddress ──────────────────────────────────────────────────

    describe('getNewAddress', function () {
        it('returns address string', async function () {
            axiosPostStub.resolves(rpcSuccess('bcrt1qabc123'))
            const result = await connector.getNewAddress()
            assert.strictEqual(result, 'bcrt1qabc123')
            assertRpcCall('getnewaddress', [])
        })

        it('throws when result is falsy', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.getNewAddress(), /Error getting new address/)
        })
    })

    // ─── generateToAddress ──────────────────────────────────────────────

    describe('generateToAddress', function () {
        it('returns array of block hashes', async function () {
            const hashes = ['hash1', 'hash2']
            axiosPostStub.resolves(rpcSuccess(hashes))
            const result = await connector.generateToAddress(2, 'addr1')
            assert.deepStrictEqual(result, hashes)
            assertRpcCall('generatetoaddress', [2, 'addr1'])
        })

        it('does not override the timeout, inheriting the NODE_RPC_TIMEOUT default', async function () {
            // generateToAddress no longer hardcodes timeout:60000; it inherits
            // axios.defaults.timeout (NODE_RPC_TIMEOUT, default 60000) like every
            // other connector call, so the per-request config carries no timeout.
            axiosPostStub.resolves(rpcSuccess(['hash']))
            await connector.generateToAddress(1, 'addr')
            const config = axiosPostStub.firstCall.args[2]
            assert.strictEqual(config.timeout, undefined)
            assert.strictEqual(axios.defaults.timeout, 60000)
        })

        it('throws a static message when result is falsy', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.generateToAddress(1, 'a'), /Error generating to address/)
        })

        it('logs the node RPC error for diagnosis but throws a static message', async function () {
            // Debuggability: session 4's LTC stall must be diagnosable, so the real RPC
            // error (e.g. "bad-txns-vin-empty") is written to the LOG. Sanitization: the
            // THROWN message stays static (the sanitization security suite forbids leaking
            // transport details like the RPC host:port into thrown errors).
            axiosPostStub.resolves({
                data: { result: null, error: { code: -25, message: 'bad-txns-vin-empty, Transaction check failed' }, id: 1 }
            })
            await assert.rejects(
                () => connector.generateToAddress(1, 'addr'),
                /Error generating to address/
            )
            const logged = console.error.getCalls().map(c => c.args.join(' ')).join('\n')
            assert.match(logged, /bad-txns-vin-empty/)
        })

        it('does not surface a transport error host:port in the thrown message', async function () {
            const netErr = new Error('ECONNREFUSED 127.0.0.1:3220')
            axiosPostStub.rejects(netErr)
            let threw = null
            try { await connector.generateToAddress(1, 'addr') } catch (e) { threw = e }
            assert.ok(threw, 'should throw')
            assert.strictEqual(threw.message, 'Error generating to address')
            assert.ok(!threw.message.includes('3220'), 'thrown message must not leak the RPC host:port')
        })
    })

    // ─── getBalance ─────────────────────────────────────────────────────

    describe('getBalance', function () {
        it('returns numeric balance', async function () {
            axiosPostStub.resolves(rpcSuccess(50.0))
            const result = await connector.getBalance()
            assert.strictEqual(result, 50.0)
            assertRpcCall('getbalance', [])
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

    // ─── sendToAddress ──────────────────────────────────────────────────

    describe('sendToAddress', function () {
        // sendtoaddress now uses POSITIONAL params (Dogecoin v1.14 compat; see
        // the comment in src/BlockchainConnector.js#sendToAddress) and tolerates
        // both bare-string and {txid} response shapes.
        it('uses positional params and returns the txid', async function () {
            axiosPostStub.resolves(rpcSuccess('abc123'))
            const result = await connector.sendToAddress('addr1', 1.5)
            assert.strictEqual(result, 'abc123')
            const data = axiosPostStub.firstCall.args[1]
            assert.deepStrictEqual(data.params, ['addr1', 1.5])
        })

        it('tolerates the verbose-form {txid: ...} response shape', async function () {
            axiosPostStub.resolves(rpcSuccess({ txid: 'abc123' }))
            const result = await connector.sendToAddress('addr1', 1.5)
            assert.strictEqual(result, 'abc123')
        })

        it('logs the node RPC error when result is falsy but throws a static message', async function () {
            axiosPostStub.resolves({
                data: { result: null, error: { code: -6, message: 'Insufficient funds' }, id: 1 }
            })
            await assert.rejects(() => connector.sendToAddress('a', 1), /Error sending funds to address/)
            const logged = console.error.getCalls().map(c => c.args.join(' ')).join('\n')
            assert.match(logged, /Insufficient funds/)
        })

        it('throws a static message on a transport error (no host:port leak)', async function () {
            axiosPostStub.rejects(new Error('connect ECONNREFUSED 127.0.0.1:18332'))
            let threw = null
            try { await connector.sendToAddress('a', 1) } catch (e) { threw = e }
            assert.strictEqual(threw && threw.message, 'Error sending funds to address')
            assert.ok(!threw.message.includes('18332'), 'thrown message must not leak the RPC host:port')
        })
    })

    // ─── setTxFee ───────────────────────────────────────────────────────

    describe('setTxFee', function () {
        it('calls settxfee with the fee rate and returns true on success', async function () {
            axiosPostStub.resolves(rpcSuccess(true))
            const result = await connector.setTxFee(0.001)
            assert.strictEqual(result, true)
            assertRpcCall('settxfee', [0.001])
        })

        it('returns false (tolerated) when the daemon rejects settxfee', async function () {
            // A daemon that does not honor settxfee must not break wallet prep;
            // funding then falls back to the fee-estimate path.
            axiosPostStub.resolves({ data: { result: false, error: null, id: 1 } })
            assert.strictEqual(await connector.setTxFee(0.001), false)
        })

        it('returns false on a network error rather than throwing', async function () {
            axiosPostStub.rejects(new Error('ECONNREFUSED'))
            assert.strictEqual(await connector.setTxFee(0.001), false)
        })
    })

    // ─── invalidateBlock ────────────────────────────────────────────────

    describe('invalidateBlock', function () {
        it('calls invalidateblock RPC and returns true on success', async function () {
            axiosPostStub.resolves({ data: { result: null, error: null, id: 1 } })
            const result = await connector.invalidateBlock('abc123')
            assert.strictEqual(result, true)
            assertRpcCall('invalidateblock', ['abc123'])
        })

        it('logs the node RPC error but throws a static message', async function () {
            axiosPostStub.resolves({ data: { result: null, error: { code: -8, message: 'Block not found' }, id: 1 } })
            await assert.rejects(() => connector.invalidateBlock('badhash'), /Error invalidating block/)
            const logged = console.error.getCalls().map(c => c.args.join(' ')).join('\n')
            assert.match(logged, /Block not found/)
        })

        it('throws a static message on network error (no transport detail leak)', async function () {
            axiosPostStub.rejects(new Error('connect ECONNREFUSED 127.0.0.1:18332'))
            await assert.rejects(() => connector.invalidateBlock('abc123'), /Error invalidating block/)
        })
    })

    // ─── reconsiderBlock ────────────────────────────────────────────────

    describe('reconsiderBlock', function () {
        it('calls reconsiderblock RPC and returns true on success', async function () {
            axiosPostStub.resolves({ data: { result: null, error: null, id: 1 } })
            const result = await connector.reconsiderBlock('abc123')
            assert.strictEqual(result, true)
            assertRpcCall('reconsiderblock', ['abc123'])
        })

        it('logs the node RPC error but throws a static message', async function () {
            axiosPostStub.resolves({ data: { result: null, error: { code: -8, message: 'Block not found' }, id: 1 } })
            await assert.rejects(() => connector.reconsiderBlock('badhash'), /Error reconsidering block/)
            const logged = console.error.getCalls().map(c => c.args.join(' ')).join('\n')
            assert.match(logged, /Block not found/)
        })

        it('throws a static message on network error (no transport detail leak)', async function () {
            axiosPostStub.rejects(new Error('connect ECONNREFUSED 127.0.0.1:18332'))
            await assert.rejects(() => connector.reconsiderBlock('abc123'), /Error reconsidering block/)
        })
    })

    // ─── setMockTime ─────────────────────────────────────────────────────

    describe('setMockTime', function () {
        it('calls setmocktime RPC with the numeric timestamp and returns true', async function () {
            axiosPostStub.resolves({ data: { result: null, error: null, id: 1 } })
            const result = await connector.setMockTime(1900000000)
            assert.strictEqual(result, true)
            assertRpcCall('setmocktime', [1900000000])
        })

        it('coerces the timestamp to a Number for the RPC params', async function () {
            axiosPostStub.resolves({ data: { result: null, error: null, id: 1 } })
            await connector.setMockTime('1900000000')
            assertRpcCall('setmocktime', [1900000000])
        })

        it('logs the node RPC error but throws a static message', async function () {
            axiosPostStub.resolves({ data: { result: null, error: { code: -8, message: 'Timestamp must be 0 or greater' }, id: 1 } })
            await assert.rejects(() => connector.setMockTime(-5), /Error setting mock time/)
            const logged = console.error.getCalls().map(c => c.args.join(' ')).join('\n')
            assert.match(logged, /Timestamp must be 0 or greater/)
        })

        it('throws a static message on network error (no transport detail leak)', async function () {
            axiosPostStub.rejects(new Error('connect ECONNREFUSED 127.0.0.1:18332'))
            await assert.rejects(() => connector.setMockTime(1900000000), /Error setting mock time/)
        })
    })

    // ─── sendRawTransaction ─────────────────────────────────────────────

    describe('sendRawTransaction', function () {
        it('sends tx hex and returns txid', async function () {
            axiosPostStub.resolves(rpcSuccess('txid_result'))
            const result = await connector.sendRawTransaction('0200...')
            assert.strictEqual(result, 'txid_result')
            assertRpcCall('sendrawtransaction', ['0200...'])
        })

        it('throws and logs when result is falsy', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.sendRawTransaction('hex'), /Error sending raw transaction/)
        })

        it('throws on network error', async function () {
            axiosPostStub.rejects(new Error('refused'))
            await assert.rejects(() => connector.sendRawTransaction('hex'), /Error sending raw transaction/)
        })
    })

    // ─── sleep ──────────────────────────────────────────────────────────

    describe('sleep', function () {
        beforeEach(function () {
            // Restore the real sleep for this describe block so we can test it
            connector.sleep.restore()
        })

        it('resolves after the specified delay', async function () {
            const clock = sinon.useFakeTimers()
            const promise = connector.sleep(100)

            // Before the delay has elapsed the promise must still be pending.
            // Race it against an immediately-resolved sentinel: if sleep resolved
            // early the sentinel would lose, so the sentinel winning proves pending.
            const sentinel = Promise.resolve('sentinel')
            const earlyWinner = await Promise.race([promise.then(() => 'sleep'), sentinel])
            assert.strictEqual(earlyWinner, 'sentinel', 'sleep resolved before the delay elapsed')

            // Advance time past the delay; now sleep must resolve.
            clock.tick(100)
            await promise

            clock.restore()
        })
    })
})
