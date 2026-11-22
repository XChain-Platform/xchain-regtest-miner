// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const assert = require('assert');
const sinon = require('sinon');
const XChainRegtestMiner = require('../../../src/XChainRegtestMiner');

function parkedPromise() {
    let release;
    const promise = new Promise((resolve) => {
        release = resolve;
    });
    return { promise, release };
}

describe('startup wallet warmup pause barrier @regression', function () {
    afterEach(function () {
        sinon.restore();
    });

    it('does not mine after a pause acknowledged during the startup balance read', async function () {
        const miner = new XChainRegtestMiner('dogecoin-regtest', 'localhost', '18332', 'user', 'pass');
        const balanceRead = parkedPromise();
        let balanceCalls = 0;
        miner._startupOperatorGeneration = miner._operatorMiningGeneration;
        miner.connector.getNewAddress = sinon.stub().resolves('doge-address');
        miner.connector.getWalletInfo = sinon.stub().rejects(new Error('method unavailable'));
        miner.connector.getBalance = sinon.stub().callsFake(async () => {
            balanceCalls++;
            if (balanceCalls === 1) return balanceRead.promise;
            return balanceCalls === 2 ? 0 : 1;
        });
        miner.connector.generateToAddress = sinon.stub().resolves(Array(101).fill('hash'));
        sinon.stub(miner, 'pinFundingFeeRate').resolves('none');
        const loadWallet = sinon.stub(miner, 'ensureWalletLoaded').rejects(new Error('must not reload'));

        const preparation = miner.prepareWallet();
        while (balanceCalls === 0) await new Promise((resolve) => setImmediate(resolve));
        await miner.pauseMining();
        balanceRead.release(0);
        await preparation;

        assert.strictEqual(miner.connector.generateToAddress.called, false);
        assert.strictEqual(miner._walletWarmupPending, true);
        assert.strictEqual(miner.walletReady, false);

        await miner.continueMining();
        const recovery = await miner.reloadWallet();
        assert.strictEqual(recovery.ok, true);
        assert.strictEqual(miner.connector.generateToAddress.calledOnceWithExactly(101, 'doge-address'), true);
        assert.strictEqual(loadWallet.called, false);
        assert.strictEqual(miner.walletReady, true);
    });
});
