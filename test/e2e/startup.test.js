/**
 * E2E Tests — Category A: Startup and Wallet Lifecycle
 *
 * Validates the full prepareWallet flow against a stateful mock node
 * that tracks wallet creation, loading, balance, and chain height.
 */

const assert = require('assert')
const sinon = require('sinon')
const BlockchainConnector = require('../../src/BlockchainConnector')
const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
const StatefulMockNode = require('./helpers/StatefulMockNode')

describe('E2E: Startup and Wallet Lifecycle', function () {
    let node

    before(async function () {
        node = new StatefulMockNode()
        await node.start()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    after(async function () {
        sinon.restore()
        await node.stop()
    })

    beforeEach(function () {
        node.reset()
    })

    function createMiner() {
        const miner = new XChainRegtestMiner('regtest', '127.0.0.1', String(node.port), 'user', 'pass')
        return miner
    }

    // ─── A1: Fresh start — wallet creation and initial funding ──────

    it('A1: creates wallet and mines 101 blocks on fresh node', async function () {
        const miner = createMiner()

        await miner.prepareWallet()

        // Wallet was created
        assert.strictEqual(node.wallet.exists, true)
        assert.strictEqual(node.wallet.loaded, true)
        assert.strictEqual(node.wallet.name, 'xchain_regtest_wallet')

        // 101 blocks were mined (coinbase maturity)
        assert.strictEqual(node.height, 101)
        assert.strictEqual(node.callsFor('createwallet').length, 1)
        assert.strictEqual(node.callsFor('generatetoaddress').length, 1)
        assert.deepStrictEqual(node.callsFor('generatetoaddress')[0].params[0], 101)

        // Miner has a wallet address
        assert.ok(miner.walletAddress)
        assert.ok(miner.walletAddress.startsWith('bcrt'))

        // Balance is now positive (1 mature coinbase at height 1 after 101 blocks)
        const balanceResult = await miner.connector.getBalance()
        assert.ok(balanceResult > 0)
    })

    // ─── A2: Restart — wallet already loaded ────────────────────────

    it('A2: skips creation when wallet is already loaded', async function () {
        // Pre-condition: wallet exists and is loaded, chain has blocks, balance > 0
        node._rpc_createwallet(['xchain_regtest_wallet'])
        node._rpc_generatetoaddress([110, 'bcrt1qfakeaddr'])

        const heightBefore = node.height
        const miner = createMiner()

        await miner.prepareWallet()

        // No create or load calls
        assert.strictEqual(node.callsFor('createwallet').length, 0)
        assert.strictEqual(node.callsFor('loadwallet').length, 0)

        // No additional mining (balance is already positive)
        assert.strictEqual(node.height, heightBefore)
        assert.strictEqual(node.callsFor('generatetoaddress').length, 0)

        // Miner still got a new address
        assert.ok(miner.walletAddress)
    })

    // ─── A3: Restart — wallet exists but unloaded ───────────────────

    it('A3: loads wallet when it exists but is not loaded', async function () {
        // Pre-condition: wallet was created previously but is not loaded
        node.wallet = { exists: true, loaded: false, name: 'xchain_regtest_wallet' }
        // Seed some blocks and balance so mining is skipped
        for (let i = 0; i < 110; i++) {
            node.height++
            node.pendingRewards.push({ height: node.height, amount: 5000000000 })
            node.blocks.push({ hash: node._generateHash(), height: node.height, txids: [], previousHash: '00' })
        }
        node._matureCoinbases()

        const miner = createMiner()
        await miner.prepareWallet()

        // loadWallet was called, createWallet was not
        assert.strictEqual(node.callsFor('loadwallet').length, 1)
        assert.strictEqual(node.callsFor('createwallet').length, 0)

        // No mining (balance is positive)
        assert.strictEqual(node.callsFor('generatetoaddress').length, 0)

        assert.ok(miner.walletAddress)
    })

    // ─── A4: Empty balance at height > 100 — mines 1 block ─────────

    it('A4: mines 1 block when balance is zero and height > 100', async function () {
        // Wallet loaded, chain at height 150, but balance is 0
        node._rpc_createwallet(['xchain_regtest_wallet'])
        // Add blocks without coinbase rewards going to our wallet
        for (let i = 0; i < 150; i++) {
            node.height++
            node.blocks.push({ hash: node._generateHash(), height: node.height, txids: [], previousHash: '00' })
        }
        // Balance stays at 0 (no pending rewards)

        const miner = createMiner()
        await miner.prepareWallet()

        // Should mine exactly 1 block (not 101)
        assert.strictEqual(node.callsFor('generatetoaddress').length, 1)
        assert.deepStrictEqual(node.callsFor('generatetoaddress')[0].params[0], 1)
    })

    // ─── A5: All wallet methods fail — throws ───────────────────────

    it('A5: throws when wallet cannot be created', async function () {
        // Node has no wallet, load will fail, create will fail
        // Override createwallet to always error
        const originalHandler = node._rpc_createwallet.bind(node)
        node._rpc_createwallet = () => {
            const err = new Error('disk full')
            err.rpcCode = -1
            throw err
        }

        const miner = createMiner()
        // Speed up connector retry sleep (default retries 10× with 1s sleep)
        miner.connector.sleep = async () => {}

        await assert.rejects(
            () => miner.prepareWallet(),
            /Error when trying to create the wallet/
        )

        // Restore
        node._rpc_createwallet = originalHandler
    })
})
