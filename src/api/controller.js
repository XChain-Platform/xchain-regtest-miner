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

// Group observation methods around one status source so liveness, readiness, and
// operator diagnostics describe the same miner state. Keeping this boundary small
// also lets tests supply a deterministic clock without starting the HTTP server.
function createHealthMethods(miner, evaluateMinerHealth, uptime) {
    return {
        // Expose process liveness while reporting wallet readiness separately because
        // the port can accept requests before wallet preparation finishes. Mining
        // clients should wait for ready rather than treating any response as usable.
        async ping() {
            return {status:"success", ready: !!miner.walletReady};
        },

        // Report the complete loop snapshot for operators who must distinguish a quiet
        // mempool from a miner that is retrying or deliberately paused. Returning the
        // miner payload directly keeps this diagnostic aligned with internal state.
        async status() {
            return miner.getStatus()
        },

        // Convert the readiness policy into HTTP status as well as a JSON result so
        // container probes can detect a stalled miner. Ping remains available during
        // startup while this stricter method can signal that intervention is needed.
        async health(params, {res}) {
            const status = miner.getStatus()
            const verdict = evaluateMinerHealth({ status, uptimeMs: uptime() * 1000 })
            if (!verdict.healthy) res.status(503)
            return {
                status: verdict.healthy ? 'success' : 'degraded',
                reason: verdict.reason,
                wallet_ready: !!status.wallet_ready,
                consecutive_errors: status.consecutive_errors,
                mine_failures: status.mine_failures,
                mining_paused: !!status.mining_paused,
                mining_started: !!status.mining_started
            }
        }
    }
}

// Group methods that create transactions because both spend wallet resources and
// surface miner failures as stable JSON results. This keeps transport concerns out
// of wallet and mempool code while preserving useful failure messages for callers.
function createTransactionMethods(miner) {
    return {
        // Forward validated transfer work to the miner so address rules, amount rules,
        // and node errors remain owned by the wallet layer. Preserve the exact failure
        // message because test orchestration uses it to diagnose rejected funding.
        async send_funds({address, amount}) {
            let txid = null

            try {
                txid = await miner.sendFundsToAddress(address, amount)
            } catch(err){
                return {"error":"There was a problem sending funds: " + (err && err.message ? err.message : err)}
            }

            return txid
        },

        // Populate the mempool through the miner so its concurrency guard and mining
        // pause protect the transaction batch. Callers resume automatic mining later
        // when they want the prepared transactions included in a block.
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

// Group automatic mining controls so scheduling changes share the same success and
// error contract. The miner owns validation and synchronization because controller
// level checks could drift from the actual loop constraints.
function createMiningControlMethods(miner) {
    return {
        // Pause through the miner barrier so a block already being generated settles
        // before this request reports success. That guarantee lets height sensitive
        // tests begin their controlled section from a stable chain tip.
        async pause_mining({} = {}) {
            try {
                await miner.pauseMining()
            } catch(err){
                return {"error":"There was a problem trying to pause the mining"}
            }

            return "ok"
        },

        // Resume the automatic loop after a deliberate pause or mempool fill. Keeping
        // this action explicit prevents a preparation request from unexpectedly mining
        // the transactions it was asked only to stage.
        async continue_mining({} = {}) {
            try {
                await miner.continueMining()
            } catch(err){
                return {"error":"There was a problem trying to continue the mining"}
            }

            return "ok"
        },

        // Adjust both batch timers together because they describe complementary limits:
        // the longest wait for a block and the extension granted for arriving traffic.
        // Delegate range checks so every caller receives the miner's canonical rules.
        async set_mining_time({max_time, tx_added_time}){
            try{
                await miner.setMiningTime(max_time, tx_added_time)
            } catch (err){
                return {"error": (err && err.message) ? err.message : "There was a problem trying to set a new time to mine blocks"}
            }

            return "ok"
        },

        // Restore the service defaults after a test changes scheduling behavior. This
        // gives shared environments a simple cleanup operation and avoids requiring
        // callers to duplicate constants that can change between releases.
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

// Group time controls used by deterministic chain exercises. Both methods alter when
// blocks appear without bypassing the miner's safety checks, so scenarios remain
// reproducible while the production scheduling path still performs the work.
function createClockMethods(miner) {
    return {
        // Pin the node clock so the next generated block can exercise expiry rules at
        // a known Unix timestamp across several chains. Passing zero releases the mock,
        // and the miner refuses unsafe networks before forwarding the request.
        async set_mock_time({timestamp}){
            try {
                await miner.setMockTime(timestamp)
                return "ok"
            } catch (err){
                return { "error": "There was a problem setting the mock time: " + (err && err.message ? err.message : err) }
            }
        },

        // Control empty block production independently from transaction batch timing.
        // Tests use this heartbeat when they must wait through a height gated window
        // without manufacturing traffic merely to make the chain advance.
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

// Group explicit chain controls that advance height or construct a reorganization.
// Routing all three through the miner preserves its generation queue and pause barriers,
// which prevents operator requests from racing the automatic mining loop.
function createBlockMethods(miner) {
    return {
        // Mine a requested block batch immediately when a scenario must cross a height
        // threshold without waiting for the scheduler. Return every hash so callers can
        // anchor later assertions to the exact blocks that were created.
        async generate_blocks({count}){
            try {
                const hashes = await miner.generateBlocks(count)
                return { "count": hashes.length, "hashes": hashes }
            } catch (err){
                return { "error": "There was a problem generating blocks: " + (err && err.message ? err.message : err) }
            }
        },

        // Invalidate a chosen block to roll the node back to its fork point for a
        // deterministic reorganization exercise. The miner pauses first so automatic
        // generation cannot extend the branch while the competing history is prepared.
        async invalidate_block({block_hash}) {
            try {
                await miner.invalidateBlock(block_hash)
                return "ok"
            } catch (err) {
                return { "error": "There was a problem invalidating the block: " + (err && err.message ? err.message : err) }
            }
        },

        // Reconsider an invalidated block after the competing branch is ready.
        // The node can then select its best chain while mining remains paused, leaving
        // the caller in control of when ordinary block production resumes.
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

// Assemble focused method groups into the flat map required by the JSON RPC router.
// Supplying the health policy and clock at this boundary keeps production behavior
// intact while unit tests can exercise every handler without live infrastructure.
function createJsonRpcController(miner, { evaluateMinerHealth, uptime = process.uptime } = {}) {
    return {
        ...createHealthMethods(miner, evaluateMinerHealth, uptime),
        ...createTransactionMethods(miner),
        ...createMiningControlMethods(miner),
        ...createClockMethods(miner),
        ...createBlockMethods(miner)
    }
}

module.exports = createJsonRpcController
