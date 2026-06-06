// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

const express = require('express')

/**
 * Lightweight Express server that mimics Bitcoin Core's JSON-RPC interface.
 * Supports programmable per-method responses, error injection, and call recording.
 */
class MockRpcServer {
    constructor() {
        this.app = express()
        this.app.use(express.json())
        this.handlers = {}
        this.calls = []
        this.server = null
        this.port = null

        this.app.post('/', async (req, res) => {
            const { method, params, id } = req.body
            const authHeader = req.headers.authorization || null

            this.calls.push({ method, params, id, auth: authHeader })

            const handler = this.handlers[method]
            if (!handler) {
                return res.json({
                    jsonrpc: '2.0',
                    result: null,
                    error: { code: -32601, message: `Method "${method}" not found` },
                    id,
                })
            }

            // Error injection: fail N times before succeeding
            if (handler.failCount > 0) {
                handler.failCount--
                if (handler.failMode === 'http') {
                    return res.status(503).send('Service Unavailable')
                }
                if (handler.failMode === 'timeout') {
                    // Don't respond — let the client timeout
                    return
                }
                // Default: RPC-level error
                return res.json({
                    jsonrpc: '2.0',
                    result: null,
                    error: handler.errorObj || { code: -1, message: 'Injected error' },
                    id,
                })
            }

            // Delay injection
            if (handler.delay > 0) {
                await new Promise(resolve => setTimeout(resolve, handler.delay))
            }

            // Compute result (static value or function of params)
            const result = typeof handler.resultFn === 'function'
                ? handler.resultFn(params)
                : handler.resultValue

            res.json({ jsonrpc: '2.0', result, error: null, id })
        })
    }

    /**
     * Configure the response for an RPC method. Chainable.
     *
     *   server.onMethod('getbalance').returns(50.0)
     *   server.onMethod('createwallet').failTimes(2, 'rpc').thenReturn({name:'w'})
     *   server.onMethod('getrawmempool').returnsFrom(params => ['tx1','tx2'])
     */
    onMethod(method) {
        const handler = {
            resultValue: null,
            resultFn: null,
            failCount: 0,
            failMode: 'rpc',
            errorObj: null,
            delay: 0,
        }
        this.handlers[method] = handler

        const builder = {
            returns: (value) => {
                handler.resultValue = value
                handler.resultFn = null
                return builder
            },
            returnsFrom: (fn) => {
                handler.resultFn = fn
                return builder
            },
            withDelay: (ms) => {
                handler.delay = ms
                return builder
            },
            failTimes: (n, mode = 'rpc', errorObj = null) => {
                handler.failCount = n
                handler.failMode = mode
                handler.errorObj = errorObj || { code: -1, message: 'Injected error' }
                return {
                    thenReturn: (value) => {
                        handler.resultValue = value
                        handler.resultFn = null
                        return builder
                    },
                    thenReturnFrom: (fn) => {
                        handler.resultFn = fn
                        return builder
                    },
                }
            },
        }
        return builder
    }

    /** Start listening on an ephemeral port. */
    async start() {
        return new Promise((resolve) => {
            this.server = this.app.listen(0, '127.0.0.1', () => {
                this.port = this.server.address().port
                resolve()
            })
        })
    }

    /** Shut down the server. */
    async stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(resolve)
                this.server = null
            } else {
                resolve()
            }
        })
    }

    /** Clear all handlers and recorded calls. */
    reset() {
        this.handlers = {}
        this.calls = []
    }

    /** Get recorded calls for a specific method. */
    callsFor(method) {
        return this.calls.filter(c => c.method === method)
    }
}

module.exports = MockRpcServer
