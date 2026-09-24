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

// Decides healthy vs stalled from a getStatus() payload plus process uptime.
// Pure and exported so the policy is unit-testable without a node or a server.
// `ping` stays pure liveness (it answers while the wallet is still warming); this
// is the readiness verdict the container healthcheck reads.
//
// Branch order is load-bearing and was wrong once. A pause-first ordering left the
// wallet check dead in production: the miner constructs with keepMining=false,
// start() awaits prepareWallet() BEFORE setting it true, and walletReady=true is
// prepareWallet's last statement, so every wallet-not-ready payload the real
// getStatus() can emit also carries mining_paused=true and answered healthy. A
// prepareWallet that hangs (wedged coin node, a wallet RPC that never returns) went
// undetected forever. mining_started is what separates the two states, so the pause
// shortcut is claimed only once the loop has actually run.
function evaluateMinerHealth({ status = {}, uptimeMs = 0,
                               errorThreshold = 5,
                               walletGraceMs = 60000 } = {}) {
    const consecutiveErrors = Number(status.consecutive_errors) || 0
    // Failed mines get their own streak because consecutive_errors cannot carry
    // them: the loop zeroes it on every successful getRawMempool(), which runs
    // immediately before the idle-mine heartbeat, so a generateToAddress failing
    // forever kept reporting 1 and this probe answered ok while height never moved.
    const mineFailures      = Number(status.mine_failures) || 0
    // Cold-start grace: nothing is a stall yet. This also swallows an error streak
    // inside the window, which costs nothing, because Docker's --start-period (kept
    // at the same 60s in the Dockerfile) already discards failing checks there.
    if (uptimeMs <= walletGraceMs) return { healthy: true, reason: 'starting' }
    // Past the grace window, a wallet that never became ready IS the stall this probe
    // exists for, and it outranks the pause shortcut because an unprepared miner
    // reports mining_paused=true as well.
    if (!status.wallet_ready) return { healthy: false, reason: 'wallet_not_ready' }
    // Wallet ready but the loop never entered (start() rejected between prepareWallet
    // and the loop): also a stall rather than a pause.
    if (status.mining_started !== true) return { healthy: false, reason: 'not_started' }
    // A pause is an operator action (fill_mempool, invalidate_block) that holds
    // keepMining=false until continue_mining; reporting it unhealthy would flap
    // every stack that pauses mining as part of a drill.
    if (status.mining_paused === true) return { healthy: true, reason: 'paused' }
    if (consecutiveErrors >= errorThreshold) return { healthy: false, reason: 'consecutive_errors' }
    // Same threshold, second streak. Kept below the pause shortcut on purpose: a
    // deliberate pause_mining / fill_mempool is never a stall whatever either
    // counter reads.
    if (mineFailures >= errorThreshold) return { healthy: false, reason: 'mine_failures' }
    return { healthy: true, reason: 'ok' }
}

function formatMinerHealth(status, verdict) {
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

module.exports = { evaluateMinerHealth, formatMinerHealth }
