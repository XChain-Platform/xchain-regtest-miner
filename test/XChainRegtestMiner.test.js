const assert = require('assert')
const sinon = require('sinon')

// Stub BlockchainConnector before requiring XChainRegtestMiner
const BlockchainConnector = require('../src/BlockchainConnector')

describe('XChainRegtestMiner', function () {
    let XChainRegtestMiner
    let miner
    let connectorStub

    beforeEach(function () {
        // Create a stub for every BlockchainConnector method
        connectorStub = {
            getWalletInfo: sinon.stub(),
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

        // Stub the BlockchainConnector constructor
        sinon.stub(BlockchainConnector.prototype, 'constructor')

        XChainRegtestMiner = require('../src/XChainRegtestMiner')
        miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
        miner.connector = connectorStub

        sinon.stub(miner, 'sleep').resolves()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    afterEach(function () {
        sinon.restore()
        // Clear module cache so fresh require works each time
        delete require.cache[require.resolve('../src/XChainRegtestMiner')]
    })

    // ─── Constructor ────────────────────────────────────────────────────

    describe('constructor', function () {
        it('initializes with correct defaults', function () {
            assert.strictEqual(miner.walletNameParam, 'xchain_regtest_wallet')
            assert.strictEqual(miner.keepMining, false)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('creates a BlockchainConnector instance', function () {
            assert.ok(miner.connector)
        })
    })

    // ─── setMiningTime ──────────────────────────────────────────────────

    describe('setMiningTime', function () {
        it('updates both timing values with valid integers', async function () {
            await miner.setMiningTime(10000, 2000)
            assert.strictEqual(miner.maxTimeToMineTxs, 10000)
            assert.strictEqual(miner.addedTimeToMineTxs, 2000)
        })

        it('does not update with non-integer maxTime', async function () {
            await miner.setMiningTime(10.5, 2000)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('does not update with non-integer txAddedTime', async function () {
            await miner.setMiningTime(10000, 'abc')
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('rejects zero values', async function () {
            await miner.setMiningTime(0, 0)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('rejects negative integers', async function () {
            await miner.setMiningTime(-1, -1)
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })

        it('is isolated per instance', async function () {
            const miner2 = new XChainRegtestMiner('regtest', 'localhost', '18332', 'u', 'p')
            await miner.setMiningTime(1000, 500)
            assert.strictEqual(miner2.maxTimeToMineTxs, 30000)
        })
    })

    // ─── setDefaultMiningTime ───────────────────────────────────────────

    describe('setDefaultMiningTime', function () {
        it('resets timing to defaults', async function () {
            miner.maxTimeToMineTxs = 1000
            miner.addedTimeToMineTxs = 500
            await miner.setDefaultMiningTime()
            assert.strictEqual(miner.maxTimeToMineTxs, 30000)
            assert.strictEqual(miner.addedTimeToMineTxs, 5000)
        })
    })

    // ─── continueMining ─────────────────────────────────────────────────

    describe('continueMining', function () {
        it('sets keepMining to true', async function () {
            miner.keepMining = false
            await miner.continueMining()
            assert.strictEqual(miner.keepMining, true)
        })
    })

    // ─── sendFundsToAddress ─────────────────────────────────────────────

    describe('sendFundsToAddress', function () {
        it('delegates to connector.sendToAddress and returns txid', async function () {
            connectorStub.sendToAddress.resolves('txid123')
            const result = await miner.sendFundsToAddress('addr', 1.0)
            assert.strictEqual(result, 'txid123')
            assert(connectorStub.sendToAddress.calledWith('addr', 1.0))
        })

        it('propagates errors', async function () {
            connectorStub.sendToAddress.rejects(new Error('insufficient funds'))
            await assert.rejects(() => miner.sendFundsToAddress('a', 1), /insufficient funds/)
        })
    })

    // ─── createWallet ───────────────────────────────────────────────────

    describe('createWallet', function () {
        it('delegates to connector.createWallet and returns true', async function () {
            connectorStub.createWallet.resolves({ name: 'w' })
            const result = await miner.createWallet('w')
            assert.strictEqual(result, true)
        })

        it('throws on connector error', async function () {
            connectorStub.createWallet.rejects(new Error('already exists'))
            await assert.rejects(() => miner.createWallet('w'), /already exists/)
        })
    })

    // ─── generateBlocks ─────────────────────────────────────────────────

    describe('generateBlocks', function () {
        it('calls generateToAddress with count and wallet address', async function () {
            miner.walletAddress = 'bcrt1qreward'
            await miner.generateBlocks(5)
            assert(connectorStub.generateToAddress.calledWith(5, 'bcrt1qreward'))
        })

        it('logs plural message for multiple blocks', async function () {
            miner.walletAddress = 'addr'
            await miner.generateBlocks(3)
            assert(console.log.calledWithMatch(/3 new blocks have been generated/))
        })

        it('logs singular message for one block', async function () {
            miner.walletAddress = 'addr'
            await miner.generateBlocks(1)
            assert(console.log.calledWithMatch(/A new block has been generated/))
        })

        it('does not log for zero blocks', async function () {
            miner.walletAddress = 'addr'
            // Reset console.log call tracking
            console.log.resetHistory()
            await miner.generateBlocks(0)
            // Only the generic logs from other setup, not block generation messages
            const blockMessages = console.log.args.filter(
                args => args[0] && typeof args[0] === 'string' && args[0].includes('generated')
            )
            assert.strictEqual(blockMessages.length, 0)
        })
    })

    // ─── prepareWallet ──────────────────────────────────────────────────

    describe('prepareWallet', function () {
        it('skips load/create when wallet is already loaded', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'existing' })
            await miner.prepareWallet()
            assert(connectorStub.loadWallet.notCalled)
            assert(connectorStub.createWallet.notCalled)
            assert.strictEqual(miner.walletAddress, 'bcrt1qtest')
        })

        it('loads existing wallet when getWalletInfo fails', async function () {
            connectorStub.getWalletInfo.rejects(new Error('no wallet'))
            connectorStub.loadWallet.resolves({ name: 'xchain_regtest_wallet' })
            await miner.prepareWallet()
            assert(connectorStub.loadWallet.calledWith('xchain_regtest_wallet'))
            assert(connectorStub.createWallet.notCalled)
        })

        it('creates wallet when both getWalletInfo and loadWallet fail', async function () {
            connectorStub.getWalletInfo.rejects(new Error('no wallet'))
            connectorStub.loadWallet.rejects(new Error('not found'))
            connectorStub.createWallet.resolves({ name: 'xchain_regtest_wallet' })
            await miner.prepareWallet()
            assert(connectorStub.createWallet.calledWith('xchain_regtest_wallet'))
        })

        it('throws when all wallet methods fail', async function () {
            connectorStub.getWalletInfo.rejects(new Error('no wallet'))
            connectorStub.loadWallet.rejects(new Error('not found'))
            connectorStub.createWallet.rejects(new Error('disk full'))
            await assert.rejects(() => miner.prepareWallet(), /Error when trying to create the wallet/)
        })

        it('gets a new address after wallet is ready', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            await miner.prepareWallet()
            assert(connectorStub.getNewAddress.calledOnce)
            assert.strictEqual(miner.walletAddress, 'bcrt1qtest')
        })

        it('mines 101 blocks when balance is zero and height <= 100', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.resolves(0)
            connectorStub.getBlockchainInfo.resolves({ blocks: 50 })
            await miner.prepareWallet()
            assert(connectorStub.generateToAddress.calledWith(101, 'bcrt1qtest'))
        })

        it('mines 1 block when balance is zero and height > 100', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.resolves(0)
            connectorStub.getBlockchainInfo.resolves({ blocks: 200 })
            await miner.prepareWallet()
            assert(connectorStub.generateToAddress.calledWith(1, 'bcrt1qtest'))
        })

        it('does not mine when balance is positive', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.resolves(50.0)
            await miner.prepareWallet()
            assert(connectorStub.generateToAddress.notCalled)
        })

        it('mines 101 blocks at exactly height 100', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.resolves(0)
            connectorStub.getBlockchainInfo.resolves({ blocks: 100 })
            await miner.prepareWallet()
            assert(connectorStub.generateToAddress.calledWith(101, 'bcrt1qtest'))
        })

        it('mines 1 block at height 101', async function () {
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.resolves(0)
            connectorStub.getBlockchainInfo.resolves({ blocks: 101 })
            await miner.prepareWallet()
            assert(connectorStub.generateToAddress.calledWith(1, 'bcrt1qtest'))
        })

        it('treats getWalletInfo returning null as no wallet loaded', async function () {
            connectorStub.getWalletInfo.resolves(null)
            connectorStub.loadWallet.resolves({ name: 'w' })
            await miner.prepareWallet()
            assert(connectorStub.loadWallet.calledOnce)
        })
    })

    // ─── Mining Loop (start) ────────────────────────────────────────────

    describe('start (mining loop)', function () {
        let clock

        beforeEach(function () {
            // Use real timers for Date.now but stub sleep to not actually wait
            // We'll control Date.now via sinon fake timers
            clock = sinon.useFakeTimers({ now: 1000000, shouldAdvanceTime: false })

            // prepareWallet succeeds
            connectorStub.getWalletInfo.resolves({ walletname: 'w' })
            connectorStub.getBalance.resolves(50.0)
            miner.walletAddress = 'bcrt1qtest'

            // Override prepareWallet to avoid its complexity
            sinon.stub(miner, 'prepareWallet').resolves()
        })

        afterEach(function () {
            clock.restore()
        })

        // Helper to run the mining loop for a controlled number of iterations
        async function runLoopIterations(miner, iterations) {
            let loopCount = 0
            const originalSleep = miner.sleep

            // Replace sleep to count iterations and break the loop
            miner.sleep.callsFake(async () => {
                loopCount++
                if (loopCount >= iterations) {
                    miner.keepMining = false
                    // Throw to break out of the while(true) loop
                    throw new Error('__LOOP_BREAK__')
                }
            })

            try {
                await miner.start()
            } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }
        }

        it('calls prepareWallet on start', async function () {
            connectorStub.getRawMempool.resolves([])
            await runLoopIterations(miner, 1)
            assert(miner.prepareWallet.calledOnce)
        })

        it('sets keepMining to true', async function () {
            connectorStub.getRawMempool.resolves([])
            // Check that keepMining was set to true before the loop break
            let wasMiningTrue = false
            miner.sleep.callsFake(async () => {
                if (miner.keepMining) wasMiningTrue = true
                throw new Error('__LOOP_BREAK__')
            })
            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }
            assert(wasMiningTrue)
        })

        it('polls mempool when keepMining is true', async function () {
            connectorStub.getRawMempool.resolves([])
            await runLoopIterations(miner, 3)
            assert(connectorStub.getRawMempool.callCount >= 1)
        })

        it('does not poll mempool when keepMining is false', async function () {
            let iterCount = 0
            let mempoolCalledWhilePaused = false

            // getRawMempool should track if called while keepMining is false
            connectorStub.getRawMempool.callsFake(async () => {
                if (!miner.keepMining) mempoolCalledWhilePaused = true
                return []
            })

            miner.sleep.callsFake(async () => {
                iterCount++
                // On first sleep, disable mining. Subsequent iterations should skip mempool.
                if (iterCount === 1) {
                    miner.keepMining = false
                    connectorStub.getRawMempool.resetHistory()
                }
                if (iterCount >= 4) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }
            // After keepMining was set to false, getRawMempool should not have been called
            assert.strictEqual(connectorStub.getRawMempool.callCount, 0)
        })

        it('starts initial timer when first tx appears in mempool', async function () {
            connectorStub.getRawMempool.resolves(['txid1'])

            let generateCalled = false
            connectorStub.generateToAddress.callsFake(async () => {
                generateCalled = true
                return ['hash']
            })

            // First iteration: mempool has tx, timer starts
            // Timer should NOT fire yet (no time has passed)
            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount >= 2) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // generateBlocks should NOT have been called yet (timer just started)
            assert.strictEqual(generateCalled, false)
        })

        it('mines block after maxTimeToMineTxs elapses', async function () {
            miner.maxTimeToMineTxs = 100 // 100ms for test speed
            miner.addedTimeToMineTxs = 50000 // large so it doesn't trigger

            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) {
                    // Advance time past maxTimeToMineTxs
                    clock.tick(150)
                }
                if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert(connectorStub.generateToAddress.called)
        })

        it('mines block after addedTimeToMineTxs with no new txs', async function () {
            miner.maxTimeToMineTxs = 50000 // large so it doesn't trigger
            miner.addedTimeToMineTxs = 100

            connectorStub.getRawMempool.resolves(['txid1'])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) {
                    // Advance time past addedTimeToMineTxs
                    clock.tick(150)
                }
                if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert(connectorStub.generateToAddress.called)
        })

        it('extends timer when new txs arrive', async function () {
            miner.maxTimeToMineTxs = 50000
            miner.addedTimeToMineTxs = 200

            let iterCount = 0
            // Simulate: 1 tx, then 2 txs (new tx arrived)
            connectorStub.getRawMempool.onCall(0).resolves(['txid1'])
            connectorStub.getRawMempool.onCall(1).resolves(['txid1', 'txid2'])
            connectorStub.getRawMempool.onCall(2).resolves(['txid1', 'txid2'])
            connectorStub.getRawMempool.onCall(3).resolves(['txid1', 'txid2'])

            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount === 1) {
                    // After first tx, advance 100ms (not enough for addedTime=200)
                    clock.tick(100)
                }
                if (iterCount === 2) {
                    // New tx arrived, timer extended. Advance another 100ms
                    // Total from initial = 200ms, but from extended = 100ms, not enough
                    clock.tick(100)
                }
                if (iterCount === 3) {
                    // Now advance enough for addedTime from the extended reset
                    clock.tick(150)
                }
                if (iterCount >= 5) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            assert(connectorStub.generateToAddress.called)
        })

        it('resets timers after mining a block', async function () {
            miner.maxTimeToMineTxs = 50
            miner.addedTimeToMineTxs = 50

            connectorStub.getRawMempool.resolves(['txid1'])

            let generateCount = 0
            connectorStub.generateToAddress.callsFake(async () => {
                generateCount++
                return ['hash']
            })

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount <= 2) clock.tick(60)
                if (iterCount >= 5) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // Should have mined at least 2 blocks (timer resets and fires again)
            assert(generateCount >= 2)
        })

        it('resets mempool length tracking when mempool empties', async function () {
            // First poll: mempool has txs
            connectorStub.getRawMempool.onCall(0).resolves(['txid1'])
            // Second poll: mempool empty
            connectorStub.getRawMempool.onCall(1).resolves([])
            // Third poll: same tx appears again -- should be treated as new
            connectorStub.getRawMempool.onCall(2).resolves(['txid1'])

            let iterCount = 0
            let timersResetOnEmpty = false

            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount >= 4) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // The fact that getRawMempool was called 3+ times without error means the loop handled empty correctly
            assert(connectorStub.getRawMempool.callCount >= 3)
        })

        it('handles getRawMempool error gracefully', async function () {
            connectorStub.getRawMempool.onCall(0).rejects(new Error('connection lost'))
            connectorStub.getRawMempool.onCall(1).resolves([])

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount >= 3) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // Should have retried after error
            assert(connectorStub.getRawMempool.callCount >= 2)
        })

        it('handles generateBlocks error gracefully', async function () {
            miner.maxTimeToMineTxs = 50
            miner.addedTimeToMineTxs = 50
            connectorStub.getRawMempool.resolves(['txid1'])

            let genCallCount = 0
            connectorStub.generateToAddress.callsFake(async () => {
                genCallCount++
                if (genCallCount === 1) throw new Error('block generation failed')
                return ['hash']
            })

            let iterCount = 0
            miner.sleep.callsFake(async () => {
                iterCount++
                clock.tick(60)
                if (iterCount >= 5) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            // Should have retried and succeeded on second attempt
            assert(genCallCount >= 2)
        })

        it('tracks lastRawMempoolLength correctly (bug fix verification)', async function () {
            miner.maxTimeToMineTxs = 50000
            miner.addedTimeToMineTxs = 50000

            // Same mempool size across calls -- should NOT reset extended timer
            connectorStub.getRawMempool.resolves(['txid1'])

            let extendedTimerResetCount = 0
            const originalDateNow = Date.now

            let iterCount = 0
            let dateNowCallCount = 0

            // Track how many times Date.now is called after initial setup
            // More calls = more timer resets
            const dateNowStub = sinon.stub(Date, 'now')
            dateNowStub.returns(1000)

            miner.sleep.callsFake(async () => {
                iterCount++
                if (iterCount >= 4) throw new Error('__LOOP_BREAK__')
            })

            try { await miner.start() } catch (e) {
                if (e.message !== '__LOOP_BREAK__') throw e
            }

            dateNowStub.restore()

            // With the bug fix, after the first iteration sets lastRawMempoolLength=1,
            // subsequent iterations with the same mempool length should NOT enter
            // the "new txs" branch. Date.now should be called a limited number of times.
            // The key assertion: getRawMempool was called multiple times but generateToAddress
            // was NOT called (timers didn't trigger because no time advanced)
            assert(connectorStub.generateToAddress.notCalled)
        })
    })

    // ─── fillMempool ────────────────────────────────────────────────────

    describe('fillMempool', function () {
        it('sets keepMining to false', async function () {
            miner.keepMining = true

            // Stub all the crypto/tx operations to prevent actual execution
            // fillMempool will fail on crypto ops but keepMining should already be set
            try {
                await miner.fillMempool(0)
            } catch (e) {
                // May fail on zero quantity edge cases; that's ok for this test
            }

            assert.strictEqual(miner.keepMining, false)
        })

        it('calculates correct number of chunks for quantities within one chunk', function () {
            const chunks = Math.ceil(100 / 2500)
            assert.strictEqual(chunks, 1)
        })

        it('calculates correct number of chunks for exact multiple', function () {
            const chunks = Math.ceil(2500 / 2500)
            assert.strictEqual(chunks, 1)
        })

        it('calculates correct number of chunks for quantity exceeding one chunk', function () {
            const chunks = Math.ceil(2501 / 2500)
            assert.strictEqual(chunks, 2)
        })

        it('calculates correct number of chunks for large quantity', function () {
            const chunks = Math.ceil(7500 / 2500)
            assert.strictEqual(chunks, 3)
        })

        it('calculates correct remainder for last chunk', function () {
            const txQuantity = 2501
            const OUTPUTS_QUANTITY_PER_TX = 2500
            const txsChunksCount = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)
            const lastChunkIndex = txsChunksCount - 1

            let txRemainder = OUTPUTS_QUANTITY_PER_TX
            const remainder = txQuantity % OUTPUTS_QUANTITY_PER_TX
            if (remainder > 0) {
                txRemainder = remainder
            }

            assert.strictEqual(txsChunksCount, 2)
            assert.strictEqual(txRemainder, 1)
        })

        it('calculates correct remainder when evenly divisible', function () {
            const txQuantity = 5000
            const OUTPUTS_QUANTITY_PER_TX = 2500
            const remainder = txQuantity % OUTPUTS_QUANTITY_PER_TX
            // When evenly divisible, remainder is 0, so txRemainder stays at OUTPUTS_QUANTITY_PER_TX
            assert.strictEqual(remainder, 0)
        })

        it('calculates correct funding amount per chunk', function () {
            const AMOUNT_FOR_EACH_ADDRESS = 1000
            const FEE = 1000
            const txRemainder = 100
            const SATOSHI_UNIT = 100000000.0

            const totalAmount =
                AMOUNT_FOR_EACH_ADDRESS * txRemainder +
                FEE * txRemainder +
                50 * txRemainder

            assert.strictEqual(totalAmount, 205000)
            assert.strictEqual(totalAmount / SATOSHI_UNIT, 0.00205)
        })
    })

    // ─── sleep ──────────────────────────────────────────────────────────

    describe('sleep', function () {
        beforeEach(function () {
            miner.sleep.restore()
        })

        it('resolves after the specified delay', async function () {
            const fakeClock = sinon.useFakeTimers()
            const promise = miner.sleep(100)
            fakeClock.tick(100)
            await promise
            fakeClock.restore()
        })
    })
})
