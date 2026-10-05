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
 *
 * XChain Regtest Miner - API
 *
 * This file parses in environmental variables and starts up the regtest miner instance
 *
 ********************************************************************/

const dotenv = require('dotenv')
dotenv.config()

const jsonRouter = require('express-json-rpc-router')
const {
    UNAUTHENTICATED_METHODS
} = require('./api/auth')
const {
    evaluateMinerHealth: evaluateMinerHealthPolicy,
    formatMinerHealth
} = require('./api/health')
const { createStartApi } = require('./api/startup')
const envConfig = require('./config')

// Accept either the bare network ("regtest") or the platform's "coin-network" form ("bitcoin-regtest").
// COIN_NETWORK keeps the full identifier so the miner can resolve coin-specific
// address/PSBT params (DOGE/LTC version bytes differ from Bitcoin); NETWORK is the
// bare suffix, used only for validation below.
const COIN_NETWORK = envConfig.NETWORK
const NETWORK = (COIN_NETWORK || '').includes('-')
    ? COIN_NETWORK.split('-').pop()
    : COIN_NETWORK
const NODE_URL = envConfig.NODE_URL
const NODE_PORT = envConfig.NODE_PORT
const NODE_USER = envConfig.NODE_USER
const NODE_PASSWORD = envConfig.NODE_PASSWORD
const REGTEST_MINER_API_PORT = envConfig.REGTEST_MINER_API_PORT

// Optional API key for the miner's own JSON-RPC surface. When set, every request
// must supply the matching value in the X-API-Key header; unset (default) means
// no auth so existing unauthenticated callers (e2e harness, docker-compose stacks)
// are unaffected. Mirrors the opt-in pattern used by xchain-encoder and xchain-hub.
const MINER_API_KEY = envConfig.MINER_API_KEY

// Stall thresholds for the `health` probe. A deliberate pause is never a stall,
// so only these two shapes are: a run of failed mining cycles, and a wallet that
// never became ready once the cold-start grace has elapsed.
const STALL_ERROR_THRESHOLD = parseInt(envConfig.MINER_STALL_ERROR_THRESHOLD, 10) || 5
const WALLET_GRACE_MS       = parseInt(envConfig.MINER_WALLET_GRACE_MS, 10) || 60000

function evaluateMinerHealth({ status = {}, uptimeMs = 0,
                               errorThreshold = STALL_ERROR_THRESHOLD,
                               walletGraceMs = WALLET_GRACE_MS } = {}) {
    return evaluateMinerHealthPolicy({ status, uptimeMs, errorThreshold, walletGraceMs })
}

function warnWhenApiIsOpen() {
    // Platform-wide no-API-key posture: keyless operation is the regtest
    // default, but the open state is announced loudly at boot rather than implied.
    if (!MINER_API_KEY) {
        console.warn('WARNING: MINER_API_KEY is not set. Miner API authentication is DISABLED (open access). This is expected for local regtest stacks; set MINER_API_KEY on any shared deployment.')
    }
}

function createHealthController(miner, { uptime = process.uptime } = {}) {
    const jsonRpcController = {
        // Readiness probe: 503 when mining is genuinely stalled. `ping` reports
        // wallet readiness in its body but always answers 200, so credential drift
        // or an unreachable coin node kept the container Docker-healthy while the
        // loop never advanced height. The container healthcheck reads
        // this method; `ping` is left alone as liveness for warmup bring-up.
        async health(params, {res}) {
            const status = miner.getStatus()
            const verdict = evaluateMinerHealth({ status, uptimeMs: uptime() * 1000 })
            if (!verdict.healthy) res.status(503)
            return formatMinerHealth(status, verdict)
        }
    }
    return jsonRpcController
}

function mountJsonRpc(app, jsonRpcController) {
    // Express 5 / body-parser 2.x leaves req.body undefined when a request carries
    // no JSON body (a GET, or a POST without application/json), whereas body-parser
    // 1.x set it to {}. express-json-rpc-router requires req.body to be an object or
    // it throws ("req.body is required"). Restore the {} default so unmatched requests
    // that fall through to this root-mounted router get a normal JSON-RPC error
    // response instead of crashing the request.
    app.use((req, res, next) => { if (req.body === undefined) req.body = {}; next(); });

    // Coalesce an explicit `"params": null` to {} for the same reason, one layer up.
    // The router defaults only an ABSENT params (`params = {}` destructuring default,
    // which null does not trigger), so a body that spells params out as null reaches
    // a parameterized handler like send_funds({address, amount}) and throws during
    // ARGUMENT BINDING, before the handler's own try/catch exists. Every one of these
    // handlers reports failure as a truthy `{error: "..."}` result; a binding throw
    // instead escapes to the router's top-level JSON-RPC error member, so one failure
    // class answers in two different shapes and leaks a raw JS destructuring message
    // to the client. Normalizing here covers every handler, including ones added later.
    app.use((req, res, next) => {
        const normalize = (rpc) => { if (rpc && typeof rpc === 'object' && rpc.params === null) rpc.params = {} }
        if (Array.isArray(req.body)) req.body.forEach(normalize)
        else normalize(req.body)
        next();
    });

    app.use(jsonRouter({methods: jsonRpcController}))
}

const startApi = createStartApi({
    config: {
        coinNetwork: COIN_NETWORK,
        network: NETWORK,
        nodeUrl: NODE_URL,
        nodePort: NODE_PORT,
        nodeUser: NODE_USER,
        nodePassword: NODE_PASSWORD,
        apiPort: REGTEST_MINER_API_PORT,
        apiKey: MINER_API_KEY
    },
    environment: envConfig.PROCESS_ENV,
    logger: console,
    createHealthController,
    mountJsonRpc,
    warnWhenApiIsOpen
})

if (require.main === module) {
    startApi()
}

module.exports = {
    startApi,
    UNAUTHENTICATED_METHODS,
    evaluateMinerHealth,
    STALL_ERROR_THRESHOLD,
    WALLET_GRACE_MS,
    createHealthController,
    mountJsonRpc,
    warnWhenApiIsOpen
}
