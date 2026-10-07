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
 * XChain Regtest Miner - Constants
 *
 * Mining, funding and retry tunables shared by the miner class and its
 * parts, plus the key factories and the logger those parts use.
 *
 ********************************************************************/

'use strict';

// CHECK_BLOCK_DELAY_MS controls how often the loop wakes to poll the mempool and
// check timers. It is intentionally much shorter than MIN_MINING_TIME (1000ms) so
// that the loop fires close to the timer deadline rather than up to 1× late. A 100ms
// poll adds only ~100ms worst-case overshoot instead of the 1000ms (100%) of a MIN_MINING_TIME poll.
const CHECK_BLOCK_DELAY_MS = 100 //100ms poll interval; decoupled from MIN_MINING_TIME
// Upper bound on how stale status.wallet_balance may be. The auto-mine loop wakes
// every CHECK_BLOCK_DELAY_MS, so this interval guard is load-bearing: without it
// the refresh would issue 10 getbalance RPCs a second per miner.
const WALLET_BALANCE_REFRESH_MS = 5000
const SATOSHI_UNIT = 100000000.0

const DEFAULT_MAX_TIME_TO_MINE_TXS = 30000 //max 30 seconds to mine a block after the first tx is found in the mempool
const DEFAULT_ADDED_TIME_TO_MINE_TXS = 5000 //5 seconds extra before mining a block every time a new tx appears in the mempool

const MAX_MINING_TIME = 3600000 //1 hour max for mining timers
const MIN_MINING_TIME = 1000 //1 second minimum for mining timers
const MAX_FILL_MEMPOOL_QUANTITY = 50000 //max number of transactions to fill the mempool with
const MAX_SEND_RETRIES = 50 //max retries for sending funds in fillMempool
const MAX_GENERATE_BLOCKS = 10000 //max blocks a single generateBlocks call may mine (see the cap note in block_generation.js)

// The funding-send fee ceiling, once per fee mechanism. Both are the SAME rate (0.001
// coins/kB = 100000 sat per 1000 vB = 100 sat/vB), so change them together. It is 100x
// the BTC/LTC default relayfee floor (0.00001/kB) but exactly AT Dogecoin's (0.001/kB), so
// never lower it: below a floor funding txs stop relaying, or settxfee refuses and the pin
// falls back to the fee estimate. Valueless on regtest; see pinFundingFeeRate (wallet_setup.js).
const FUNDING_FEE_RATE_COINS_PER_KB = 0.001
const FUNDING_FEE_RATE_SAT_PER_VB = 100

// Coins whose daemons still implement the wallet-wide settxfee RPC. Bitcoin is
// deliberately absent: Core 31 deleted settxfee, so BTC takes the per-call
// fee_rate path instead.
const SETTXFEE_COINS = ['litecoin', 'dogecoin']

// Coins whose daemons refuse the per-call fee_rate argument: Dogecoin v1.14's
// sendtoaddress has none and answers an unknown named param with -8. Litecoin is
// absent because LTC v0.21 is rebased on Core 0.21, which added fee_rate.
const FEE_RATE_REFUSING_COINS = ['dogecoin']

//This is useful only for filling the mempool
const { BIP32Factory } = require('bip32')
const ecc = require('tiny-secp256k1')
const bip32 = BIP32Factory(ecc)
const {ECPairFactory} = require('ecpair')
const { getLogger } = require('../observability/logger');
const logger = getLogger();
const ECPair = ECPairFactory(ecc)

module.exports = {
    CHECK_BLOCK_DELAY_MS,
    WALLET_BALANCE_REFRESH_MS,
    SATOSHI_UNIT,
    DEFAULT_MAX_TIME_TO_MINE_TXS,
    DEFAULT_ADDED_TIME_TO_MINE_TXS,
    MAX_MINING_TIME,
    MIN_MINING_TIME,
    MAX_FILL_MEMPOOL_QUANTITY,
    MAX_SEND_RETRIES,
    MAX_GENERATE_BLOCKS,
    FUNDING_FEE_RATE_COINS_PER_KB,
    FUNDING_FEE_RATE_SAT_PER_VB,
    SETTXFEE_COINS,
    FEE_RATE_REFUSING_COINS,
    bip32,
    logger,
    ECPair
}
