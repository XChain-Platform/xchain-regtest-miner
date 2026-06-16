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
 * ChaosNode — LatencyMockNode extended with fault injection capabilities
 * for chaos engineering experiments.
 *
 * Adds: offline simulation, per-method random failure rates, response
 * corruption, method interception, and authentication enforcement.
 *
 * Inheritance: StatefulMockNode → LatencyMockNode → ChaosNode
 */

const LatencyMockNode = require('../../performance/helpers/LatencyMockNode')

class ChaosNode extends LatencyMockNode {
    constructor() {
        super()

        this._offline = false
        this._failRates = {}        // { methodName: 0.0–1.0 }
        this._corruptors = {}       // { methodName: (result) => alteredResult }
        this._interceptors = {}     // { methodName: (params, res, id) => void }
        this._authOverride = null   // null | { user, pass }

        this._reinstallChaosHandler()
    }

    // ── Chaos handler installation ──────────────────────────────────

    _reinstallChaosHandler() {
        // Remove LatencyMockNode's handler (the last POST / route)
        const stack = this.app._router.stack
        for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].route && stack[i].route.path === '/') {
                stack.splice(i, 1)
                break
            }
        }

        this.app.post('/', async (req, res) => {
            // 1. Offline — destroy socket (simulates ECONNRESET)
            if (this._offline) {
                req.socket.destroy()
                return
            }

            const { method, params, id } = req.body

            // 2. Auth enforcement
            if (this._authOverride) {
                const authHeader = req.headers.authorization || ''
                const expected = 'Basic ' +
                    Buffer.from(this._authOverride.user + ':' + this._authOverride.pass).toString('base64')
                if (authHeader !== expected) {
                    return res.status(401).json({ error: 'Unauthorized' })
                }
            }

            // 3. Record call (same as StatefulMockNode)
            this.calls.push({ method, params, id })

            // 4. Timestamp start (same as LatencyMockNode)
            const startedAt = Date.now()

            // 5. Method interceptor — full override
            if (this._interceptors[method]) {
                return this._interceptors[method](params, res, id)
            }

            // 6. Apply latency (from LatencyMockNode config)
            const delay = this._methodDelays[method] !== undefined
                ? this._methodDelays[method]
                : this._globalDelay
            if (delay > 0) {
                await new Promise(r => setTimeout(r, delay))
            }

            // 7. Random failure injection
            if (this._failRates[method] !== undefined && Math.random() < this._failRates[method]) {
                const completedAt = Date.now()
                this._callTimestamps.push({ method, startedAt, completedAt, latencyMs: completedAt - startedAt })
                return res.json({
                    jsonrpc: '2.0', result: null,
                    error: { code: -1, message: 'Chaos: injected random failure for ' + method }, id,
                })
            }

            // 8. Dispatch to _rpc_* handler
            const handler = this['_rpc_' + method]
            if (!handler) {
                const completedAt = Date.now()
                this._callTimestamps.push({ method, startedAt, completedAt, latencyMs: completedAt - startedAt })
                return res.json({
                    jsonrpc: '2.0', result: null,
                    error: { code: -32601, message: `Method "${method}" not found` }, id,
                })
            }

            let result
            try {
                result = handler.call(this, params)
            } catch (err) {
                const completedAt = Date.now()
                this._callTimestamps.push({ method, startedAt, completedAt, latencyMs: completedAt - startedAt })
                return res.json({
                    jsonrpc: '2.0', result: null,
                    error: { code: err.rpcCode || -1, message: err.message }, id,
                })
            }

            // 9. Response corruption
            if (Object.prototype.hasOwnProperty.call(this._corruptors, method)) {
                result = this._corruptors[method](result)
            }

            const completedAt = Date.now()
            this._callTimestamps.push({ method, startedAt, completedAt, latencyMs: completedAt - startedAt })
            res.json({ jsonrpc: '2.0', result, error: null, id })
        })
    }

    // ── Offline simulation ──────────────────────────────────────────

    /** Simulate node going down — all connections get socket destroyed. */
    goOffline() {
        this._offline = true
    }

    /** Bring node back online. */
    goOnline() {
        this._offline = false
    }

    // ── Per-method random failure ───────────────────────────────────

    /**
     * Set probability of RPC-level error for a method.
     * @param {string} method - RPC method name
     * @param {number} rate - failure probability 0.0–1.0
     */
    setFailRate(method, rate) {
        this._failRates[method] = rate
        return this
    }

    clearFailRates() {
        this._failRates = {}
    }

    // ── Response corruption ─────────────────────────────────────────

    /**
     * Transform the RPC result before sending.
     * @param {string} method
     * @param {function} corruptorFn - (result) => corrupted result
     */
    corruptResponse(method, corruptorFn) {
        this._corruptors[method] = corruptorFn
        return this
    }

    clearCorruptors() {
        this._corruptors = {}
    }

    // ── Method interception ─────────────────────────────────────────

    /**
     * Override a method handler entirely.
     * @param {string} method
     * @param {function} handlerFn - (params, res, id) => void
     */
    interceptMethod(method, handlerFn) {
        this._interceptors[method] = handlerFn
        return this
    }

    clearInterceptor(method) {
        delete this._interceptors[method]
    }

    clearInterceptors() {
        this._interceptors = {}
    }

    // ── Authentication enforcement ──────────────────────────────────

    /**
     * Require specific credentials — requests with wrong creds get HTTP 401.
     * @param {string} user
     * @param {string} pass
     */
    setAuthRequired(user, pass) {
        this._authOverride = { user, pass }
    }

    clearAuthRequired() {
        this._authOverride = null
    }

    // ── Reset ───────────────────────────────────────────────────────

    reset() {
        super.reset()
        this._offline = false
        this._failRates = {}
        this._corruptors = {}
        this._interceptors = {}
        this._authOverride = null
    }
}

module.exports = ChaosNode
