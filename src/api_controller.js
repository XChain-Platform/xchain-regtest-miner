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

function createJsonRpcController(miner, { evaluateMinerHealth, uptime = process.uptime } = {}) {
    return {
        async ping() {
            return {status:"success", ready: !!miner.walletReady};
        },

        async status() {
            return miner.getStatus()
        },

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
        },

        async send_funds({address, amount}) {
            let txid = null

            try {
                txid = await miner.sendFundsToAddress(address, amount)
            } catch(err){
                return {"error":"There was a problem sending funds: " + (err && err.message ? err.message : err)}
            }

            return txid
        },

        async fill_mempool({tx_quantity}) {
            try {
                await miner.fillMempool(tx_quantity)
            } catch(err){
                return {"error":"There was a problem trying to fill the mempool: " + (err && err.message ? err.message : err)}
            }

            return "ok"
        },

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
        },

        async set_mock_time({timestamp}){
            try {
                await miner.setMockTime(timestamp)
                return "ok"
            } catch (err){
                return { "error": "There was a problem setting the mock time: " + (err && err.message ? err.message : err) }
            }
        },

        async set_idle_mine_interval({interval_ms}){
            try {
                await miner.setIdleMineInterval(interval_ms)
                return "ok"
            } catch (err){
                return { "error": "There was a problem setting the idle mine interval: " + (err && err.message ? err.message : err) }
            }
        },

        async generate_blocks({count}){
            try {
                const hashes = await miner.generateBlocks(count)
                return { "count": hashes.length, "hashes": hashes }
            } catch (err){
                return { "error": "There was a problem generating blocks: " + (err && err.message ? err.message : err) }
            }
        },

        async invalidate_block({block_hash}) {
            try {
                await miner.invalidateBlock(block_hash)
                return "ok"
            } catch (err) {
                return { "error": "There was a problem invalidating the block: " + (err && err.message ? err.message : err) }
            }
        },

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

module.exports = createJsonRpcController
