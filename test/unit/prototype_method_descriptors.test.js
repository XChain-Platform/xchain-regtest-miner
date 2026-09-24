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
 * XChainRegtestMiner and BlockchainConnector are each split into part
 * modules whose methods are put back on the prototype by a repository-local
 * installMethods helper (defined in each file next to its own install call).
 * Object.assign would have made the moved methods enumerable, so for...in
 * over an instance and Object.keys of the prototype would have started
 * listing them. This pins the prototype descriptor rows read from the split
 * tree, so a future part module can never move the surface back to
 * enumerable.
 *
 ********************************************************************/

const assert = require('assert');
const XChainRegtestMiner = require('../../src/XChainRegtestMiner.js');
const BlockchainConnector = require('../../src/rpc/blockchain_connector.js');

// [key, enumerable, writable, configurable, typeof, function length], sorted by key.
function row(obj, k) {
    const d = Object.getOwnPropertyDescriptor(obj, k);
    const v = d.value;
    return [k, d.enumerable, 'writable' in d ? d.writable : null, d.configurable,
        'value' in d ? (v === null ? 'null' : typeof v) : 'accessor', typeof v === 'function' ? v.length : null];
}

const MINER_PROTOTYPE_ROWS = [
    ["claimPause", false, true, true, "function", 0],
    ["constructor", false, true, true, "function", 5],
    ["continueMining", false, true, true, "function", 0],
    ["createWallet", false, true, true, "function", 1],
    ["ensureWalletLoaded", false, true, true, "function", 0],
    ["enterReorgMineHold", false, true, true, "function", 0],
    ["enterReorgPause", false, true, true, "function", 0],
    ["exitReorgMineHold", false, true, true, "function", 1],
    ["exitReorgPause", false, true, true, "function", 0],
    ["fillMempool", false, true, true, "function", 1],
    ["generateBlocks", false, true, true, "function", 1],
    ["generateBlocksQueued", false, true, true, "function", 1],
    ["generateBlocksRaw", false, true, true, "function", 1],
    ["getStatus", false, true, true, "function", 0],
    ["idleMineDue", false, true, true, "function", 2],
    ["invalidateBlock", false, true, true, "function", 1],
    ["mineWhenReorgIdle", false, true, true, "function", 2],
    ["pauseMining", false, true, true, "function", 0],
    ["pinFundingFeeRate", false, true, true, "function", 0],
    ["prepareWallet", false, true, true, "function", 0],
    ["reconsiderBlock", false, true, true, "function", 1],
    ["refreshWalletFunds", false, true, true, "function", 0],
    ["sendFundsToAddress", false, true, true, "function", 2],
    ["setDefaultMiningTime", false, true, true, "function", 0],
    ["setIdleMineInterval", false, true, true, "function", 1],
    ["setMiningTime", false, true, true, "function", 2],
    ["setMockTime", false, true, true, "function", 1],
    ["sleep", false, true, true, "function", 1],
    ["start", false, true, true, "function", 0],
    ["walletRefreshDue", false, true, true, "function", 1],
];

const CONNECTOR_PROTOTYPE_ROWS = [
    ["constructor", false, true, true, "function", 4],
    ["createWallet", false, true, true, "function", 1],
    ["generateToAddress", false, true, true, "function", 2],
    ["getBalance", false, true, true, "function", 0],
    ["getBlock", false, true, true, "function", 1],
    ["getBlockHash", false, true, true, "function", 1],
    ["getBlockchainInfo", false, true, true, "function", 0],
    ["getMempoolEntry", false, true, true, "function", 1],
    ["getNetworkInfo", false, true, true, "function", 0],
    ["getNewAddress", false, true, true, "function", 0],
    ["getRawMempool", false, true, true, "function", 0],
    ["getRawTransaction", false, true, true, "function", 1],
    ["getWalletInfo", false, true, true, "function", 0],
    ["invalidateBlock", false, true, true, "function", 1],
    ["loadWallet", false, true, true, "function", 1],
    ["reconsiderBlock", false, true, true, "function", 1],
    ["sendError", false, true, true, "function", 1],
    ["sendRawTransaction", false, true, true, "function", 1],
    ["sendToAddress", false, true, true, "function", 2],
    ["setMockTime", false, true, true, "function", 1],
    ["setTxFee", false, true, true, "function", 1],
    ["setWalletName", false, true, true, "function", 1],
    ["sleep", false, true, true, "function", 1],
    ["walletEndpoint", false, true, true, "function", 0],
];

describe('prototype method descriptors (split surface pin)', function () {

    describe('XChainRegtestMiner', function () {
        it('prototype descriptor rows match the unsplit class', function () {
            const rows = Object.getOwnPropertyNames(XChainRegtestMiner.prototype).sort().map((k) => row(XChainRegtestMiner.prototype, k));
            assert.deepStrictEqual(rows, MINER_PROTOTYPE_ROWS);
        });

        it('keeps every installed method non-enumerable and callable', function () {
            assert.deepStrictEqual(Object.keys(XChainRegtestMiner.prototype), []);
            const methods = MINER_PROTOTYPE_ROWS.filter(([k]) => k !== 'constructor').map(([k]) => k);
            assert.ok(methods.length > 1, 'the prototype has methods to check');
            for (const k of methods) {
                assert.strictEqual(typeof XChainRegtestMiner.prototype[k], 'function', `${k} is callable`);
            }
        });

        it('a constructed miner has no enumerable prototype key in its for...in view', function () {
            const miner = new XChainRegtestMiner('regtest', 'localhost', 18443, 'user', 'pass');
            const seen = [];
            for (const k in miner) seen.push(k);
            assert.deepStrictEqual(seen, Object.keys(miner));
            assert.ok(miner instanceof XChainRegtestMiner);
        });
    });

    describe('BlockchainConnector', function () {
        it('prototype descriptor rows match the unsplit class', function () {
            const rows = Object.getOwnPropertyNames(BlockchainConnector.prototype).sort().map((k) => row(BlockchainConnector.prototype, k));
            assert.deepStrictEqual(rows, CONNECTOR_PROTOTYPE_ROWS);
        });

        it('keeps every installed method non-enumerable and callable', function () {
            assert.deepStrictEqual(Object.keys(BlockchainConnector.prototype), []);
            const methods = CONNECTOR_PROTOTYPE_ROWS.filter(([k]) => k !== 'constructor').map(([k]) => k);
            assert.ok(methods.length > 1, 'the prototype has methods to check');
            for (const k of methods) {
                assert.strictEqual(typeof BlockchainConnector.prototype[k], 'function', `${k} is callable`);
            }
        });

        it('a constructed connector has no enumerable prototype key in its for...in view', function () {
            const connector = new BlockchainConnector('localhost', 18443, 'user', 'pass');
            const seen = [];
            for (const k in connector) seen.push(k);
            assert.deepStrictEqual(seen, Object.keys(connector));
            assert.ok(connector instanceof BlockchainConnector);
        });
    });
});
