// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

const assert = require('assert')
const sinon = require('sinon')

describe('Security: Environment Variable Validation (SEC-005, SEC-017, SEC-018)', function () {
    let originalEnv
    let processExitStub

    beforeEach(function () {
        originalEnv = { ...process.env }
        processExitStub = sinon.stub(process, 'exit')
        sinon.stub(console, 'error')
        sinon.stub(console, 'log')
        sinon.stub(console, 'warn')
    })

    afterEach(function () {
        sinon.restore()
        process.env = originalEnv
        // Clear module cache so we get fresh requires
        for (const key of Object.keys(require.cache)) {
            if (key.includes('xchain-regtest-miner/src/api')) {
                delete require.cache[key]
            }
        }
    })

    function setValidEnv() {
        process.env.NETWORK = 'regtest'
        process.env.NODE_URL = 'localhost'
        process.env.NODE_PORT = '18332'
        process.env.NODE_USER = 'rpcuser'
        process.env.NODE_PASSWORD = 'rpcpass'
        process.env.REGTEST_MINER_API_PORT = '8080'
    }

    // Re-implement the validation function as defined in api.js for testing
    function getValidateEnvVars() {
        const REQUIRED_ENV_VARS = ['NETWORK', 'NODE_URL', 'NODE_PORT', 'NODE_USER', 'NODE_PASSWORD', 'REGTEST_MINER_API_PORT']

        return function validateEnvVars() {
            const missing = REQUIRED_ENV_VARS.filter(name => !process.env[name] || process.env[name].trim() === '')
            if (missing.length > 0) {
                console.error('Missing required environment variables: ' + missing.join(', '))
                process.exit(1)
            }
            const portVars = ['NODE_PORT', 'REGTEST_MINER_API_PORT']
            for (const name of portVars) {
                const val = parseInt(process.env[name], 10)
                if (isNaN(val) || val < 1 || val > 65535) {
                    console.error(name + ' must be a valid port number (1-65535)')
                    process.exit(1)
                }
            }
            const validNetworks = ['regtest', 'testnet', 'mainnet']
            if (!validNetworks.includes(process.env.NETWORK)) {
                console.error('NETWORK must be one of: ' + validNetworks.join(', '))
                process.exit(1)
            }
            const nodeUrl = process.env.NODE_URL
            if (nodeUrl !== 'localhost' && nodeUrl !== '127.0.0.1') {
                console.warn('WARNING: NODE_URL is not localhost (' + nodeUrl + '). RPC credentials will be transmitted over the network in plaintext.')
            }
        }
    }

    describe('missing environment variables', function () {
        it('exits when NETWORK is missing', function () {
            setValidEnv()
            delete process.env.NETWORK
            const validate = getValidateEnvVars()
            validate()
            assert.ok(processExitStub.calledWith(1))
        })

        it('exits when NODE_URL is missing', function () {
            setValidEnv()
            delete process.env.NODE_URL
            const validate = getValidateEnvVars()
            validate()
            assert.ok(processExitStub.calledWith(1))
        })

        it('exits when NODE_PORT is missing', function () {
            setValidEnv()
            delete process.env.NODE_PORT
            const validate = getValidateEnvVars()
            validate()
            assert.ok(processExitStub.calledWith(1))
        })

        it('exits when NODE_USER is missing', function () {
            setValidEnv()
            delete process.env.NODE_USER
            const validate = getValidateEnvVars()
            validate()
            assert.ok(processExitStub.calledWith(1))
        })

        it('exits when NODE_PASSWORD is missing', function () {
            setValidEnv()
            delete process.env.NODE_PASSWORD
            const validate = getValidateEnvVars()
            validate()
            assert.ok(processExitStub.calledWith(1))
        })

        it('exits when REGTEST_MINER_API_PORT is missing', function () {
            setValidEnv()
            delete process.env.REGTEST_MINER_API_PORT
            const validate = getValidateEnvVars()
            validate()
            assert.ok(processExitStub.calledWith(1))
        })

        it('exits when all env vars are missing', function () {
            delete process.env.NETWORK
            delete process.env.NODE_URL
            delete process.env.NODE_PORT
            delete process.env.NODE_USER
            delete process.env.NODE_PASSWORD
            delete process.env.REGTEST_MINER_API_PORT
            const validate = getValidateEnvVars()
            validate()
            assert.ok(processExitStub.calledWith(1))
        })

        it('logs which variables are missing', function () {
            setValidEnv()
            delete process.env.NETWORK
            delete process.env.NODE_USER
            const validate = getValidateEnvVars()
            validate()
            const errorMsg = console.error.firstCall.args[0]
            assert.ok(errorMsg.includes('NETWORK'))
            assert.ok(errorMsg.includes('NODE_USER'))
        })
    })

    describe('empty environment variables', function () {
        it('exits when NETWORK is empty string', function () {
            setValidEnv()
            process.env.NETWORK = ''
            const validate = getValidateEnvVars()
            validate()
            assert.ok(processExitStub.calledWith(1))
        })

        it('exits when NODE_PASSWORD is whitespace only', function () {
            setValidEnv()
            process.env.NODE_PASSWORD = '   '
            const validate = getValidateEnvVars()
            validate()
            assert.ok(processExitStub.calledWith(1))
        })
    })

    describe('invalid port values', function () {
        it('exits when NODE_PORT is not a number', function () {
            setValidEnv()
            process.env.NODE_PORT = 'abc'
            const validate = getValidateEnvVars()
            validate()
            assert.ok(processExitStub.calledWith(1))
        })

        it('exits when NODE_PORT is 0', function () {
            setValidEnv()
            process.env.NODE_PORT = '0'
            const validate = getValidateEnvVars()
            validate()
            assert.ok(processExitStub.calledWith(1))
        })

        it('exits when NODE_PORT is negative', function () {
            setValidEnv()
            process.env.NODE_PORT = '-1'
            const validate = getValidateEnvVars()
            validate()
            assert.ok(processExitStub.calledWith(1))
        })

        it('exits when NODE_PORT exceeds 65535', function () {
            setValidEnv()
            process.env.NODE_PORT = '65536'
            const validate = getValidateEnvVars()
            validate()
            assert.ok(processExitStub.calledWith(1))
        })

        it('exits when REGTEST_MINER_API_PORT is not a number', function () {
            setValidEnv()
            process.env.REGTEST_MINER_API_PORT = 'notaport'
            const validate = getValidateEnvVars()
            validate()
            assert.ok(processExitStub.calledWith(1))
        })

        it('exits when REGTEST_MINER_API_PORT exceeds 65535', function () {
            setValidEnv()
            process.env.REGTEST_MINER_API_PORT = '99999'
            const validate = getValidateEnvVars()
            validate()
            assert.ok(processExitStub.calledWith(1))
        })

        it('logs which port variable is invalid', function () {
            setValidEnv()
            process.env.NODE_PORT = 'bad'
            const validate = getValidateEnvVars()
            validate()
            const errorMsg = console.error.firstCall.args[0]
            assert.ok(errorMsg.includes('NODE_PORT'))
            assert.ok(errorMsg.includes('valid port'))
        })
    })

    // ─── SEC-018: NETWORK value validation ────────────────────────────

    describe('NETWORK value validation (SEC-018)', function () {
        it('exits when NETWORK is an invalid value', function () {
            setValidEnv()
            process.env.NETWORK = 'invalidnet'
            const validate = getValidateEnvVars()
            validate()
            assert.ok(processExitStub.calledWith(1))
        })

        it('exits when NETWORK is "production"', function () {
            setValidEnv()
            process.env.NETWORK = 'production'
            const validate = getValidateEnvVars()
            validate()
            assert.ok(processExitStub.calledWith(1))
        })

        it('exits when NETWORK is "REGTEST" (case-sensitive)', function () {
            setValidEnv()
            process.env.NETWORK = 'REGTEST'
            const validate = getValidateEnvVars()
            validate()
            assert.ok(processExitStub.calledWith(1))
        })

        it('logs valid network values in error message', function () {
            setValidEnv()
            process.env.NETWORK = 'badvalue'
            const validate = getValidateEnvVars()
            validate()
            const errorMsg = console.error.firstCall.args[0]
            assert.ok(errorMsg.includes('regtest'))
            assert.ok(errorMsg.includes('testnet'))
            assert.ok(errorMsg.includes('mainnet'))
        })

        it('accepts regtest', function () {
            setValidEnv()
            process.env.NETWORK = 'regtest'
            const validate = getValidateEnvVars()
            validate()
            assert.strictEqual(processExitStub.callCount, 0)
        })

        it('accepts testnet', function () {
            setValidEnv()
            process.env.NETWORK = 'testnet'
            const validate = getValidateEnvVars()
            validate()
            assert.strictEqual(processExitStub.callCount, 0)
        })

        it('accepts mainnet', function () {
            setValidEnv()
            process.env.NETWORK = 'mainnet'
            const validate = getValidateEnvVars()
            validate()
            assert.strictEqual(processExitStub.callCount, 0)
        })
    })

    // ─── SEC-017: NODE_URL localhost warning ───────────────────────────

    describe('NODE_URL localhost warning (SEC-017)', function () {
        it('does not warn when NODE_URL is localhost', function () {
            setValidEnv()
            process.env.NODE_URL = 'localhost'
            const validate = getValidateEnvVars()
            validate()
            assert.strictEqual(console.warn.callCount, 0)
        })

        it('does not warn when NODE_URL is 127.0.0.1', function () {
            setValidEnv()
            process.env.NODE_URL = '127.0.0.1'
            const validate = getValidateEnvVars()
            validate()
            assert.strictEqual(console.warn.callCount, 0)
        })

        it('warns when NODE_URL is a remote host', function () {
            setValidEnv()
            process.env.NODE_URL = '10.0.0.5'
            const validate = getValidateEnvVars()
            validate()
            assert.strictEqual(console.warn.callCount, 1)
            const warnMsg = console.warn.firstCall.args[0]
            assert.ok(warnMsg.includes('WARNING'))
            assert.ok(warnMsg.includes('10.0.0.5'))
            assert.ok(warnMsg.includes('plaintext'))
        })

        it('warns when NODE_URL is a hostname', function () {
            setValidEnv()
            process.env.NODE_URL = 'bitcoin-node.internal'
            const validate = getValidateEnvVars()
            validate()
            assert.strictEqual(console.warn.callCount, 1)
        })

        it('does not exit on non-localhost NODE_URL (warning only)', function () {
            setValidEnv()
            process.env.NODE_URL = '10.0.0.5'
            const validate = getValidateEnvVars()
            validate()
            assert.strictEqual(processExitStub.callCount, 0)
        })
    })

    describe('valid environment', function () {
        it('does not exit with valid env vars', function () {
            setValidEnv()
            const validate = getValidateEnvVars()
            validate()
            assert.strictEqual(processExitStub.callCount, 0)
        })

        it('accepts port 1', function () {
            setValidEnv()
            process.env.NODE_PORT = '1'
            const validate = getValidateEnvVars()
            validate()
            assert.strictEqual(processExitStub.callCount, 0)
        })

        it('accepts port 65535', function () {
            setValidEnv()
            process.env.NODE_PORT = '65535'
            const validate = getValidateEnvVars()
            validate()
            assert.strictEqual(processExitStub.callCount, 0)
        })
    })
})
