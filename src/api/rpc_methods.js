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
 *********************************************************************/

function createObservabilityMethods(miner, health) {
    return {
        async ping() {
            // ready reflects wallet preparation (mine-readiness), not just that the port is
            // listening: start() runs prepareWallet() detached, so a cold start after a reset
            // can answer ping before walletAddress is set. Callers that mine should gate on ready.
            return {status:"success", ready: !!miner.walletReady};
        },

        // Return current loop state so operators and CI can distinguish
        // idle-healthy from stuck-retrying without watching stdout.
        async status() {
            return miner.getStatus()
        },

        health
    }
}

function createTransactionMethods(miner) {
    return {
        async send_funds({address, amount}) {
            let txid = null

            try {
                txid = await miner.sendFundsToAddress(address, amount)
            } catch(err){
                return {"error":"There was a problem sending funds: " + (err && err.message ? err.message : err)}
            }

            return txid
        },

        // Fills the mempool with tx_quantity randomly created transactions; this
        // stops automatic mining until continue_mining is called.
        async fill_mempool({tx_quantity}) {
            try {
                await miner.fillMempool(tx_quantity)
            } catch(err){
                return {"error":"There was a problem trying to fill the mempool: " + (err && err.message ? err.message : err)}
            }

            return "ok"
        }
    }
}

function createMiningControlMethods(miner) {
    return {
        // Stop the auto-mine loop from firing further blocks. Any block already
        // in flight at the moment of the call completes normally. Use
        // continue_mining to resume.
        async pause_mining({} = {}) {
            try {
                await miner.pauseMining()
            } catch(err){
                return {"error":"There was a problem trying to pause the mining"}
            }

            return "ok"
        },

        async continue_mining({} = {}) {
            try {
                await miner.continueMining()
            } catch(err){
                return {"error":"There was a problem trying to continue the mining"}
            }

            return "ok"
        },

        async set_mining_time({max_time, tx_added_time}){
            try{
                await miner.setMiningTime(max_time, tx_added_time)
            } catch (err){
                return {"error": (err && err.message) ? err.message : "There was a problem trying to set a new time to mine blocks"}
            }

            return "ok"
        },

        async set_default_mining_time(){
            try{
                await miner.setDefaultMiningTime()
            } catch (err){
                return {"error":"There was a problem trying to set a the default time to mine blocks"}
            }

            return "ok"
        }
    }
}

function createTimeMethods(miner) {
    return {
        // Pin the node clock (params: {timestamp} unix seconds; 0 releases it) so
        // the next generate_blocks stamps its block at that time. Used by the
        // multi-chain parity harness to make time-based expiries (ORDER_EXPIRE)
        // fire at a deterministic, cross-chain-identical block. Refused on mainnet.
        async set_mock_time({timestamp}){
            try {
                await miner.setMockTime(timestamp)
                return "ok"
            } catch (err){
                return { "error": "There was a problem setting the mock time: " + (err && err.message ? err.message : err) }
            }
        },

        // Turn the mine-empty heartbeat on/off at runtime (params:
        // {interval_ms}; 0 disables). The one-shot sibling of generate_blocks:
        // use this when a drill must WAIT OUT a height-gated window (stake
        // ACTIVATION_DELAY_BLOCKS, confirmation depth) rather than jump it, and
        // no transactions are in flight to make the loop mine.
        async set_idle_mine_interval({interval_ms}){
            try {
                await miner.setIdleMineInterval(interval_ms)
                return "ok"
            } catch (err){
                return { "error": "There was a problem setting the idle mine interval: " + (err && err.message ? err.message : err) }
            }
        }
    }
}

function createBlockMethods(miner) {
    return {
        // Mine `count` empty blocks. Used by e2e tests to advance block height
        // past indexer time-locked states (e.g. STAKE ACTIVATION_DELAY_BLOCKS).
        // This mines them NOW; set_idle_mine_interval instead lets an idle chain
        // advance on its own schedule.
        async generate_blocks({count}){
            try {
                let hashes = await miner.generateBlocks(count)
                return { "count": hashes.length, "hashes": hashes }
            } catch (err){
                return { "error": "There was a problem generating blocks: " + (err && err.message ? err.message : err) }
            }
        },

        // Mark a block as invalid so the node rolls back to the fork point.
        // Auto-mining is paused; call continue_mining when the reorg is complete.
        // Enables deterministic reorg tests without dropping to raw node RPC.
        async invalidate_block({block_hash}) {
            try {
                await miner.invalidateBlock(block_hash)
                return "ok"
            } catch (err) {
                return { "error": "There was a problem invalidating the block: " + (err && err.message ? err.message : err) }
            }
        },

        // Remove a block from the invalid set so the node can re-evaluate chain
        // selection. Call after mining the competing branch, before continue_mining.
        async reconsider_block({block_hash}) {
            try {
                await miner.reconsiderBlock(block_hash)
                return "ok"
            } catch (err) {
                return { "error": "There was a problem reconsidering the block: " + (err && err.message ? err.message : err) }
            }
        }
    }
}

function createRpcMethods(miner, health) {
    return {
        ...createObservabilityMethods(miner, health),
        ...createTransactionMethods(miner),
        ...createMiningControlMethods(miner),
        ...createTimeMethods(miner),
        ...createBlockMethods(miner)
    }
}

module.exports = { createRpcMethods }
