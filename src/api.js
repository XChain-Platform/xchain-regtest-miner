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

// Load required libraries
const dotenv = require('dotenv')
dotenv.config()

const crypto = require('crypto');
const express = require('express');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const cors = require('cors');
const XChainRegtestMiner  = require('./XChainRegtestMiner');
const jsonRouter = require('express-json-rpc-router')


// Accept either the bare network ("regtest") or the platform's "coin-network" form ("bitcoin-regtest").
// COIN_NETWORK keeps the full identifier so the miner can resolve coin-specific
// address/PSBT params (DOGE/LTC version bytes differ from Bitcoin); NETWORK is the
// bare suffix, used only for validation below.
const COIN_NETWORK = process.env.NETWORK
const NETWORK = (COIN_NETWORK || '').includes('-')
    ? COIN_NETWORK.split('-').pop()
    : COIN_NETWORK
const NODE_URL =  process.env.NODE_URL
const NODE_PORT =  process.env.NODE_PORT
const NODE_USER =  process.env.NODE_USER
const NODE_PASSWORD =  process.env.NODE_PASSWORD
const REGTEST_MINER_API_PORT = process.env.REGTEST_MINER_API_PORT

// Optional API key for the miner's own JSON-RPC surface. When set, every request
// must supply the matching value in the X-API-Key header; unset (default) means
// no auth so existing unauthenticated callers (e2e harness, docker-compose stacks)
// are unaffected. Mirrors the opt-in pattern used by xchain-encoder and xchain-hub.
const MINER_API_KEY = process.env.MINER_API_KEY || null

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

// Read-only health/observability RPC methods that bypass the MINER_API_KEY gate. The
// bundled Docker HEALTHCHECK POSTs `ping` with no X-API-Key, so gating it would 401 every
// probe and mark the container permanently unhealthy (stalling any
// `depends_on: service_healthy` bring-up). Exported so the auth contract is asserted
// directly rather than via a drift-prone mirror.
const UNAUTHENTICATED_METHODS = new Set(['ping', 'status'])

const REQUIRED_ENV_VARS = ['NETWORK', 'NODE_URL', 'NODE_PORT', 'NODE_USER', 'NODE_PASSWORD', 'REGTEST_MINER_API_PORT']

function validateEnvVars() {
    const missing = REQUIRED_ENV_VARS.filter(name => !process.env[name] || process.env[name].trim() === '')
    if (missing.length > 0) {
        console.error('Missing required environment variables: ' + missing.join(', '))
        process.exit(1)
    }
    const portVars = ['NODE_PORT', 'REGTEST_MINER_API_PORT']
    for (const name of portVars) {
        const val = parseInt(process.env[name], 10)
        if (isNaN(val) || val < 1 || val > 65535) {
            console.error(name + ' must be a valid port number (1-65535)')
            process.exit(1)
        }
    }
    // Refuse mainnet outright. This tool auto-mines and exposes an
    // unauthenticated send_funds endpoint by default; pointed at a live mainnet
    // node it would drain a funded wallet via sendtoaddress. regtest is the
    // intended target; testnet is tolerated for faucet-style flows (valueless coins).
    const validNetworks = ['regtest', 'testnet']
    if (!validNetworks.includes(NETWORK)) {
        console.error('NETWORK must resolve to one of: ' + validNetworks.join(', ') + ' (got: ' + process.env.NETWORK + '). mainnet is refused.')
        process.exit(1)
    }
    const nodeUrl = process.env.NODE_URL
    if (nodeUrl !== 'localhost' && nodeUrl !== '127.0.0.1') {
        console.warn('WARNING: NODE_URL is not localhost (' + nodeUrl + '). RPC credentials will be transmitted over the network in plaintext.')
    }
}

async function startApi(){
    validateEnvVars()

    //Start the miner
    const miner = new XChainRegtestMiner(COIN_NETWORK, NODE_URL, NODE_PORT, NODE_USER, NODE_PASSWORD);
    miner.start().catch(err => {
        console.error('Miner failed to start: ' + (err && err.message ? err.message : err))
        process.exit(1)
    })

    // Create the app
    const app = express();

    // Use Helmet to increase security
    app.use(helmet());

    // Allow JSON requests
    app.use(bodyParser.json());

    // Allow CORS for development
    app.use(cors());

    // When MINER_API_KEY is set, enforce it via X-API-Key header. Requests without
    // the correct key receive 401 before reaching any RPC handler. When the env var
    // is absent the middleware is skipped entirely so unauthenticated callers
    // (e2e harness, docker-compose stacks) continue to work with no config change.
    //
    // The read-only health/observability methods (UNAUTHENTICATED_METHODS: ping, status)
    // are exempt; bodyParser.json() (above) has already populated req.body, so the method
    // is readable here.
    // Platform-wide no-API-key posture : keyless operation is the regtest
    // default, but the open state is announced loudly at boot rather than implied.
    if (!MINER_API_KEY) {
        console.warn('WARNING: MINER_API_KEY is not set. Miner API authentication is DISABLED (open access). This is expected for local regtest stacks; set MINER_API_KEY on any shared deployment.')
    }
    if (MINER_API_KEY) {
        console.log('MINER_API_KEY is set: API key authentication is enabled')
        app.use((req, res, next) => {
            if (UNAUTHENTICATED_METHODS.has(req.body && req.body.method)) {
                return next()
            }
            const provided = req.headers['x-api-key']
            if (!timingSafeStringEqual(provided, MINER_API_KEY)) {
                return res.status(401).json({ error: 'Unauthorized: missing or invalid X-API-Key' })
            }
            next()
        })
    }

    const jsonRpcController = {
        // Function to check if xchain-regtest-miner is up
        async ping() {
            // ready reflects wallet preparation (mine-readiness), not just that the port is
            // listening: start() runs prepareWallet() detached, so a cold start after a reset
            // can answer ping before walletAddress is set. Callers that mine should gate on ready.
            return {status:"success", ready: !!miner.walletReady};
        },

        // Return current loop state so operators and CI can distinguish
        // idle-healthy from stuck-retrying without watching stdout.
        async status() {
            return miner.getStatus()
        },
        
        // Function to send funds to any address
        async send_funds({address, amount}) {
            let txid = null
        
            try {
                txid = await miner.sendFundsToAddress(address, amount)
            } catch(err){
                return {"error":"There was a problem sending funds: " + (err && err.message ? err.message : err)}
            }

            // Return ok
            return txid
        },
        
        // Function to fill the mempool with a specific number of transactions randomly created
        // this will stop the automatic mining for the regtest miner. Use continue_mining to activate it again
        async fill_mempool({tx_quantity}) {
            try {
                await miner.fillMempool(tx_quantity)
            } catch(err){
                return {"error":"There was a problem trying to fill the mempool: " + (err && err.message ? err.message : err)}
            }

            // Return ok
            return "ok"
        },

        // Stop the auto-mine loop from firing further blocks. Any block already
        // in flight at the moment of the call completes normally. Use
        // continue_mining to resume.
        async pause_mining({} = {}) {
            try {
                await miner.pauseMining()
            } catch(err){
                return {"error":"There was a problem trying to pause the mining"}
            }

            // Return ok
            return "ok"
        },

        // Function to fill the mempool with a specific number of transactions randomly created
        async continue_mining({} = {}) {
            try {
                await miner.continueMining()
            } catch(err){
                return {"error":"There was a problem trying to continue the mining"}
            }

            // Return ok
            return "ok"
        },
        
        async set_mining_time({max_time, tx_added_time}){
            try{
                await miner.setMiningTime(max_time, tx_added_time)
            } catch (err){
                return {"error": (err && err.message) ? err.message : "There was a problem trying to set a new time to mine blocks"}
            }

            // Return ok
            return "ok"
        },

        async set_default_mining_time(){
            try{
                await miner.setDefaultMiningTime()
            } catch (err){
                return {"error":"There was a problem trying to set a the default time to mine blocks"}
            }

            // Return ok
            return "ok"
        },

        // Mine `count` empty blocks. Used by e2e tests to advance block height
        // past indexer time-locked states (e.g. STAKE ACTIVATION_DELAY_BLOCKS).
        async generate_blocks({count}){
            try {
                let hashes = await miner.generateBlocks(count)
                return { "count": hashes.length, "hashes": hashes }
            } catch (err){
                return { "error": "There was a problem generating blocks: " + (err && err.message) }
            }
        },

        // Mark a block as invalid so the node rolls back to the fork point.
        // Auto-mining is paused; call continue_mining when the reorg is complete.
        // Enables deterministic reorg tests without dropping to raw node RPC.
        async invalidate_block({block_hash}) {
            try {
                await miner.invalidateBlock(block_hash)
                return "ok"
            } catch (err) {
                return { "error": "There was a problem invalidating the block: " + (err && err.message ? err.message : err) }
            }
        },

        // Remove a block from the invalid set so the node can re-evaluate chain
        // selection. Call after mining the competing branch, before continue_mining.
        async reconsider_block({block_hash}) {
            try {
                await miner.reconsiderBlock(block_hash)
                return "ok"
            } catch (err) {
                return { "error": "There was a problem reconsidering the block: " + (err && err.message ? err.message : err) }
            }
        }
    }

    // Express 5 / body-parser 2.x leaves req.body undefined when a request carries
    // no JSON body (a GET, or a POST without application/json), whereas body-parser
    // 1.x set it to {}. express-json-rpc-router requires req.body to be an object or
    // it throws ("req.body is required"). Restore the {} default so unmatched requests
    // that fall through to this root-mounted router get a normal JSON-RPC error
    // response instead of crashing the request.
    app.use((req, res, next) => { if (req.body === undefined) req.body = {}; next(); });

    // Allow JSON-RPC requests
    app.use(jsonRouter({methods: jsonRpcController}))


    // Start the server. Hand the listening handle to the miner so its shutdown
    // handler can close it; without this, a registered SIGTERM listener suppresses
    // Node's default terminate and the still-listening server keeps the event loop
    // alive until docker's stop-grace SIGKILL.
    miner.apiServer = app.listen(REGTEST_MINER_API_PORT, () => {
      console.log('API listening on port '+REGTEST_MINER_API_PORT);
    });
}

if (require.main === module) {
    startApi()
}

module.exports = { startApi, UNAUTHENTICATED_METHODS }