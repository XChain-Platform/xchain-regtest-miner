/*********************************************************************
 *
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC – https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available —
 * contact legal@dankest.llc.
 *
 **********************************************************************
 * Chaos Tests — CE-04: Invalid RPC Responses, CE-10: Auth Failure
 *
 * CE-04: Tests miner behavior when RPC returns unexpected data shapes.
 *        Documents W-1: string.length treated as tx count (silent logic error).
 * CE-10: Tests mining loop behavior when RPC credentials become invalid.
 */

const assert = require('assert')
const sinon = require('sinon')
const ChaosNode = require('./helpers/ChaosNode')
const { createMiner, seedWallet, startMinerLoop, stopMinerLoop, waitFor, sleep } = require('./helpers/chaosSetup')

describe('Chaos: RPC Response Corruption & Auth Failure', function () {
    let node

    before(async function () {
        node = new ChaosNode()
        await node.start()
        sinon.stub(console, 'log')
        sinon.stub(console, 'error')
    })

    after(async function () {
        sinon.restore()
        await node.stop()
    })

    beforeEach(function () {
        node.reset()
        seedWallet(node)
    })

    // ─── CE-04: Invalid RPC Responses ───────────────────────────────

    describe('CE-04: RPC Returns Unexpected Data Shapes', function () {

        it('CE-04a: string result is rejected by Array.isArray check — W-1 fixed', async function () {
            const miner = createMiner(node)
            miner.maxTimeToMineTxs = 300
            miner.addedTimeToMineTxs = 80

            // Corrupt getrawmempool to return a string instead of an array.
            // After W-1 fix: the connector uses Array.isArray() validation,
            // so a string is rejected and throws. The mining loop catches it
            // and no phantom mining occurs.
            node.corruptResponse('getrawmempool', () => 'not_an_array')

            const heightBefore = node.height
            const { startPromise } = startMinerLoop(miner)
            await waitFor(() => miner.keepMining === true)

            // Wait several poll cycles — no mining should happen
            await sleep(400)

            assert.strictEqual(node.height, heightBefore,
                'W-1 fixed: String response should not trigger phantom mining')

            // Loop is still alive
            assert.strictEqual(miner.keepMining, true)

            node.clearCorruptors()
            await stopMinerLoop(miner, startPromise)
        })

        it('CE-04b: null result causes connector to throw; mining loop catches and continues', async function () {
            const miner = createMiner(node)

            // Corrupt getrawmempool to return null.
            // The connector's `if (response.data.result)` is false for null,
            // so it throws 'Error getting raw mempool'. The mining loop catches this.
            node.corruptResponse('getrawmempool', () => null)

            const { startPromise } = startMinerLoop(miner)
            await waitFor(() => miner.keepMining === true)

            // Let several poll cycles fail
            await sleep(200)

            // Loop should still be running — errors are caught
            assert.strictEqual(miner.keepMining, true,
                'Mining loop should survive null mempool responses')

            // No blocks mined (null response never passes the mempool check)
            const mempoolCalls = node.callsFor('getrawmempool')
            assert.ok(mempoolCalls.length > 0, 'Mempool was polled despite null responses')

            node.clearCorruptors()
            await stopMinerLoop(miner, startPromise)
        })

        it('CE-04c: undefined result causes connector to throw; mining loop catches and continues', async function () {
            const miner = createMiner(node)

            node.corruptResponse('getrawmempool', () => undefined)

            const { startPromise } = startMinerLoop(miner)
            await waitFor(() => miner.keepMining === true)

            await sleep(200)

            assert.strictEqual(miner.keepMining, true,
                'Mining loop should survive undefined mempool responses')

            node.clearCorruptors()
            await stopMinerLoop(miner, startPromise)
        })

        it('CE-04d: HTML response body causes error caught by mining loop', async function () {
            const miner = createMiner(node)

            // Intercept getrawmempool to return raw HTML (simulates a proxy 502 page)
            node.interceptMethod('getrawmempool', (params, res, id) => {
                res.status(502).set('Content-Type', 'text/html').send(
                    '<html><body><h1>502 Bad Gateway</h1></body></html>'
                )
            })

            const { startPromise } = startMinerLoop(miner)
            await waitFor(() => miner.keepMining === true)

            await sleep(200)

            // Loop survives the parse error / non-JSON response
            assert.strictEqual(miner.keepMining, true,
                'Mining loop should survive HTML responses')

            node.clearInterceptors()
            await stopMinerLoop(miner, startPromise)
        })
    })

    // ─── CE-10: RPC Authentication Failure ──────────────────────────

    describe('CE-10: RPC Authentication Failure', function () {

        it('CE-10: auth failure mid-loop logs errors; mining resumes when auth restored', async function () {
            const miner = createMiner(node)
            miner.maxTimeToMineTxs = 300
            miner.addedTimeToMineTxs = 80

            const { startPromise } = startMinerLoop(miner)
            await waitFor(() => miner.keepMining === true)

            // Establish baseline
            const heightBefore = node.height
            node.injectMempoolTx('txid_ce10_baseline')
            await waitFor(() => node.height > heightBefore, 3000)
            const heightAfterBaseline = node.height

            // Change credentials — miner uses 'user'/'pass', node now requires 'admin'/'secret'
            node.setAuthRequired('admin', 'secret')

            // Let auth failures accumulate
            await sleep(200)

            // Loop still running but no blocks mined
            assert.strictEqual(miner.keepMining, true, 'Loop should survive auth failures')
            assert.strictEqual(node.height, heightAfterBaseline,
                'No blocks mined during auth failure')

            // Restore credentials (accept any auth again)
            node.clearAuthRequired()

            // Inject a new transaction
            node.injectMempoolTx('txid_ce10_recovery')

            // Mining should resume
            await waitFor(() => node.height > heightAfterBaseline, 3000)

            assert.ok(node.height > heightAfterBaseline,
                'Mining should resume after auth is restored')

            await stopMinerLoop(miner, startPromise)
        })
    })
})
