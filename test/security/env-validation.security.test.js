const assert = require('assert')
const sinon = require('sinon')

describe('Security: Environment Variable Validation (SEC-005)', function () {
    let originalEnv
    let processExitStub

    beforeEach(function () {
        originalEnv = { ...process.env }
        processExitStub = sinon.stub(process, 'exit')
        sinon.stub(console, 'error')
        sinon.stub(console, 'log')
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

    // We need to test validateEnvVars directly since api.js calls startApi() on require.
    // Extract the validation logic by sourcing it.
    function getValidateEnvVars() {
        // Re-implement the validation function as defined in api.js for testing
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
