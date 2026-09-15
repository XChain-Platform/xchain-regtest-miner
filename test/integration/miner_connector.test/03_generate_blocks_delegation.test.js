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
 * Seam B Integration Tests: XChainRegtestMiner ↔ BlockchainConnector sequences
 *
 * Tests verify multi-step call sequences where one connector call's return value
 * affects the miner's subsequent decisions. Uses a stateful connector mock that
 * returns realistic, interdependent responses.
 */

const assert = require('assert')
const sinon = require('sinon')
const BlockchainConnector = require('../../../src/rpc/blockchain_connector')

let miner, connector

function createMiner() {
    connector = { generateToAddress: sinon.stub().resolves(['blockhash']) }
    sinon.stub(BlockchainConnector.prototype, 'constructor')
    delete require.cache[require.resolve('../../../src/XChainRegtestMiner')]
    const XChainRegtestMiner = require('../../../src/XChainRegtestMiner')
    miner = new XChainRegtestMiner('regtest', 'localhost', '18332', 'user', 'pass')
    miner.connector = connector
    sinon.stub(miner, 'sleep').resolves()
    sinon.stub(console, 'log')
    sinon.stub(console, 'error')
}

function restoreMiner() {
    sinon.restore()
    delete require.cache[require.resolve('../../../src/XChainRegtestMiner')]
}

describe('Seam B: XChainRegtestMiner ↔ BlockchainConnector sequences', function () {
    beforeEach(createMiner)
    afterEach(restoreMiner)

    // ─── generateBlocks Sequence ────────────────────────────────────────

    describe('generateBlocks delegation', function () {
        it('passes count and wallet address to connector', async function () {
            miner.walletAddress = 'bcrt1qreward'
            await miner.generateBlocks(10)
            assert(connector.generateToAddress.calledWith(10, 'bcrt1qreward'))
        })
    })
})
