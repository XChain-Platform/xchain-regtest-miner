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
 * XChain Regtest Miner - Miner Class
 * 
 * This file handles starting the regtest miner and mining blocks
 * 
 ********************************************************************/

const BlockchainConnector = require('./rpc/blockchain_connector.js')
const {
    DEFAULT_MAX_TIME_TO_MINE_TXS,
    DEFAULT_ADDED_TIME_TO_MINE_TXS
} = require('./XChainRegtestMiner/constants.js')
const miningSchedule = require('./XChainRegtestMiner/mining_schedule.js')
const mempoolFill = require('./XChainRegtestMiner/mempool_fill.js')
const reorgControl = require('./XChainRegtestMiner/reorg_control.js')
const walletSetup = require('./XChainRegtestMiner/wallet_setup.js')
const blockGeneration = require('./XChainRegtestMiner/block_generation.js')

// Idle mine-empty heartbeat, OFF by default (0). The auto-mine loop only ever
// mines when the mempool is non-empty, so a quiet chain never advances a block.
// Anything gated on HEIGHT rather than on transactions therefore stalls forever
// with nothing in flight to unstick it: capability-stake activation
// (ACTIVATION_DELAY_BLOCKS), confirmation depth, time-locked expiries. Drills hit
// this and had to drop to raw node `generatetoaddress`.
// With this set, the loop mines ONE empty block whenever the mempool has been
// empty for this long, so height advances on its own. Default stays 0 so no
// existing venue changes behavior: an empty block is still a real block that a
// reorg/depth test may be counting.
const DEFAULT_IDLE_MINE_INTERVAL_MS = 0 //0 = disabled; the auto-mine loop stays mempool-driven only

class XChainRegtestMiner {
    constructor(network, nodeUrl, nodePort, nodeUser, nodePassword) {
      this.network = network
      this.connector = new BlockchainConnector(nodeUrl, nodePort, nodeUser, nodePassword)
      this.walletNameParam = "xchain_regtest_wallet"
      // Per-call funding fee ceiling in sat/vB, chosen by _pinFundingFeeRate at
      // wallet preparation. Null means the ceiling is wallet-wide (settxfee) or
      // absent, and funding sends go out positionally as they always have.
      this.fundingFeeRateSatPerVb = null
      this.keepMining = false
      // Separates "never started" from "operator-paused". keepMining is false in both
      // states, so mining_paused alone cannot tell a wedged prepareWallet apart from a
      // deliberate pause_mining, and a health probe that treats a pause as healthy
      // then certifies a miner that never mined a block. start() sets
      // this true at the same point it sets keepMining, after prepareWallet resolves.
      this.miningStarted = false
      this.maxTimeToMineTxs = DEFAULT_MAX_TIME_TO_MINE_TXS
      this.addedTimeToMineTxs = DEFAULT_ADDED_TIME_TO_MINE_TXS
      this.idleMineIntervalMs = DEFAULT_IDLE_MINE_INTERVAL_MS
      this.fillMempoolRunning = false
      // Bumped by EVERY keepMining mutation, so a caller that paused can tell its
      // own pause from a later one. reconsiderBlock restores the prior mining
      // state in a finally, and without this a pause_mining landing inside its
      // awaited window was told "ok" and then silently overridden, resuming the
      // auto-mine loop under an operator who believed the miner was paused. A new
      // mutation site MUST bump this or it reopens that override.
      this._miningStateGeneration = 0
      // Ownership of the reorg pause reconsiderBlock restores from. The guard
      // above cannot be "any generation change since my snapshot": reconsiderBlock
      // is itself a keepMining writer and a generation bumper, so a SECOND
      // reconsider_block (api.js exposes it with no queue) bumps past the first's
      // snapshot and both then decline to restore, leaving the miner silently
      // stalled with nobody left to call continueMining().
      //
      // So the reorg pause is refcounted and shared instead. Concurrent
      // reconsiders inherit one record of "was auto-mining live before the reorg
      // started" plus the generation the LAST reorg pause claimed; only a
      // generation the reorg pause did not claim (an operator pause_mining /
      // continue_mining, fillMempool, the loop starting) counts as a foreign
      // mutation that cancels the restore. The last reconsider out is the one that
      // restores.
      this._reorgPauseDepth = 0
      this._reorgPauseWasMining = false
      this._reorgPauseGeneration = 0
      this._generateQueue = Promise.resolve()
      // Mine-vs-reorg exclusion. _generateQueue serializes MINES against each
      // other, and pauseMining()/the bare "await this._generateQueue" only DRAIN
      // it: the queue is settled the instant that await resolves, so a
      // generate_blocks RPC (api.js exposes it with no keepMining gate) arriving
      // while invalidateBlock/reconsiderBlock was parked on its node call ran a
      // generatetoaddress straight into the node's chain re-evaluation. Each reorg
      // primitive raises a hold here instead, keyed by id because api.js
      // exposes both reorg verbs unqueued so several can be in flight at once.
      //
      // The ordering rule, which is what keeps this from deadlocking: a reorg
      // captures the mine queue tail AFTER raising its hold, so it waits only for
      // mines appended BEFORE it, and generateBlocks snapshots the holds active at
      // APPEND time, so a mine waits only for reorgs raised before it. Every
      // mine/reorg pair therefore has exactly one waiter. Gating a mine on a reorg
      // that is itself draining that same mine is the deadlock this avoids.
      this._reorgMineHoldSeq = 0
      this._reorgMineHolds = new Map()
      this.walletReady = false
      // Last observed spendable balance, exported by status as wallet_balance.
      // null means "never read, or the last read failed" and is deliberately
      // distinct from an observed 0, so neither reads as funded.
      this.balance = null
      // Epoch ms of the last balance READ ATTEMPT (not the last successful one),
      // exported as wallet_balance_at so a drill can tell a fresh reading from a
      // never-refreshed one. null until prepareWallet has read a balance.
      this._balanceReadAt = null
      this._mempoolSize = 0
      this._blocksMined = 0
      this._lastMineAt = null
      this._consecutiveErrors = 0
      // Failed block generations in a row, counted SEPARATELY from the RPC/mempool
      // read streak above. One shared counter cross-cancelled: the loop zeroes it on
      // every successful getRawMempool(), which runs immediately before the idle-mine
      // heartbeat, so a generateToAddress that fails forever could never push it past
      // 1 and the health probe stayed green while block height never advanced. Only a
      // successful mine PERFORMED BY THE LOOP clears this one, so an operator
      // generate_blocks call cannot mask a broken loop.
      this._mineFailures = 0
    }
}

Object.assign(XChainRegtestMiner.prototype, miningSchedule, mempoolFill, reorgControl, walletSetup, blockGeneration)

module.exports = XChainRegtestMiner