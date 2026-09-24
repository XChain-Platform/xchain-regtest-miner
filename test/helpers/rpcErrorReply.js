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
 * JSON-RPC error replies in the transport shape each supported daemon uses.
 *
 * 'legacy' (LTC v0.21, DOGE v1.14) answers every RPC error with a non-2xx
 * status: 404 for method-not-found, 400 for an invalid request, 500 for the
 * rest, carrying {result: null, error, id}. 'core31' (Bitcoin Core 28+)
 * answers with HTTP 200 and a spec-conformant {jsonrpc, error, id} body, but
 * only when the request declared JSON-RPC 2.0; any other request gets the
 * legacy shape there too.
 */

const DAEMONS = ['legacy', 'core31']

// Refuse a daemon name no double models.
function assertDaemon(daemon) {
    if (!DAEMONS.includes(daemon)) {
        throw new Error(`Unknown daemon "${daemon}"; expected one of ${DAEMONS.join(', ')}`)
    }
    return daemon
}

// Map an RPC error code to the HTTP status of the pre-2.0 transport.
function legacyStatus(code) {
    if (code === -32601) return 404
    if (code === -32600) return 400
    return 500
}

/**
 * Send `error` as the reply `daemon` would give to `request`.
 *
 * @param {object} res express response
 * @param {{daemon: string, request: object, error: {code: number, message: string}}} opts
 */
function sendRpcError(res, { daemon, request, error }) {
    const id = request && request.id !== undefined ? request.id : null
    if (daemon === 'core31' && request && request.jsonrpc === '2.0') {
        return res.status(200).json({ jsonrpc: '2.0', error, id })
    }
    return res.status(legacyStatus(error.code)).json({ result: null, error, id })
}

module.exports = { DAEMONS, assertDaemon, legacyStatus, sendRpcError }
