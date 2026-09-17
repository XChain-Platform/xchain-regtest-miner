// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

'use strict'

const assert = require('assert')
const http = require('http')
const sinon = require('sinon')
const XChainRegtestMiner = require('../../../src/XChainRegtestMiner')
const { installAuthentication } = require('../../../src/api/auth')
const {
    createApiApp,
    createMiner,
    listenApi,
    startMinerDetached,
    validateEnvVars
} = require('../../../src/api/startup')

function validEnvironment(overrides = {}) {
    return {
        NETWORK: 'bitcoin-regtest',
        NODE_URL: 'localhost',
        NODE_PORT: '18443',
        NODE_USER: 'user',
        NODE_PASSWORD: 'password',
        REGTEST_MINER_API_PORT: '8080',
        ...overrides
    }
}

describe('API authentication seam', function () {
    afterEach(function () {
        sinon.restore()
    })

    it('does not install a request gate when no API key is configured', function () {
        const app = { use: sinon.stub() }
        const logger = { log: sinon.stub() }

        installAuthentication(app, null, logger)

        assert.strictEqual(app.use.called, false)
        assert.strictEqual(logger.log.called, false)
    })

    it('rejects a mutating request with the wrong API key', function () {
        let middleware
        const app = { use: handler => { middleware = handler } }
        const logger = { log: sinon.stub() }
        const response = {
            status: sinon.stub(),
            json: sinon.stub()
        }
        response.status.returns(response)

        installAuthentication(app, 'expected-key', logger)
        middleware(
            { body: { method: 'send_funds' }, headers: { 'x-api-key': 'wrong-key' } },
            response,
            sinon.stub()
        )

        assert(logger.log.calledOnce)
        assert(response.status.calledOnceWithExactly(401))
        assert(response.json.calledOnceWithExactly({ error: 'Unauthorized: missing or invalid X-API-Key' }))
    })

    it('lets an unauthenticated health request reach its handler', function () {
        let middleware
        const app = { use: handler => { middleware = handler } }
        const next = sinon.stub()

        installAuthentication(app, 'expected-key', { log: sinon.stub() })
        middleware({ body: { method: 'health' }, headers: {} }, {}, next)

        assert(next.calledOnce)
    })
})

describe('API startup configuration seams', function () {
    afterEach(function () {
        sinon.restore()
    })

    it('accepts a complete local regtest configuration without warnings', function () {
        const logger = { error: sinon.stub(), warn: sinon.stub() }

        validateEnvVars(validEnvironment(), 'regtest', logger)

        assert.strictEqual(logger.error.called, false)
        assert.strictEqual(logger.warn.called, false)
    })

    it('warns when node RPC points away from loopback', function () {
        const logger = { error: sinon.stub(), warn: sinon.stub() }

        validateEnvVars(validEnvironment({ NODE_URL: '192.0.2.1' }), 'regtest', logger)

        assert(logger.warn.calledOnce)
        assert.match(logger.warn.firstCall.args[0], /plaintext/)
    })

    it('creates a miner with the supplied node connection settings', function () {
        const miner = createMiner({
            coinNetwork: 'bitcoin-regtest',
            nodeUrl: 'localhost',
            nodePort: '18443',
            nodeUser: 'user',
            nodePassword: 'password'
        })

        assert(miner instanceof XChainRegtestMiner)
        assert.strictEqual(miner.network, 'bitcoin-regtest')
        assert.strictEqual(miner.connector.url, 'http://localhost:18443')
        assert.strictEqual(miner.connector.rpcUser, 'user')
    })

    it('starts the miner without waiting for the long-running loop', function () {
        const miner = { start: sinon.stub().resolves() }

        startMinerDetached(miner, { error: sinon.stub() })

        assert(miner.start.calledOnce)
    })
})

describe('API startup HTTP seams', function () {
    afterEach(function () {
        sinon.restore()
    })

    it('installs JSON parsing, security headers, and CORS on the API app', async function () {
        const app = createApiApp()
        app.post('/probe', (req, res) => res.json(req.body))
        const server = http.createServer(app)
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

        try {
            const response = await fetch('http://127.0.0.1:' + server.address().port + '/probe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ready: true })
            })
            assert.deepStrictEqual(await response.json(), { ready: true })
            assert.strictEqual(response.headers.get('access-control-allow-origin'), '*')
            assert.strictEqual(response.headers.get('x-content-type-options'), 'nosniff')
        } finally {
            await new Promise(resolve => server.close(resolve))
        }
    })

    it('stores the listening handle on the miner and logs the bound port', function () {
        const server = { close: sinon.stub() }
        let onListening
        const app = {
            listen: sinon.stub().callsFake((port, callback) => {
                onListening = callback
                return server
            })
        }
        const miner = {}
        const logger = { log: sinon.stub() }

        listenApi(app, miner, 8080, logger)
        onListening()

        assert(app.listen.calledOnceWith(8080))
        assert.strictEqual(miner.apiServer, server)
        assert(logger.log.calledOnceWithExactly('API listening on port 8080'))
    })
})
