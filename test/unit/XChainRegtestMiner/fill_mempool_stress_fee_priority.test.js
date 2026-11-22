// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// fill_mempool's restore contract: once continue_mining resumes, the stress txs it
// broadcast must be minable in bulk, so the mempool drains in a few blocks. On
// Dogecoin 1.14 a tx that clears the relay floor but sits under the block-assembly
// minimum fee rate (0.01 DOGE/kB), or carries an output under the 0.01 DOGE soft dust
// limit, is mined only from the priority area, about one per block.
//
// Drives the real fillMempool end to end against a connector stub that builds real
// funding txs, then decodes every broadcast stress tx and measures its actual fee
// rate and output value.

const assert = require('assert');
const sinon = require('sinon');
const bitcoin = require('bitcoinjs-lib');

const BlockchainConnector = require('../../../src/rpc/blockchain_connector');
const CryptoNetworks = require('../../../src/networks/crypto_networks');

const SATOSHI_UNIT = 100000000;
// Dogecoin 1.14 block-assembly minimum fee rate, 0.01 DOGE per 1000 bytes.
const DOGE_BLOCK_MIN_FEE_PER_KB = 1000000;
// Dogecoin 1.14 soft dust limit, 0.01 DOGE.
const DOGE_SOFT_DUST = 1000000;

let XChainRegtestMiner;

// Runs fillMempool on the given NETWORK and returns every broadcast stress tx as
// { fee, size, outputValue }, with the fee measured from the spent split output.
async function runFill(networkName, txQuantity) {
    const net = CryptoNetworks.getBitcoinJsNetwork(networkName) || bitcoin.networks.regtest;
    const rawById = new Map();
    const broadcast = [];
    let fundingNonce = 0;

    const connector = {
        getRawMempool: sinon.stub().resolves([]),
        getRawTransaction: sinon.stub().callsFake(async (txid) => rawById.get(txid) || null),
        // The wallet's funding send: a real tx paying the requested amount to the main address.
        sendToAddress: sinon.stub().callsFake(async (address, amount) => {
            const tx = new bitcoin.Transaction();
            tx.version = 1;
            const prev = Buffer.alloc(32, 0);
            prev.writeUInt32LE(++fundingNonce, 0);
            tx.addInput(prev, 0);
            tx.addOutput(bitcoin.address.toOutputScript(address, net), Math.round(amount * SATOSHI_UNIT));
            rawById.set(tx.getId(), tx.toHex());
            return tx.getId();
        }),
        sendRawTransaction: sinon.stub().callsFake(async (hex) => {
            const id = bitcoin.Transaction.fromHex(hex).getId();
            rawById.set(id, hex);
            broadcast.push(hex);
            return id;
        }),
    };

    sinon.stub(BlockchainConnector.prototype, 'constructor');
    XChainRegtestMiner = require('../../../src/XChainRegtestMiner');
    const miner = new XChainRegtestMiner(networkName, '127.0.0.1', '18332', 'user', 'pass');
    miner.connector = connector;
    sinon.stub(miner, 'sleep').resolves();
    sinon.stub(miner, 'generateBlocksQueued').resolves([]);

    await miner.fillMempool(txQuantity);

    const stress = [];
    for (const hex of broadcast) {
        const tx = bitcoin.Transaction.fromHex(hex);
        if (tx.ins.length !== 1 || tx.outs.length !== 1) continue;
        const parentId = Buffer.from(tx.ins[0].hash).reverse().toString('hex');
        const parent = bitcoin.Transaction.fromHex(rawById.get(parentId));
        // A stress tx spends a split output; the split itself spends a funding tx.
        if (parent.outs.length !== txQuantity) continue;
        const inputValue = parent.outs[tx.ins[0].index].value;
        const outputValue = tx.outs[0].value;
        stress.push({ fee: inputValue - outputValue, size: hex.length / 2, outputValue });
    }
    return stress;
}

// Asserts a stress tx's fee rate reaches the Dogecoin block minimum and exceeds the fee that once stalled the drain.
function assertClearsDogeBlockMinimum(fee, size) {
    const feePerKb = (fee * 1000) / size;
    assert.ok(
        feePerKb >= DOGE_BLOCK_MIN_FEE_PER_KB,
        'stress tx pays ' +
            fee +
            ' koinu on ' +
            size +
            ' bytes (' +
            Math.round(feePerKb) +
            ' koinu/kB), below the 0.01 DOGE/kB block minimum: it would mine about one per block',
    );
    // Strictly above the old max(dustThreshold, 1000) fee that stalled the drain.
    assert.ok(fee > 100000, 'fee ' + fee + ' is not above the old 100000 koinu');
}

describe('fill_mempool stress txs clear the coin mining floor', function () {
    afterEach(function () {
        sinon.restore();
        delete require.cache[require.resolve('../../../src/XChainRegtestMiner')];
    });

    beforeEach(function () {
        sinon.stub(console, 'log');
        sinon.stub(console, 'error');
    });

    it('pays at least the Dogecoin block minimum fee rate on every stress tx', async function () {
        const stress = await runFill('dogecoin-regtest', 3);
        assert.strictEqual(stress.length, 3);
        for (const { fee, size } of stress) {
            assertClearsDogeBlockMinimum(fee, size);
        }
    });

    it('keeps every Dogecoin stress output at or above the soft dust limit', async function () {
        const stress = await runFill('dogecoin-regtest', 2);
        assert.strictEqual(stress.length, 2);
        for (const { outputValue } of stress) {
            assert.ok(
                outputValue >= DOGE_SOFT_DUST,
                'stress output ' + outputValue + ' koinu is under the 0.01 DOGE soft dust limit',
            );
        }
    });

    it('leaves Bitcoin, Litecoin and the bare-regtest fallback at their dust-scaled values', async function () {
        const cases = [
            ['regtest', 1000],
            ['bitcoin-regtest', 1000],
            ['litecoin-regtest', 5460],
        ];
        for (const [networkName, expected] of cases) {
            const stress = await runFill(networkName, 2);
            assert.strictEqual(stress.length, 2, networkName);
            for (const { fee, outputValue } of stress) {
                assert.strictEqual(fee, expected, networkName + ' fee');
                assert.strictEqual(outputValue, expected, networkName + ' output');
            }
            sinon.restore();
            sinon.stub(console, 'log');
            sinon.stub(console, 'error');
            delete require.cache[require.resolve('../../../src/XChainRegtestMiner')];
        }
    });
});
