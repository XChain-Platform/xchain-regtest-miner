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
 * XChain Regtest Miner - Mining Schedule
 *
 * Mining interval, idle-mine cadence, mock time and the pause and continue
 * controls, installed onto the XChainRegtestMiner prototype.
 *
 ********************************************************************/

'use strict';

const {
    DEFAULT_MAX_TIME_TO_MINE_TXS,
    DEFAULT_ADDED_TIME_TO_MINE_TXS,
    MAX_MINING_TIME,
    MIN_MINING_TIME,
    logger
} = require('./constants.js')

module.exports = {
    async sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    },

    // Throws (rather than returning a sentinel {error} object) on invalid input,
    // matching the sibling validators sendFundsToAddress/invalidateBlock/
    // reconsiderBlock. A returned sentinel here would let the api.js
    // controller's try/catch never fire, so the RPC would report "ok" on
    // rejected input.
    async setMiningTime(maxTime, txAddedTime){
        if (!Number.isInteger(maxTime) || !Number.isInteger(txAddedTime) || maxTime <= 0 || txAddedTime <= 0){
            try { logger.info("INVALID mining times: (Max Time)=>"+maxTime+"ms (Tx Added Time)=>"+txAddedTime+"ms") } catch(e) { logger.info("INVALID mining times (non-printable values)") }
            throw new Error("Invalid mining times. Both values must be positive integers.")
        }
        if (maxTime < MIN_MINING_TIME || txAddedTime < MIN_MINING_TIME){
            logger.info("Mining times too small: minimum is "+MIN_MINING_TIME+"ms")
            throw new Error("Mining times too small. Minimum is "+MIN_MINING_TIME+"ms.")
        }
        if (maxTime > MAX_MINING_TIME || txAddedTime > MAX_MINING_TIME){
            logger.info("Mining times too large: maximum is "+MAX_MINING_TIME+"ms")
            throw new Error("Mining times too large. Maximum is "+MAX_MINING_TIME+"ms.")
        }
        this.maxTimeToMineTxs = maxTime
        this.addedTimeToMineTxs = txAddedTime
        logger.info("New mining times: (Max Time)=>"+maxTime+"ms (Tx Added Time)=>"+txAddedTime+"ms")
    },

    // Turn the mine-empty heartbeat on (ms) or off (0). Throws on invalid input,
    // matching setMiningTime: a returned sentinel would let the api.js controller
    // report "ok" for a rejected value.
    //
    // Deliberately a SEPARATE knob from setMiningTime: those two govern how long
    // to wait for MORE transactions before mining what is already in the mempool,
    // and folding an empty-chain heartbeat into them would make every existing
    // venue start producing empty blocks.
    async setIdleMineInterval(intervalMs){
        if (!Number.isInteger(intervalMs) || intervalMs < 0){
            try { logger.info("INVALID idle mine interval: "+intervalMs) } catch(e) { logger.info("INVALID idle mine interval (non-printable value)") }
            throw new Error("Invalid idle mine interval. Must be a non-negative integer (0 disables).")
        }
        if (intervalMs !== 0 && intervalMs < MIN_MINING_TIME){
            throw new Error("Idle mine interval too small. Minimum is "+MIN_MINING_TIME+"ms (0 disables).")
        }
        if (intervalMs > MAX_MINING_TIME){
            throw new Error("Idle mine interval too large. Maximum is "+MAX_MINING_TIME+"ms.")
        }
        this.idleMineIntervalMs = intervalMs
        logger.info(intervalMs === 0
            ? "Idle mine-empty disabled; the loop mines only when the mempool is non-empty"
            : "Idle mine-empty every "+intervalMs+"ms while the mempool stays empty")
    },

    // Whether an empty block is due: enabled, mempool empty, and nothing mined
    // for at least the interval. `now` is injected so the loop and the tests
    // read the same clock. A miner that has never mined (lastMineAt null) is
    // measured from `since`, the moment the loop started watching, so enabling
    // the heartbeat does not fire a block instantly on boot.
    idleMineDue(now, since){
        if (!this.idleMineIntervalMs) return false
        if (this._mempoolSize > 0) return false
        let last = this._lastMineAt != null ? this._lastMineAt : since
        if (last == null) return false
        return (now - last) >= this.idleMineIntervalMs
    },

    async setDefaultMiningTime(){
        this.maxTimeToMineTxs = DEFAULT_MAX_TIME_TO_MINE_TXS
        this.addedTimeToMineTxs = DEFAULT_ADDED_TIME_TO_MINE_TXS
        logger.info("The mining times were set to the default: (Max Time)=>"+this.maxTimeToMineTxs+"ms (Tx Added Time)=>"+this.addedTimeToMineTxs+"ms")
    },

    // Pin the node clock to `timestamp` (unix seconds) so the NEXT mined block
    // carries that block time; pass 0 to release the mock clock. This is a
    // regtest/testnet-only orchestration aid (setmocktime is meaningless on
    // mainnet and the parity harness that uses it only ever runs on regtest), so
    // refuse it on mainnet rather than forward a harmful RPC to a real node.
    // `this.network` is the coin-network form (e.g. bitcoin-regtest); guard on
    // its network half so 'bitcoin-mainnet' and a bare 'mainnet' both trip.
    async setMockTime(timestamp) {
        if (!Number.isFinite(Number(timestamp)) || Number(timestamp) < 0) {
            throw new Error('setMockTime: timestamp must be a non-negative unix time (0 releases the mock clock)')
        }
        if (String(this.network || '').split('-').pop() === 'mainnet') {
            throw new Error('setMockTime is refused on mainnet')
        }
        return await this.connector.setMockTime(Number(timestamp))
    },

    // Returns the mining-state generation this pause claimed, so a caller that
    // restores the previous state later can check no other pause/continue
    // intervened. The claim is taken synchronously with the flag write, before the
    // barrier below, because the barrier is itself an await another RPC can land
    // inside. Every current caller ignores the value; reconsiderBlock does its own
    // claim through enterReorgPause because a plain generation snapshot cannot
    // tell a second reconsider apart from an operator pause.
    async pauseMining(){
        const generation = this.claimPause()
        // Barrier: a pause that lands between the loop's keepMining check and its
        // generateBlocks(1) would let one more block settle after pause() resolves,
        // breaking a height-deterministic generateBlocks section. Await the in-flight
        // mine so callers get a true barrier.
        await this._generateQueue
        return generation
    },

    async continueMining(){
        this.keepMining = true
        this._miningStateGeneration++
    }
}
