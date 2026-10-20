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
 * Shared fixtures for the RPC boundary suites: a connector built against a
 * stubbed axios and the two RPC reply shapes the suites feed it. The live
 * connector and stub sit on `state`, replaced before each test.
 */
'use strict'

const sinon = require('sinon')
const axios = require('axios')
const BlockchainConnector = require('../../src/rpc/blockchain_connector')

const state = {}

function setupConnector() {
    state.connector = new BlockchainConnector('localhost', '18332', 'rpcuser', 'rpcpass')
    state.axiosPostStub = sinon.stub(axios, 'post')
    sinon.stub(state.connector, 'sleep').resolves()
    sinon.stub(console, 'error')
    sinon.stub(console, 'log')
}
function teardownConnector() {
    sinon.restore()
}
function registerConnectorHooks() {
    beforeEach(setupConnector)
    afterEach(teardownConnector)
}
function rpcSuccess(result) {
    return { data: { result, error: null, id: 1 } }
}

function rpcNoResult() {
    return { data: { result: null, error: { code: -1, message: 'fail' }, id: 1 } }
}

module.exports = { state, registerConnectorHooks, rpcSuccess, rpcNoResult }
