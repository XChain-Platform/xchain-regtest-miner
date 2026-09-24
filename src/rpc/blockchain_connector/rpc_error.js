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

module.exports = { rejectedRpcErrorMessage }
