// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

'use strict'

// The NETWORK label alone is not enough for the mainnet refusal. These pin the second
// gate: the node's own getblockchaininfo answer must match that label before the
// miner touches the wallet or the API port opens.

const assert = require('assert')
const axios = require('axios')
const sinon = require('sinon')
const XChainRegtestMiner = require('../../../src/XChainRegtestMiner')
const { chainMatchesNetwork, createStartApi, verifyNodeChain } = require('../../../src/api/startup')

const EXIT = '__process_exit__'

function stubExit() {
    return sinon.stub(process, 'exit').callsFake((code) => { throw new Error(EXIT + code) })
}

function logger() {
    return { error: sinon.stub(), warn: sinon.stub(), log: sinon.stub() }
}

function connectorAnswering(...answers) {
    const getBlockchainInfo = sinon.stub()
    answers.forEach((answer, i) => {
        if (answer instanceof Error) getBlockchainInfo.onCall(i).rejects(answer)
        else getBlockchainInfo.onCall(i).resolves(answer)
    })
    return { getBlockchainInfo }
}

const fast = { attempts: 5, intervalMs: 0, sleep: async () => {} }

describe('node chain verification', function () {
    afterEach(function () { sinon.restore() })

    it('pairs each NETWORK label only with the chains its node may report', function () {
        assert.strictEqual(chainMatchesNetwork('regtest', 'regtest'), true)
        assert.strictEqual(chainMatchesNetwork('testnet', 'test'), true)
        assert.strictEqual(chainMatchesNetwork('testnet', 'testnet4'), true)
        for (const [network, chain] of [['regtest', 'main'], ['testnet', 'main'], ['regtest', 'test'],
            ['testnet', 'regtest'], ['regtest', 'signet'], ['testnet', 'signet'], ['regtest', undefined],
            ['mainnet', 'main'], ['testnet', 'testnetx']]) {
            assert.strictEqual(chainMatchesNetwork(network, chain), false, network + ' vs ' + chain)
        }
    })

    it('resolves without exiting when the node reports the matching chain', async function () {
        const exit = stubExit()
        for (const [network, chain] of [['regtest', 'regtest'], ['testnet', 'test'], ['testnet', 'testnet4']]) {
            const log = logger()
            await verifyNodeChain(connectorAnswering({ chain }), network, log, fast)
            assert.ok(log.log.calledWithMatch(chain), 'logs the verified chain ' + chain)
        }
        assert.strictEqual(exit.called, false)
    })

    it('exits 1 and names the reported chain on a mainnet or mismatched node', async function () {
        stubExit()
        for (const [network, info] of [['regtest', { chain: 'main' }], ['testnet', { chain: 'main' }],
            ['regtest', { chain: 'test' }], ['testnet', { chain: 'regtest' }], ['regtest', { chain: 'signet' }],
            ['regtest', { blocks: 5 }]]) {
            const log = logger()
            const connector = connectorAnswering(info)
            await assert.rejects(() => verifyNodeChain(connector, network, log, fast), new RegExp(EXIT + '1'))
            assert.strictEqual(connector.getBlockchainInfo.callCount, 1, 'a mismatch is never retried')
            assert.match(log.error.firstCall.args[0], new RegExp(JSON.stringify(info.chain) || 'undefined'))
        }
    })

    it('retries a node that is still warming up', async function () {
        const exit = stubExit()
        const connector = connectorAnswering(new Error('warming up'), new Error('warming up'), { chain: 'regtest' })
        await verifyNodeChain(connector, 'regtest', logger(), fast)
        assert.strictEqual(connector.getBlockchainInfo.callCount, 3)
        assert.strictEqual(exit.called, false)
    })

    it('fails closed after the last attempt when the node never answers', async function () {
        stubExit()
        const connector = { getBlockchainInfo: sinon.stub().rejects(new Error('ECONNREFUSED')) }
        const log = logger()
        await assert.rejects(() => verifyNodeChain(connector, 'regtest', log, fast), new RegExp(EXIT + '1'))
        assert.strictEqual(connector.getBlockchainInfo.callCount, fast.attempts)
        assert.match(log.error.firstCall.args[0], /Could not verify the node chain/)
    })
})

describe('node chain verification inside startApi', function () {
    afterEach(function () { sinon.restore() })

    function bootWith(chain) {
        sinon.stub(axios, 'post').callsFake(async (url, body) => {
            if (body.method === 'getblockchaininfo') return { data: { result: { chain }, error: null, id: 1 } }
            throw new Error('unexpected RPC ' + body.method)
        })
        const start = sinon.stub(XChainRegtestMiner.prototype, 'start').resolves()
        const deps = {
            config: { network: 'regtest', coinNetwork: 'bitcoin-regtest', nodeUrl: 'localhost', nodePort: '18443',
                nodeUser: 'user', nodePassword: 'password', apiPort: 0, apiKey: null },
            environment: { NETWORK: 'bitcoin-regtest', NODE_URL: 'localhost', NODE_PORT: '18443', NODE_USER: 'user',
                NODE_PASSWORD: 'password', REGTEST_MINER_API_PORT: '8080' },
            logger: logger(),
            createHealthController: sinon.stub().returns({ health: sinon.stub() }),
            mountJsonRpc: sinon.stub(),
            warnWhenApiIsOpen: sinon.stub()
        }
        return { start, deps, startApi: createStartApi(deps) }
    }

    it('never starts the miner or mounts the API against a node on mainnet', async function () {
        stubExit()
        const { start, deps, startApi } = bootWith('main')
        await assert.rejects(() => startApi(), new RegExp(EXIT + '1'))
        assert.strictEqual(start.called, false, 'the wallet must not be touched')
        assert.strictEqual(deps.warnWhenApiIsOpen.called, false)
        assert.strictEqual(deps.mountJsonRpc.called, false, 'no RPC method may be reachable')
    })

    it('boots as before against a regtest node', async function () {
        const exit = stubExit()
        const listen = sinon.stub(require('express').application, 'listen').returns({ close: sinon.stub() })
        const { start, deps, startApi } = bootWith('regtest')
        await startApi()
        assert.strictEqual(exit.called, false)
        assert.strictEqual(start.calledOnce, true)
        assert.strictEqual(deps.mountJsonRpc.calledOnce, true)
        assert.strictEqual(listen.calledOnce, true)
    })
})
