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
 */

const assert = require('assert')
const axios = require('axios')
const StatefulMockNode = require('./helpers/StatefulMockNode')

const WALLET_URI = '/wallet/xchain_regtest_wallet'

async function withNode(daemon, fn) {
    const node = new StatefulMockNode({ daemon })
    await node.start()
    try {
        return await fn(node)
    } finally {
        await node.stop()
    }
}

async function routedSettxfee(node, body) {
    const request = { method: 'settxfee', params: [0.001], id: 9, ...body }
    const res = await axios.post(`http://127.0.0.1:${node.port}${WALLET_URI}`, request, { validateStatus: () => true })
    return { status: res.status, body: res.data }
}

describe('E2E: StatefulMockNode routed settxfee contract', function () {
    it('answers a routed settxfee to an unloaded wallet with -32601 in core31 mode', async function () {
        await withNode('core31', async node => {
            node.addWalletFile('xchain_regtest_wallet', { loaded: false })
            const declared = await routedSettxfee(node, { jsonrpc: '2.0' })
            assert.strictEqual(declared.status, 200)
            assert.strictEqual(declared.body.error.code, -32601)
            const undeclared = await routedSettxfee(node, {})
            assert.strictEqual(undeclared.status, 404)
            assert.strictEqual(undeclared.body.error.code, -32601)
        })
    })

    it('answers a routed settxfee to a wallet that does not exist with -32601 in core31 mode', async function () {
        await withNode('core31', async node => {
            const reply = await routedSettxfee(node, { jsonrpc: '2.0' })
            assert.strictEqual(reply.body.error.code, -32601)
        })
    })

    it('answers a routed settxfee to a loaded wallet with -32601 in core31 mode', async function () {
        await withNode('core31', async node => {
            node.addWalletFile('xchain_regtest_wallet', { loaded: true })
            const reply = await routedSettxfee(node, { jsonrpc: '2.0' })
            assert.strictEqual(reply.body.error.code, -32601)
        })
    })

    it('still answers a routed settxfee to an unloaded wallet with -18 in legacy mode', async function () {
        await withNode('legacy', async node => {
            node.addWalletFile('xchain_regtest_wallet', { loaded: false })
            const reply = await routedSettxfee(node, { jsonrpc: '2.0' })
            assert.strictEqual(reply.status, 500)
            assert.strictEqual(reply.body.error.code, -18)
        })
    })
})
