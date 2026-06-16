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

const BlockchainConnector = require('../../src/BlockchainConnector')

describe('Boundary: Block Generation', function () {
    let XChainRegtestMiner
    let miner
    let connectorStub

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
            getRawTransaction: sinon.stub().resolves('0200000001...'),
            sendRawTransaction: sinon.stub().resolves('txid_sent'),
            getNetworkInfo: sinon.stub().resolves({}),
        }

        sinon.stub(BlockchainConnector.prototype, 'constructor')

        XChainRegtestMiner = require('../../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        miner.connector = connectorStub

        sinon.stub(miner, 'sleep').resolves()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')

        miner.walletAddress = 'bcrt1qtest'
    })

    afterEach(function () {
        sinon.restore()
        delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
    })

    // ─── G-01: generateBlocks(0) ───────────────────────────────────────

    describe('G-01: generateBlocks(0)', function () {
        it('is a no-op — does not call generateToAddress (node rejects count 0)', async function () {
            await miner.generateBlocks(0)
            assert(connectorStub.generateToAddress.notCalled,
                'count 0 must short-circuit before the RPC')
        })

        it('returns an empty array for count 0', async function () {
            const result = await miner.generateBlocks(0)
            assert.deepStrictEqual(result, [])
        })

        it('does not log any block generation message', async function () {
            console.log.resetHistory()
            await miner.generateBlocks(0)
            const blockMessages = console.log.args.filter(
                args => args[0] && typeof args[0] === 'string' && args[0].includes('generated')
            )
            assert.strictEqual(blockMessages.length, 0,
                'No "generated" message for 0 blocks')
        })
    })

    // ─── G-02: generateBlocks(1) ───────────────────────────────────────

    describe('G-02: generateBlocks(1)', function () {
        it('calls generateToAddress with count=1', async function () {
            await miner.generateBlocks(1)
            assert(connectorStub.generateToAddress.calledWith(1, 'bcrt1qtest'))
        })

        it('logs singular message', async function () {
            await miner.generateBlocks(1)
            assert(console.log.calledWithMatch(/A new block has been generated/))
        })
    })

    // ─── G-03: generateBlocks(101) during prepareWallet ────────────────

    describe('G-03: generateBlocks(101) for coinbase maturity', function () {
        it('calls generateToAddress with count=101', async function () {
            await miner.generateBlocks(101)
            assert(connectorStub.generateToAddress.calledWith(101, 'bcrt1qtest'))
        })

        it('logs plural message for 101 blocks', async function () {
            await miner.generateBlocks(101)
            assert(console.log.calledWithMatch(/101 new blocks have been generated/))
        })
    })

    // ─── G-04: generateBlocks when node disconnected ───────────────────

    describe('G-04: generateBlocks when node is disconnected', function () {
        it('propagates the clean error from connector', async function () {
            connectorStub.generateToAddress.rejects(new Error('Error generating to address'))

            await assert.rejects(
                () => miner.generateBlocks(1),
                /Error generating to address/
            )
        })
    })

    // ─── G-05: generateBlocks timeout ──────────────────────────────────

    describe('G-05: generateBlocks timeout', function () {
        it('propagates clean error from connector on timeout', async function () {
            connectorStub.generateToAddress.rejects(new Error('Error generating to address'))

            await assert.rejects(
                () => miner.generateBlocks(1),
                /Error generating to address/
            )
        })
    })

    // ─── G-06: Concurrent generateBlocks calls ─────────────────────────

    describe('G-06: concurrent generateBlocks calls', function () {
        it('second call is serialized behind first — both complete in queue order', async function () {
            let callOrder = []
            connectorStub.generateToAddress.callsFake(async (count, addr) => {
                callOrder.push(count)
                return ['hash']
            })

            await Promise.all([
                miner.generateBlocks(1),
                miner.generateBlocks(5),
            ])

            assert.strictEqual(connectorStub.generateToAddress.callCount, 2)
            // Queue preserves submission order: 1 must have run before 5
            assert.deepStrictEqual(callOrder, [1, 5])
        })
    })

    // ─── G-07: walletAddress is null/undefined ─────────────────────────

    describe('G-07: walletAddress is null or undefined', function () {
        it('passes null address to generateToAddress', async function () {
            miner.walletAddress = null
            await miner.generateBlocks(1)
            assert(connectorStub.generateToAddress.calledWith(1, null))
        })

        it('passes undefined address to generateToAddress', async function () {
            miner.walletAddress = undefined
            await miner.generateBlocks(1)
            assert(connectorStub.generateToAddress.calledWith(1, undefined))
        })

        it('passes empty string address', async function () {
            miner.walletAddress = ''
            await miner.generateBlocks(1)
            assert(connectorStub.generateToAddress.calledWith(1, ''))
        })
    })

    // ─── Large block count ─────────────────────────────────────────────

    describe('Large block count', function () {
        it('generateBlocks(1000) passes count to connector', async function () {
            await miner.generateBlocks(1000)
            assert(connectorStub.generateToAddress.calledWith(1000, 'bcrt1qtest'))
        })

        it('logs plural message for large count', async function () {
            await miner.generateBlocks(1000)
            assert(console.log.calledWithMatch(/1000 new blocks have been generated/))
        })
    })

    // ─── Negative block count ──────────────────────────────────────────

    describe('Negative block count', function () {
        it('is a no-op — does not call connector for negative count', async function () {
            await miner.generateBlocks(-1)
            assert(connectorStub.generateToAddress.notCalled,
                'negative count must short-circuit before the RPC')
        })

        it('returns an empty array for negative count', async function () {
            const result = await miner.generateBlocks(-1)
            assert.deepStrictEqual(result, [])
        })

        it('does not log for negative count', async function () {
            console.log.resetHistory()
            await miner.generateBlocks(-1)
            const blockMessages = console.log.args.filter(
                args => args[0] && typeof args[0] === 'string' && args[0].includes('generated')
            )
            assert.strictEqual(blockMessages.length, 0,
                'no-op generates no blocks, so no message logged')
        })
    })
})
