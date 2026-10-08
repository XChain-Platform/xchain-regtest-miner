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
 * fillMempool keeps mining after the split until every split tx has left the
 * mempool, so no stress child spends an unconfirmed split output.
 */

const assert = require('assert')
const sinon = require('sinon')
const {
    MNEMONIC, MAIN_ADDRESS, createFundingTx, chunkFundingAmount, bitcoin, bip39,
} = require('./helpers/fixtures')

let miner, connectorStub, broadcast, minesAtBroadcast

// Builds a miner over real crypto whose node reports the given mempool per read.
function createMiner(mempoolReads) {
    sinon.stub(bip39, 'generateMnemonic').returns(MNEMONIC)
    sinon.stub(console, 'log')
    sinon.stub(console, 'error')
    const funding = createFundingTx(MAIN_ADDRESS, chunkFundingAmount(1, 0))
    broadcast = []
    minesAtBroadcast = []
    let reads = 0
    connectorStub = {
        sendToAddress: sinon.stub().resolves(funding.txid),
        generateToAddress: sinon.stub().resolves(['blockhash']),
        getRawTransaction: sinon.stub().callsFake(async (txid) => (txid === funding.txid ? funding.hex : null)),
        getRawMempool: sinon.stub().callsFake(async () => mempoolReads(reads++, broadcast[0])),
        sendRawTransaction: sinon.stub().callsFake(async (txHex) => {
            const txid = bitcoin.Transaction.fromHex(txHex).getId()
            broadcast.push(txid)
            minesAtBroadcast.push(connectorStub.generateToAddress.callCount)
            return txid
        }),
    }
    delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
    const XChainRegtestMiner = require('../../src/XChainRegtestMiner')
    miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
    miner.connector = connectorStub
    miner.walletAddress = 'bcrt1qreward'
    sinon.stub(miner, 'sleep').resolves()
}

function restoreMiner() {
    sinon.restore()
    delete require.cache[require.resolve('../../src/XChainRegtestMiner')]
}

describe('fillMempool confirms every split tx before the stress loop', function () {
    afterEach(restoreMiner)

    it('mines again while a split tx is still in the mempool', async function () {
        createMiner((read, splitTxid) => (read < 1 ? [splitTxid] : []))
        await miner.fillMempool(1)
        // One funding mine, then two post-split mines before the mempool cleared.
        assert.strictEqual(connectorStub.generateToAddress.callCount, 3)
        assert.strictEqual(broadcast.length, 2, 'one split tx and one stress tx')
        assert.strictEqual(minesAtBroadcast[1], 3, 'the stress tx waits for the split to confirm')
    })

    it('stops with a clear error when a split tx never confirms', async function () {
        createMiner((read, splitTxid) => [splitTxid])
        await assert.rejects(() => miner.fillMempool(1), /split transaction\(s\) still unconfirmed after 2 blocks/)
        assert.strictEqual(broadcast.length, 1, 'no stress tx is sent on an unconfirmed split')
        assert.strictEqual(miner.fillMempoolRunning, false)
    })

    it('ignores unrelated mempool txs and mines once after the split', async function () {
        createMiner(() => ['ab'.repeat(32)])
        await miner.fillMempool(1)
        assert.strictEqual(connectorStub.generateToAddress.callCount, 2)
        assert.strictEqual(broadcast.length, 2)
    })
})
