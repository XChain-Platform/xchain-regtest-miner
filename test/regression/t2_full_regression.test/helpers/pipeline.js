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
 * T2 Regression Tests: Full Regression (E2E)
 *
 * End-to-end regression tests against a StatefulMockNode that simulates
 * a real Bitcoin Core regtest node. Validates the complete pipeline:
 * wallet lifecycle, mempool monitoring, block generation, and API
 * interactions with real (but fast) async behavior.
 *
 * Target runtime: < 10 minutes
 * Trigger: nightly; before releases; after dependency upgrades
 */

const sinon = require('sinon')
const StatefulMockNode = require('../../../e2e/helpers/StatefulMockNode')

const state = {
    completed: 0,
    node: null,
    registered: 0,
}

function registerFile() {
    state.registered++
}

async function start() {
    if (state.node) return state.node
    state.node = new StatefulMockNode()
    await state.node.start()
    sinon.stub(console, 'log')
    sinon.stub(console, 'error')
    return state.node
}

async function finish() {
    state.completed++
    if (state.completed !== state.registered) return
    sinon.restore()
    await state.node.stop()
    state.node = null
}

module.exports = { finish, registerFile, start }
