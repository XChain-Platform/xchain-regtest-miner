/*********************************************************************
 *
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC – https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 *
 **********************************************************************
 *
 * XChain Regtest Miner - Block Generation
 *
 * Queued and raw block generation, the auto-mine start loop and the
 * status snapshot, installed onto the XChainRegtestMiner prototype.
 *
 ********************************************************************/

'use strict';

const {
    CHECK_BLOCK_DELAY_MS,
    MAX_GENERATE_BLOCKS,
    logger
} = require('./constants.js')

const MAX_BACKOFF_MS = 30000

// Graceful shutdown on SIGTERM/SIGINT: stop the mining loop, close the API
// server, then exit. Merely flipping this._shutdown is not enough: registering
// a signal listener suppresses Node's default terminate, and the listening
// Express server keeps the event loop alive, so the process would hang until
// docker's stop-grace SIGKILL. Close the server (thread in via api.js) and exit.
function installShutdownHandlers(){
    this._sigTermHandler = (signal) => {
        logger.info("Received " + (signal || "SIGTERM") + ", shutting down gracefully...")
        this._shutdown = true
        const done = () => process.exit(0)
        if (this.apiServer && typeof this.apiServer.close === "function") {
            this.apiServer.close(done)
            // Failsafe: force exit if lingering keep-alive sockets stall close().
            setTimeout(done, 2000).unref()
        } else {
            done()
        }
    }
    process.on('SIGTERM', () => this._sigTermHandler('SIGTERM'))
    process.on('SIGINT',  () => this._sigTermHandler('SIGINT'))
}

// The auto-mine loop itself. `loop` carries the mempool timers, the RPC error
// streak and the heartbeat baseline across passes.
async function runMineLoop(loop){
    while (!this._shutdown){
        // Bound wallet_balance staleness at WALLET_BALANCE_REFRESH_MS whatever
        // moved the wallet: send_funds, fill_mempool, coinbase maturity, a
        // node-side change. Deliberately ABOVE the keepMining gate, because
        // fill_mempool and pause_mining hold that flag false for exactly the
        // windows in which the wallet drains, and a refresh that only ran while
        // mining would go quiet at the moment it is needed. refreshWalletFunds()
        // never throws, so this cannot break the loop; and both mine sites below
        // re-read keepMining immediately before generateBlocks, so this await
        // cannot reopen the pause barrier window those guards close.
        if (this.walletRefreshDue(Date.now())) {
            await this.refreshWalletFunds()
        }
        if (this.keepMining){
            if (timerMineDue.call(this, loop)){
                // Re-read keepMining immediately before mining, with NO await
                // between the check and the call. generateBlocks appends to
                // _generateQueue synchronously, so a pause that lands after this
                // check is already behind the barrier pauseMining()/fillMempool()
                // await, and one that lands before it stops the mine outright.
                // Nothing awaits between the loop's own keepMining check above and
                // here today, so this guard changes no behavior at this site; it
                // pins the invariant so inserting an await above cannot silently
                // reopen the window the idle-mine site below actually had.
                if (!this.keepMining) { await this.sleep(CHECK_BLOCK_DELAY_MS); continue }
                if (!(await mineLoopBlock.call(this, loop, "generating a new block"))) continue

                loop.initialStartToMine = 0
                loop.extendedStartToMine = 0
                loop.lastRawMempoolLength = 0
            }

            const read = await readLoopMempool.call(this, loop)
            if (!read.ok) continue

            // Mine-empty heartbeat (off unless IDLE_MINE_INTERVAL_MS /
            // set_idle_mine_interval turned it on). Only on the empty-mempool
            // branch: a pending transaction has its own timer above, and
            // racing it would mine the block early.
            if (trackMempool.call(this, loop, read.rawMempool) && this.idleMineDue(Date.now(), loop.watchingSince)){
                // The real window this guard closes. The loop's keepMining check
                // sits above the `await this.connector.getRawMempool()` in readLoopMempool,
                // so a pauseMining()/fillMempool() that flipped the flag
                // during that RPC had already cleared its _generateQueue barrier
                // and returned by the time control reached here: the heartbeat then
                // landed a block INSIDE a section the caller had been told was
                // serialized, corrupting exactly the height-deterministic reorg and
                // mempool drills the barrier exists for.
                if (!this.keepMining) { await this.sleep(CHECK_BLOCK_DELAY_MS); continue }
                if (!(await mineLoopBlock.call(this, loop, "mining an idle block"))) continue
            }
        }
        await this.sleep(CHECK_BLOCK_DELAY_MS)
    }
}

// Whether a pending mempool is due to be mined: the first tx has waited
// maxTimeToMineTxs, or no new tx has arrived for addedTimeToMineTxs.
function timerMineDue(loop){
    if ((loop.initialStartToMine > 0) && (loop.extendedStartToMine > 0)){
        let timeNow = Date.now()
        let initialTimePassed = timeNow-loop.initialStartToMine
        let extendedStartTime = timeNow-loop.extendedStartToMine

        return (initialTimePassed >= this.maxTimeToMineTxs) || (extendedStartTime >= this.addedTimeToMineTxs)
    }
    return false
}

// Mines one block for the loop. Resolves true on success; on failure it extends
// both error streaks, backs off, and resolves false so the loop starts its next pass.
async function mineLoopBlock(loop, what){
    try {
        await this.generateBlocks(1)
        loop.consecutiveErrors = 0
        this._consecutiveErrors = 0
        this._mineFailures = 0
        // blocks_mined / last_mine_at are updated in generateBlocksRaw
        // (the chokepoint all mining paths flow through).
        return true
    } catch (err){
        loop.consecutiveErrors++
        this._consecutiveErrors = loop.consecutiveErrors
        this._mineFailures++
        let backoff = Math.min(CHECK_BLOCK_DELAY_MS * Math.pow(2, loop.consecutiveErrors), MAX_BACKOFF_MS)
        logger.info("There were problems "+what+": "+(err && err.message ? err.message : err)+"; retrying in "+backoff+"ms.")
        await this.sleep(backoff)
        return false
    }
}

// Reads the mempool for one pass. Resolves { ok: true, rawMempool }, or after
// extending the error streak and backing off, { ok: false } to skip the pass.
async function readLoopMempool(loop){
    let rawMempool = null
    try {
        rawMempool = await this.connector.getRawMempool()
        loop.consecutiveErrors = 0
        this._consecutiveErrors = 0
    } catch (error){
        loop.consecutiveErrors++
        this._consecutiveErrors = loop.consecutiveErrors
        let backoff = Math.min(CHECK_BLOCK_DELAY_MS * Math.pow(2, loop.consecutiveErrors), MAX_BACKOFF_MS)
        logger.info("There were problems getting the mempool: "+(error && error.message ? error.message : error)+"; retrying in "+backoff+"ms.")
        await this.sleep(backoff)
        return { ok: false }
    }
    return { ok: true, rawMempool }
}

// Updates the mempool timers and the exported size from one read. Returns true
// when the mempool is empty, the only state the idle heartbeat may mine in.
function trackMempool(loop, rawMempool){
    if (rawMempool != null && rawMempool.length > 0){
        if (rawMempool.length > loop.lastRawMempoolLength){
            //there are new txs in the mempool
            if (loop.initialStartToMine == 0){
                loop.initialStartToMine = Date.now()
                loop.extendedStartToMine = loop.initialStartToMine
            } else {
                loop.extendedStartToMine = Date.now()
            }
        }
        loop.lastRawMempoolLength = rawMempool.length
        this._mempoolSize = rawMempool.length
        return false
    }
    loop.initialStartToMine = 0
    loop.extendedStartToMine = 0
    loop.lastRawMempoolLength = 0
    this._mempoolSize = 0
    return true
}

module.exports = {
    // Throws on invalid count, like setMiningTime: a sentinel
    // return of `[]` would let generate_blocks({count:0|-1|'abc'}) silently
    // answer {count: 0, hashes: []} through the controller with no error.
    async generateBlocks(count) {
        // Refuse an EXTERNAL mine while a fill is building the mempool. fillMempool
        // flips keepMining false and drains _generateQueue once (the bare
        // "await this._generateQueue" at the top of its body), which stops the
        // auto-mine loop and any mine already queued, and stops nothing after that:
        // api.js exposes generate_blocks with no mining gate, so a mine arriving
        // during the several-minute broadcast loop mined the stress transactions
        // straight back out and fill_mempool still answered "ok". Checked
        // SYNCHRONOUSLY, before any await and before the queue append, for the same
        // reason fillMempool claims its own mutex before its first await: a guard
        // that straddles an await is not a guard. fillMempool's own funding mines
        // and prepareWallet's warmup take _generateBlocksQueued below and are
        // unaffected. This cannot fire from the auto-mine loop: both of its mine
        // sites re-read keepMining with no await before the call, and fillMempool
        // sets fillMempoolRunning and clears keepMining in one synchronous block,
        // so a loop that got past its guard is already ahead of this one.
        if (this.fillMempoolRunning) {
            throw new Error("mining is disabled while fill_mempool is running")
        }
        return this.generateBlocksQueued(count)
    },

    // The mine itself, reachable while a fill holds the public entry point shut.
    // fillMempool's funding mines and prepareWallet's warmup are the only callers
    // that may bypass that guard: they are the fill's own work, not a competing
    // block, and routing them through the public method would make fillMempool
    // throw on itself.
    async generateBlocksQueued(count) {
        if (!Number.isInteger(count) || count <= 0) {
            throw new Error("count must be a positive integer")
        }
        // Cap the per-call block count. generatetoaddress mines synchronously on the
        // node, so an unbounded count (e.g. from the unauthenticated-by-default
        // generate_blocks RPC) blocks the node for minutes-to-forever; and because
        // every mining caller serializes behind _generateQueue, that one call also
        // wedges the auto-mine loop and every pause/fillMempool barrier queued behind
        // it. fillMempool is already capped the same way (MAX_FILL_MEMPOOL_QUANTITY);
        // this closes the sibling gap on the block-generation path.
        if (count > MAX_GENERATE_BLOCKS) {
            throw new Error("count exceeds maximum of " + MAX_GENERATE_BLOCKS)
        }
        // Serialize all callers (auto-mine loop + generate_blocks RPC) behind a
        // single promise chain so concurrent calls never issue overlapping
        // generateToAddress requests against the node. The chain itself is kept
        // on a rejection-swallowing tail (`.catch`) so that one failed mining
        // attempt does not poison the queue: the next caller still runs, while
        // this caller still receives its own success/failure via `run`.
        // Snapshot the reorgs in flight at APPEND time. A reorg raised later
        // captured the queue tail this append is joining, so it already waits for
        // this mine; making this mine wait for it too is the deadlock.
        const heldBy = [...this._reorgMineHolds.values()].map((hold) => hold.held)
        const run = this._generateQueue.then(() => this.mineWhenReorgIdle(count, heldBy))
        this._generateQueue = run.catch(() => {})
        return run
    },

    async generateBlocksRaw(numberOfBlocks){
        let hashes = await this.connector.generateToAddress(numberOfBlocks, this.walletAddress)

        // Count every mine that flows through this serialized chokepoint (auto-mine
        // loop, generate_blocks RPC, fillMempool, prepareWallet warmup). blocks_mined
        // is a monotonic count of blocks this service generated (mining work
        // performed), not chain height: it intentionally does NOT decrement after an
        // invalidate_block rollback.
        this._blocksMined += numberOfBlocks
        this._lastMineAt = Date.now()

        if (numberOfBlocks > 1){
            logger.info(numberOfBlocks+" new blocks have been generated")
        } else if (numberOfBlocks > 0){
            logger.info("A new block has been generated")
        }
        return hashes
    },

    async start(){
        //Prepare the wallet
        await this.prepareWallet()

        //Loop to check if there are transactions in the mempool, if there are, then
        //Wait some time for new txs, if there is a new tx in that time, then extended the waiting time again
        //If there are no new tx in that time, then mine a block
        logger.info("Ready. Checking for new txs")

        installShutdownHandlers.call(this)

        const loop = {
            lastRawMempoolLength: 0,
            initialStartToMine: 0,
            extendedStartToMine: 0,
            consecutiveErrors: 0,
            // Baseline for the mine-empty heartbeat on a miner that has not mined yet,
            // so enabling it never fires a block the instant the loop starts.
            watchingSince: Date.now()
        }
        this.keepMining = true
        this._miningStateGeneration++
        // Reached only after prepareWallet() resolved, so from here a keepMining=false
        // is an operator pause rather than startup. Never reset: pauseMining() only
        // clears keepMining, and a paused loop has still started.
        this.miningStarted = true

        await runMineLoop.call(this, loop)
    },

    getStatus(){
        return {
            wallet_ready: this.walletReady,
            // Fund-capability, read at startup, at both reorg termini, and by the
            // auto-mine loop at most WALLET_BALANCE_REFRESH_MS apart, so the value is
            // never staler than that interval whatever drained the wallet.
            // wallet_ready is a startup-completion flag and stays true across a reorg
            // by design, so a drill that needs to know whether the wallet can still
            // fund a send reads these instead. wallet_balance is null when the last
            // read failed or none has happened, which is not funded either: a transient
            // getbalance failure therefore flips wallet_funded false for one interval,
            // and that direction is deliberate, because a false unfunded is safe where
            // a false funded is not. wallet_balance_at is the epoch-ms timestamp of the
            // last read ATTEMPT (null if none), so a drill can tell a fresh reading
            // from a wedged one rather than inferring liveness from the number alone.
            wallet_balance: this.balance,
            wallet_funded: typeof this.balance === 'number' && this.balance > 0,
            wallet_balance_at: this._balanceReadAt,
            mempool_size: this._mempoolSize,
            // 0 = mempool-driven mining only (the default). Non-zero = the loop
            // also mines one empty block per interval while the mempool is empty,
            // so height-gated states (stake activation, confirmation depth) advance
            // on an idle chain without dropping to raw node RPC.
            idle_mine_interval_ms: this.idleMineIntervalMs,
            blocks_mined: this._blocksMined,
            last_mine_at: this._lastMineAt,
            consecutive_errors: this._consecutiveErrors,
            // Consecutive FAILED MINES, on its own streak: consecutive_errors is
            // zeroed by a successful mempool read, so it cannot report a miner that
            // is answering RPC but unable to generate a block.
            mine_failures: this._mineFailures,
            // Surface the paused state so a fill_mempool / invalidate_block that was never
            // paired with continue_mining is observable as a deliberate pause rather than
            // reading as a node hang (the loop holds keepMining=false until resumed).
            mining_paused: !this.keepMining,
            // Distinguishes the identical keepMining=false of a miner still preparing
            // its wallet from that of a paused one, so a probe can call the first a
            // stall and the second healthy.
            mining_started: this.miningStarted
        }
    }
}
