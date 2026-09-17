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
 *********************************************************************/

const crypto = require('crypto')

// Read-only health/observability RPC methods that bypass the MINER_API_KEY gate. The
// bundled Docker HEALTHCHECK POSTs its probe method with no X-API-Key, so gating it
// would 401 every check and mark the container permanently unhealthy. (An earlier
// version of this comment cited a `depends_on: service_healthy` warmup contract; no
// compose file in this tree makes the miner a depends_on target, so the claim is
// dropped rather than restated.) Exported so the auth contract is asserted directly
// rather than via a drift-prone mirror.
const UNAUTHENTICATED_METHODS = new Set(['ping', 'status', 'health'])

// Constant-time API-key comparison. Plain `!==` on strings short-circuits on the
// first differing character, leaking the key byte-by-byte via response timing to
// anyone with network access to the miner port. The length check runs first because
// crypto.timingSafeEqual throws on unequal-length buffers; a missing header coerces
// to '' and fails closed (401) rather than throwing.
function timingSafeStringEqual(a, b) {
    const bufA = Buffer.from(String(a ?? ''))
    const bufB = Buffer.from(String(b ?? ''))
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)
}

function installAuthentication(app, apiKey, logger) {
    if (!apiKey) return

    logger.log('MINER_API_KEY is set: API key authentication is enabled')
    app.use((req, res, next) => {
        if (UNAUTHENTICATED_METHODS.has(req.body && req.body.method)) {
            return next()
        }
        const provided = req.headers['x-api-key']
        if (!timingSafeStringEqual(provided, apiKey)) {
            return res.status(401).json({ error: 'Unauthorized: missing or invalid X-API-Key' })
        }
        next()
    })
}

module.exports = {
    UNAUTHENTICATED_METHODS,
    installAuthentication,
    timingSafeStringEqual
}
