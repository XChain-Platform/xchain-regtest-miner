const assert = require('assert')
const sinon = require('sinon')
const axios = require('axios')
const BlockchainConnector = require('../../src/BlockchainConnector')

describe('Boundary: RPC Retry and Response Shapes', function () {
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

    // ═══════════════════════════════════════════════════════════════════
    // createWallet retry boundaries
    // ═══════════════════════════════════════════════════════════════════

    describe('R-04: createWallet fails on exactly attempt 10 of 10', function () {
        it('throws after exhausting all 10 retries', async function () {
            axiosPostStub.rejects(new Error('always fails'))

            await assert.rejects(
                () => connector.createWallet('w', 10),
                /Error creating wallet/
            )
            assert.strictEqual(axiosPostStub.callCount, 10,
                'Should attempt exactly 10 times')
        })
    })

    describe('R-05: createWallet succeeds on exactly attempt 10 of 10', function () {
        it('returns success on final retry', async function () {
            for (let i = 0; i < 9; i++) {
                axiosPostStub.onCall(i).rejects(new Error('fail'))
            }
            axiosPostStub.onCall(9).resolves(rpcSuccess({ name: 'w' }))

            const result = await connector.createWallet('w', 10)
            assert.deepStrictEqual(result, { name: 'w' })
            assert.strictEqual(axiosPostStub.callCount, 10)
        })
    })

    describe('R-06: createWallet fails once then succeeds', function () {
        it('returns success after 2 attempts', async function () {
            axiosPostStub.onFirstCall().rejects(new Error('busy'))
            axiosPostStub.onSecondCall().resolves(rpcSuccess({ name: 'w' }))

            const result = await connector.createWallet('w', 10)
            assert.deepStrictEqual(result, { name: 'w' })
            assert.strictEqual(axiosPostStub.callCount, 2)
        })
    })

    describe('createWallet with tries=1', function () {
        it('gets exactly one attempt', async function () {
            axiosPostStub.rejects(new Error('fail'))

            await assert.rejects(() => connector.createWallet('w', 1))
            assert.strictEqual(axiosPostStub.callCount, 1)
        })
    })

    describe('createWallet with tries=0', function () {
        it('throws immediately with zero tries (no attempts made)', async function () {
            await assert.rejects(
                () => connector.createWallet('w', 0),
                /Error creating wallet/
            )
            assert.strictEqual(axiosPostStub.callCount, 0,
                'Should make zero attempts when tries=0')
        })
    })

    describe('createWallet with falsy result then success', function () {
        it('decrements tries on falsy result and retries', async function () {
            axiosPostStub.onFirstCall().resolves(rpcNoResult())
            axiosPostStub.onSecondCall().resolves(rpcNoResult())
            axiosPostStub.onThirdCall().resolves(rpcSuccess({ name: 'w' }))

            const result = await connector.createWallet('w', 5)
            assert.deepStrictEqual(result, { name: 'w' })
            assert.strictEqual(axiosPostStub.callCount, 3)
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // getWalletInfo retry boundaries
    // ═══════════════════════════════════════════════════════════════════

    describe('R-07: getWalletInfo fails many times then succeeds', function () {
        it('succeeds after N failures (bounded by maxRetries)', async function () {
            // Fail 9 times, succeed on 10th
            for (let i = 0; i < 9; i++) {
                axiosPostStub.onCall(i).rejects(new Error('not ready'))
            }
            axiosPostStub.onCall(9).resolves(rpcSuccess({ walletname: 'w' }))

            const result = await connector.getWalletInfo(10)
            assert.deepStrictEqual(result, { walletname: 'w' })
            assert.strictEqual(axiosPostStub.callCount, 10)
        })
    })

    describe('getWalletInfo with maxRetries=1', function () {
        it('gets exactly one attempt', async function () {
            axiosPostStub.rejects(new Error('fail'))

            await assert.rejects(
                () => connector.getWalletInfo(1),
                /max retries exceeded/
            )
            assert.strictEqual(axiosPostStub.callCount, 1)
        })
    })

    describe('getWalletInfo with maxRetries=0', function () {
        it('throws immediately with zero retries', async function () {
            await assert.rejects(
                () => connector.getWalletInfo(0),
                /max retries exceeded/
            )
            assert.strictEqual(axiosPostStub.callCount, 0)
        })
    })

    describe('getWalletInfo succeeds on first try', function () {
        it('makes exactly one call', async function () {
            axiosPostStub.resolves(rpcSuccess({ walletname: 'w' }))

            const result = await connector.getWalletInfo(50)
            assert.deepStrictEqual(result, { walletname: 'w' })
            assert.strictEqual(axiosPostStub.callCount, 1)
        })
    })

    describe('getWalletInfo sleeps between retries', function () {
        it('sleeps 1000ms on each retry', async function () {
            axiosPostStub.onFirstCall().rejects(new Error('fail'))
            axiosPostStub.onSecondCall().rejects(new Error('fail'))
            axiosPostStub.onThirdCall().resolves(rpcSuccess({ walletname: 'w' }))

            await connector.getWalletInfo(5)
            assert.strictEqual(connector.sleep.callCount, 2,
                'Should sleep twice for two failures')
            assert(connector.sleep.alwaysCalledWith(1000))
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // RPC response shape boundaries
    // ═══════════════════════════════════════════════════════════════════

    describe('R-10: RPC returns result: null', function () {
        it('getNetworkInfo throws on null result', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.getNetworkInfo(), /Error getting network info/)
        })

        it('getBlockchainInfo throws on null result', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.getBlockchainInfo(), /Error getting blockchain info/)
        })

        it('getRawMempool throws on null result', async function () {
            axiosPostStub.resolves(rpcNoResult())
            await assert.rejects(() => connector.getRawMempool(), /Error getting raw mempool/)
        })
    })

    describe('R-11: getRawMempool returns empty array', function () {
        it('returns empty array successfully', async function () {
            axiosPostStub.resolves(rpcSuccess([]))
            const result = await connector.getRawMempool()
            assert.deepStrictEqual(result, [])
        })
    })

    describe('R-12: RPC returns error object in response', function () {
        it('methods that check result truthiness throw on null result', async function () {
            const errorResponse = {
                data: { result: null, error: { code: -32600, message: 'Invalid request' }, id: 1 }
            }
            axiosPostStub.resolves(errorResponse)
            await assert.rejects(() => connector.getBlockchainInfo())
        })
    })

    describe('R-13: RPC returns malformed JSON (axios parse error)', function () {
        it('throws axios error', async function () {
            const parseError = new Error('Unexpected token in JSON')
            parseError.code = 'ERR_BAD_RESPONSE'
            axiosPostStub.rejects(parseError)

            await assert.rejects(() => connector.getNetworkInfo(), /Unexpected token/)
        })
    })

    describe('R-14: RPC returns HTTP 500', function () {
        it('throws axios error with status info', async function () {
            const serverError = new Error('Request failed with status code 500')
            serverError.response = { status: 500 }
            axiosPostStub.rejects(serverError)

            await assert.rejects(() => connector.getBlockchainInfo(), /500/)
        })
    })

    describe('R-15: Connection refused (node not running)', function () {
        it('throws ECONNREFUSED', async function () {
            const connError = new Error('connect ECONNREFUSED 127.0.0.1:18332')
            connError.code = 'ECONNREFUSED'
            axiosPostStub.rejects(connError)

            await assert.rejects(() => connector.getNetworkInfo(), /ECONNREFUSED/)
        })
    })

    describe('R-16: getRawTransaction returns null on error', function () {
        it('returns null on network error', async function () {
            axiosPostStub.rejects(new Error('timeout'))
            const result = await connector.getRawTransaction('txid1')
            assert.strictEqual(result, null)
        })

        it('returns null on RPC error', async function () {
            axiosPostStub.resolves(rpcNoResult())
            const result = await connector.getRawTransaction('txid1')
            assert.strictEqual(result, null)
        })

        it('returns hex on success', async function () {
            axiosPostStub.resolves(rpcSuccess('0200dead...'))
            const result = await connector.getRawTransaction('txid1')
            assert.strictEqual(result, '0200dead...')
        })
    })

    describe('R-17: generateToAddress returns empty array', function () {
        it('returns empty array for 0 blocks', async function () {
            axiosPostStub.resolves(rpcSuccess([]))
            const result = await connector.generateToAddress(0, 'addr')
            assert.deepStrictEqual(result, [])
        })
    })

    describe('R-18: generateToAddress called with 0 blocks', function () {
        it('sends count=0 as param', async function () {
            axiosPostStub.resolves(rpcSuccess([]))
            await connector.generateToAddress(0, 'addr')
            const data = axiosPostStub.firstCall.args[1]
            assert.deepStrictEqual(data.params, [0, 'addr'])
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // getBalance response boundaries
    // ═══════════════════════════════════════════════════════════════════

    describe('getBalance boundary responses', function () {
        it('returns 0 for zero balance', async function () {
            axiosPostStub.resolves(rpcSuccess(0))
            const result = await connector.getBalance()
            assert.strictEqual(result, 0)
        })

        it('returns very small positive balance', async function () {
            axiosPostStub.resolves(rpcSuccess(0.00000001))
            const result = await connector.getBalance()
            assert.strictEqual(result, 0.00000001)
        })

        it('throws when result is string (NaN check)', async function () {
            axiosPostStub.resolves({ data: { result: 'not_a_number' } })
            await assert.rejects(() => connector.getBalance(), /Error asking wallet balance/)
        })

        it('accepts -0 as valid (isNaN(-0) is false)', async function () {
            axiosPostStub.resolves(rpcSuccess(-0))
            const result = await connector.getBalance()
            assert.strictEqual(result, -0)
        })

        it('throws when result is null (explicit null check)', async function () {
            axiosPostStub.resolves({ data: { result: null } })
            await assert.rejects(() => connector.getBalance(), /Error asking wallet balance/,
                'null should be rejected by explicit null check')
        })

        it('throws when result is undefined', async function () {
            axiosPostStub.resolves({ data: { result: undefined } })
            // isNaN(undefined) is true, so !isNaN is false -> throws
            await assert.rejects(() => connector.getBalance(), /Error asking wallet balance/)
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // sendToAddress response boundaries
    // ═══════════════════════════════════════════════════════════════════

    describe('sendToAddress response shape boundaries', function () {
        it('extracts txid from verbose response', async function () {
            axiosPostStub.resolves(rpcSuccess({ txid: 'abc123', fee_reason: 'not_set' }))
            const result = await connector.sendToAddress('addr', 1.0)
            assert.strictEqual(result, 'abc123')
        })

        it('returns undefined when response has no txid key', async function () {
            // result["txid"] on object without txid returns undefined
            axiosPostStub.resolves(rpcSuccess({ other_field: 'value' }))
            // result is truthy (it's an object), but result["txid"] is undefined
            const result = await connector.sendToAddress('addr', 1.0)
            assert.strictEqual(result, undefined,
                'Missing txid key returns undefined')
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // generateToAddress timeout configuration
    // ═══════════════════════════════════════════════════════════════════

    describe('generateToAddress timeout boundary', function () {
        it('uses explicit 60s timeout (not default)', async function () {
            axiosPostStub.resolves(rpcSuccess(['hash']))
            await connector.generateToAddress(1, 'addr')

            const config = axiosPostStub.firstCall.args[2]
            assert.strictEqual(config.timeout, 60000,
                'Should use explicit 60s timeout for mining')
        })
    })

    // ═══════════════════════════════════════════════════════════════════
    // Constructor URL building boundaries
    // ═══════════════════════════════════════════════════════════════════

    describe('Constructor URL boundaries', function () {
        it('builds URL with empty host', function () {
            const c = new BlockchainConnector('', '18332', 'u', 'p')
            assert.strictEqual(c.url, 'http://:18332')
        })

        it('builds URL with empty port', function () {
            const c = new BlockchainConnector('localhost', '', 'u', 'p')
            assert.strictEqual(c.url, 'http://localhost:')
        })

        it('builds URL with IPv6 address', function () {
            const c = new BlockchainConnector('::1', '18332', 'u', 'p')
            assert.strictEqual(c.url, 'http://::1:18332')
        })

        it('stores credentials as-is (no encoding)', function () {
            const c = new BlockchainConnector('h', '1', 'user@name', 'p@ss:word')
            assert.strictEqual(c.rpcUser, 'user@name')
            assert.strictEqual(c.rpcPassword, 'p@ss:word')
        })
    })
})
