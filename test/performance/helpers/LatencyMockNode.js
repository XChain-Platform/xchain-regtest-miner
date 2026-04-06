/**
 * LatencyMockNode — StatefulMockNode extended with configurable per-method
 * delays and call timing instrumentation.
 *
 * Used by performance tests to simulate realistic RPC latency while
 * maintaining stateful Bitcoin Core behavior.
 */

const StatefulMockNode = require('../../e2e/helpers/StatefulMockNode')

class LatencyMockNode extends StatefulMockNode {
    constructor() {
        super()

        this._methodDelays = {}     // { methodName: ms }
        this._globalDelay = 0
        this._callTimestamps = []   // [{ method, startedAt, completedAt, latencyMs }]

        // Replace the POST handler registered by StatefulMockNode's constructor
        // with one that adds delay injection and call timing.
        this._reinstallHandler()
    }

    /**
     * Remove the parent's POST / handler and install an enhanced one.
     */
    _reinstallHandler() {
        // Remove the last route layer added by StatefulMockNode
        const stack = this.app._router.stack
        for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].route && stack[i].route.path === '/') {
                stack.splice(i, 1)
                break
            }
        }

        // Install the enhanced handler
        this.app.post('/', async (req, res) => {
            const { method, params, id } = req.body
            this.calls.push({ method, params, id })

            const startedAt = Date.now()

            // Apply delay
            const delay = this._methodDelays[method] !== undefined
                ? this._methodDelays[method]
                : this._globalDelay
            if (delay > 0) {
                await new Promise(r => setTimeout(r, delay))
            }

            // Dispatch to the _rpc_* handler from StatefulMockNode
            const handler = this['_rpc_' + method]
            if (!handler) {
                const completedAt = Date.now()
                this._callTimestamps.push({ method, startedAt, completedAt, latencyMs: completedAt - startedAt })
                return res.json({
                    jsonrpc: '2.0', result: null,
                    error: { code: -32601, message: `Method "${method}" not found` }, id,
                })
            }

            try {
                const result = handler.call(this, params)
                const completedAt = Date.now()
                this._callTimestamps.push({ method, startedAt, completedAt, latencyMs: completedAt - startedAt })
                res.json({ jsonrpc: '2.0', result, error: null, id })
            } catch (err) {
                const completedAt = Date.now()
                this._callTimestamps.push({ method, startedAt, completedAt, latencyMs: completedAt - startedAt })
                res.json({
                    jsonrpc: '2.0', result: null,
                    error: { code: err.rpcCode || -1, message: err.message }, id,
                })
            }
        })
    }

    /**
     * Set artificial delay for a specific RPC method.
     * @param {string} method - RPC method name (lowercase, e.g. 'getrawmempool')
     * @param {number} ms - delay in milliseconds
     * @returns {LatencyMockNode} this (chainable)
     */
    setMethodDelay(method, ms) {
        this._methodDelays[method] = ms
        return this
    }

    /**
     * Set a global delay applied to all methods without individual delays.
     * @param {number} ms
     * @returns {LatencyMockNode} this (chainable)
     */
    setGlobalDelay(ms) {
        this._globalDelay = ms
        return this
    }

    /** Clear all configured delays. */
    clearDelays() {
        this._methodDelays = {}
        this._globalDelay = 0
    }

    /**
     * Get call timing records for a specific method.
     * @param {string} method
     * @returns {{method, startedAt, completedAt, latencyMs}[]}
     */
    getCallTimings(method) {
        return this._callTimestamps.filter(c => c.method === method)
    }

    /**
     * Get average latency for a specific method.
     * @param {string} method
     * @returns {number} average latency in ms, or 0 if no calls
     */
    getAverageLatency(method) {
        const timings = this.getCallTimings(method)
        if (timings.length === 0) return 0
        return timings.reduce((sum, t) => sum + t.latencyMs, 0) / timings.length
    }

    /** Get all call timing records. */
    getAllCallTimings() {
        return this._callTimestamps
    }

    /** Reset state, delays, and timing records. */
    reset() {
        super.reset()
        this.clearDelays()
        this._callTimestamps = []
    }
}

module.exports = LatencyMockNode
