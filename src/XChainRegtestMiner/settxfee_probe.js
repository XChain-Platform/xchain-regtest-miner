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
 * XChain Regtest Miner - settxfee Probe
 *
 * Asks the daemon to pin the wallet-wide funding fee and classifies its
 * answer, so pinFundingFeeRate can pick the fee mechanism per coin.
 *
 ********************************************************************/

'use strict';

const { FUNDING_FEE_RATE_COINS_PER_KB } = require('./constants.js')

// settxfee answers the probe acts on (Bitcoin Core rpc/protocol.h).
const RPC_METHOD_NOT_FOUND = -32601
const RPC_IN_WARMUP = -28

// Bounds the retries of a settxfee that timed out, lost its transport or hit warmup.
const SETTXFEE_MAX_ATTEMPTS = 3
const SETTXFEE_RETRY_INTERVAL_MS = 2000

// Resolves true when pinned, 'missing' when settxfee does not exist, 'refused' when the
// daemon answered without pinning, and 'unreachable' for a timeout, transport or warmup
// failure that outlived its retries. Call with the miner as `this`. Never throws.
async function trySetTxFee(){
    for (let attempt = 1; attempt <= SETTXFEE_MAX_ATTEMPTS; attempt++) {
        let err
        try {
            return (await this.connector.setTxFee(FUNDING_FEE_RATE_COINS_PER_KB)) === true ? true : 'refused'
        } catch (caught) {
            err = caught || {}
        }
        if (err.rpcCode === RPC_METHOD_NOT_FOUND) return 'missing'
        // Any other code is the daemon refusing the value, which repeats on every try.
        const transient = err.timedOut || err.rpcCode == null || err.rpcCode === RPC_IN_WARMUP
        if (!transient) return 'refused'
        if (attempt < SETTXFEE_MAX_ATTEMPTS) await this.sleep(SETTXFEE_RETRY_INTERVAL_MS)
    }
    return 'unreachable'
}

module.exports = { trySetTxFee }
