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
 * test/unit/rpc/wallet_rpc_send_data.test.js
 *
 * Pins the sendtoaddress request body: positional params without a fee
 * rate, named params with one, and never a verbose argument.
 *
 ********************************************************************/

const assert = require('assert');
const { buildSendToAddressData } = require('../../../src/rpc/blockchain_connector/wallet_rpc.js');

describe('buildSendToAddressData', function () {
    it('sends positional [address, amount] when no fee rate is given', function () {
        assert.deepStrictEqual(buildSendToAddressData('addr1', 1.5), {
            jsonrpc: '2.0', method: 'sendtoaddress', params: ['addr1', 1.5], id: 1,
        });
    });

    it('sends named params with fee_rate for a positive finite rate', function () {
        assert.deepStrictEqual(buildSendToAddressData('addr1', 1.5, 12), {
            jsonrpc: '2.0', method: 'sendtoaddress', params: { address: 'addr1', amount: 1.5, fee_rate: 12 }, id: 1,
        });
    });

    it('falls back to positional for null, zero, negative, NaN, Infinity and non-number rates', function () {
        for (const rate of [null, undefined, 0, -1, NaN, Infinity, '5']) {
            const { params } = buildSendToAddressData('a', 2, rate);
            assert.deepStrictEqual(params, ['a', 2], `rate ${String(rate)}`);
        }
    });

    it('never includes a verbose parameter', function () {
        for (const rate of [undefined, 3]) {
            const { params } = buildSendToAddressData('a', 2, rate);
            assert.ok(!Object.keys(params).includes('verbose'));
            assert.ok(!Array.isArray(params) || params.length === 2);
        }
    });
});
