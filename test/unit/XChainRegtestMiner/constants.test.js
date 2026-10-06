// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

'use strict'

// The funding fee pin is one rate written twice, and it sits exactly at
// Dogecoin's default relay floor. Nothing else checks either fact: the fee-pin
// e2e only proves the constant reaches settxfee, not that its value is safe, so a
// retune below a floor would pass every other suite and break funding sends.

const assert = require('assert')
const {
    FUNDING_FEE_RATE_COINS_PER_KB,
    FUNDING_FEE_RATE_SAT_PER_VB
} = require('../../../src/XChainRegtestMiner/constants')

// Each daemon's DEFAULT minrelaytxfee, in coins/kB. A venue config may lower its
// own, but the pin must clear the defaults so it relays on a stock daemon too.
const DEFAULT_RELAY_FLOOR_COINS_PER_KB = {
    bitcoin: 0.00001,
    litecoin: 0.00001,
    dogecoin: 0.001
}

describe('XChainRegtestMiner constants', function () {
    describe('the funding fee pin', function () {
        it('states the same rate in coins/kB and sat/vB', function () {
            // coins/kB x 1e8 sat/coin / 1000 vB/kB = sat/vB
            assert.strictEqual(Math.round(FUNDING_FEE_RATE_COINS_PER_KB * 100000), FUNDING_FEE_RATE_SAT_PER_VB,
                'change FUNDING_FEE_RATE_COINS_PER_KB and FUNDING_FEE_RATE_SAT_PER_VB together (constants.js)')
        })

        for (const [chain, floor] of Object.entries(DEFAULT_RELAY_FLOOR_COINS_PER_KB)) {
            it(`is at or above the ${chain} default relay floor`, function () {
                assert.ok(FUNDING_FEE_RATE_COINS_PER_KB >= floor,
                    `the pin ${FUNDING_FEE_RATE_COINS_PER_KB}/kB is below the ${chain} relay floor ${floor}/kB; ` +
                    'see the comment on FUNDING_FEE_RATE_COINS_PER_KB in constants.js')
            })
        }
    })
})
