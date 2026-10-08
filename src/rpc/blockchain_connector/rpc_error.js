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
 **********************************************************************/

/**
 * The daemon's own JSON-RPC error message carried by a REJECTED axios call,
 * or null when the rejection carries none.
 *
 * Daemons that predate JSON-RPC 2.0 (LTC v0.21, DOGE v1.14) answer an RPC
 * error with HTTP 500 (404 for an unknown method), so axios rejects and the
 * error body arrives on `error.response.data`, never on a resolved response.
 * A transport failure has no response, and a 401 carries a non-JSON body;
 * both yield null. Never throws.
 *
 * @param {*} error what an axios call rejected with
 * @returns {string|null}
 */
function rejectedRpcErrorMessage(error) {
    const body = error && error.response ? error.response.data : null
    if (!body || typeof body !== 'object') return null
    const rpcErr = body.error
    if (!rpcErr) return null
    if (typeof rpcErr.message === 'string') return rpcErr.message
    return JSON.stringify(rpcErr)
}

/**
 * The daemon's numeric JSON-RPC error code in a response body, or null when the
 * body carries none. Read `response.data` for a resolved call (Core 28+ answers
 * errors with HTTP 200) and `error.response.data` for a rejected one. Never throws.
 *
 * @param {*} body a JSON-RPC response body
 * @returns {number|null}
 */
function rpcErrorCode(body) {
    if (!body || typeof body !== 'object' || !body.error) return null
    const code = body.error.code
    return Number.isInteger(code) ? code : null
}

/**
 * Whether a node's RPC error message says the miner's wallet is not loaded:
 * "Requested wallet does not exist or is not loaded" on a /wallet/<name> URI, or
 * "No wallet is loaded" on the base URL, which is what every wallet call gets
 * after the node restarts under a long-running miner. Never throws.
 *
 * @param {*} nodeErr the node's error message, or null when it sent none
 * @returns {boolean}
 */
function isWalletMissingMessage(nodeErr) {
    return /wallet does not exist or is not loaded|no wallet is loaded/i.test(String(nodeErr))
}

// Codes axios sets on a call that hit its timeout.
const TIMEOUT_ERROR_CODES = ['ECONNABORTED', 'ETIMEDOUT']

// Whether an axios rejection is the client giving up on a call the node may still be running.
function isTimeout(error) {
    return Boolean(error && TIMEOUT_ERROR_CODES.includes(error.code))
}

module.exports = { isTimeout, isWalletMissingMessage, rejectedRpcErrorMessage, rpcErrorCode }
