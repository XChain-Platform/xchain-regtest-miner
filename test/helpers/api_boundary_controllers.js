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
 * Controllers for the API input-validation boundary suites: each mirrors the
 * api.js error mapping of one JSON-RPC method over a stubbed miner, which it
 * exposes as `_miner` so a test can arrange and inspect the stub.
 */
'use strict';

const sinon = require('sinon');

function createFillMempoolController() {
    const minerStub = {
        fillMempool: sinon.stub(),
    };

    return {
        async fill_mempool({ tx_quantity }) {
            try {
                await minerStub.fillMempool(tx_quantity);
            } catch (err) {
                return { error: 'There was a problem trying to fill mempool with ' + tx_quantity + ' transactions' };
            }
            return { result: 'ok' };
        },
        _miner: minerStub,
    };
}

function createSendFundsController() {
    const minerStub = {
        sendFundsToAddress: sinon.stub(),
    };

    return {
        async send_funds({ address, amount }) {
            let txid = null;
            try {
                txid = await minerStub.sendFundsToAddress(address, amount);
            } catch (err) {
                return { error: 'There was a problem sending ' + amount + ' to ' + address };
            }
            return txid;
        },
        _miner: minerStub,
    };
}

function createMiningTimeController() {
    const minerStub = {
        setMiningTime: sinon.stub().resolves(),
    };

    return {
        async set_mining_time({ max_time, tx_added_time }) {
            try {
                await minerStub.setMiningTime(max_time, tx_added_time);
            } catch (err) {
                return { error: 'There was a problem trying to set a new time to mine blocks' };
            }
            return { result: 'ok' };
        },
        _miner: minerStub,
    };
}

module.exports = { createFillMempoolController, createSendFundsController, createMiningTimeController };
