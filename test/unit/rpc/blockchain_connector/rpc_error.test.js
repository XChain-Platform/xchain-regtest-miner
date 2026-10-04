const assert = require('assert')

const {
    rejectedRpcErrorMessage,
    rpcErrorCode
} = require('../../../../src/rpc/blockchain_connector/rpc_error')

describe('RPC error helpers', function () {
    it('reads a message and numeric code from an RPC error', function () {
        const body = { error: { code: -8, message: 'Invalid parameter' } }
        const rejection = { response: { data: body } }

        assert.strictEqual(rejectedRpcErrorMessage(rejection), 'Invalid parameter')
        assert.strictEqual(rpcErrorCode(body), -8)
    })

    it('reads a message when the RPC error has no numeric code', function () {
        const body = { error: { message: 'Wallet unavailable' } }
        const rejection = { response: { data: body } }

        assert.strictEqual(rejectedRpcErrorMessage(rejection), 'Wallet unavailable')
        assert.strictEqual(rpcErrorCode(body), null)
    })

    it('returns null for a plain Error', function () {
        const error = new Error('connection refused')

        assert.strictEqual(rejectedRpcErrorMessage(error), null)
        assert.strictEqual(rpcErrorCode(error), null)
    })

    it('returns null for a non-error rejection value', function () {
        assert.strictEqual(rejectedRpcErrorMessage('connection refused'), null)
        assert.strictEqual(rpcErrorCode('connection refused'), null)
    })
})
