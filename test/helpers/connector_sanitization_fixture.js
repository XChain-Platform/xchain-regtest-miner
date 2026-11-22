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
 * Shared fixtures for the connector credential-sanitization suites: a
 * connector built against a stubbed axios, a console that records what it is
 * asked to print, and the assertions that no credential reached an error or
 * the console. The live connector and stub sit on `state`, replaced before
 * each test.
 */
'use strict';

const assert = require('assert');
const sinon = require('sinon');
const axios = require('axios');
const BlockchainConnector = require('../../src/rpc/blockchain_connector');

const state = {};
const RPC_USER = 'admin';
const RPC_PASS = 'sup3rs3cret';
const RPC_HOST = '10.0.0.5';
const RPC_PORT = '18332';
function setupConnector() {
    state.connector = new BlockchainConnector(RPC_HOST, RPC_PORT, RPC_USER, RPC_PASS);
    state.axiosPostStub = sinon.stub(axios, 'post');
    sinon.stub(state.connector, 'sleep').resolves();
    sinon.stub(console, 'error');
    sinon.stub(console, 'log');
    sinon.stub(console, 'warn');
}
function teardownConnector() {
    sinon.restore();
}
function makeAxiosError(message) {
    const err = new Error(message);
    err.config = {
        url: 'http://' + RPC_HOST + ':' + RPC_PORT,
        auth: { username: RPC_USER, password: RPC_PASS },
        data: '{"jsonrpc":"2.0","method":"sendtoaddress"}',
    };
    err.response = { status: 500, data: { error: { code: -1, message: 'Internal error' } } };
    return err;
}
// Helper to assert an error has no credential leaks
function assertCleanError(err, expectedMessage) {
    // Error message should be a clean generic message
    assert.strictEqual(err.message, expectedMessage);
    // Error object must NOT carry axios config with credentials
    assert.strictEqual(err.config, undefined, 'Error object carries .config (potential credential leak)');
    assert.ok(!err.message.includes(RPC_PASS), 'Error message contains password');
    assert.ok(!err.message.includes(RPC_USER), 'Error message contains username');
    assert.ok(!err.message.includes(RPC_HOST), 'Error message contains host');
}
// Helper to assert no console output contains credentials
function assertConsoleClean() {
    for (const call of [...console.error.getCalls(), ...console.log.getCalls(), ...console.warn.getCalls()]) {
        for (const arg of call.args) {
            const str =
                typeof arg === 'string'
                    ? arg
                    : typeof arg === 'object' && arg !== null
                      ? JSON.stringify(arg)
                      : String(arg);
            assert.ok(!str.includes(RPC_PASS), 'Console output contains password');
            assert.ok(!str.includes(RPC_USER), 'Console output contains username');
        }
    }
}
function useConnectorFixtures() {
    beforeEach(setupConnector);
    afterEach(teardownConnector);
}

// Fails the next RPC the way a dead node would, then asserts `call` rejects with the clean
// `expectedMessage` and an error object that carries no credentials.
async function expectCleanRejection(call, expectedMessage) {
    state.axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'));
    try {
        await call();
        assert.fail('should throw');
    } catch (err) {
        assertCleanError(err, expectedMessage);
    }
}

// Fails the next RPC the way a dead node would, swallows the rejection from `call`, then
// asserts the console output carries no credentials.
async function expectNoCredentialLogging(call) {
    state.axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'));
    try {
        await call();
    } catch (e) {}
    assertConsoleClean();
}

module.exports = {
    state,
    useConnectorFixtures,
    makeAxiosError,
    assertConsoleClean,
    expectCleanRejection,
    expectNoCredentialLogging,
};
