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

const express = require('express')
const bodyParser = require('body-parser')
const helmet = require('helmet')
const cors = require('cors')
const XChainRegtestMiner = require('../XChainRegtestMiner')
const { installAuthentication } = require('./auth')
const { createRpcMethods } = require('./rpc_methods')

const REQUIRED_ENV_VARS = ['NETWORK', 'NODE_URL', 'NODE_PORT', 'NODE_USER', 'NODE_PASSWORD', 'REGTEST_MINER_API_PORT']

function validateEnvVars(environment, network, logger) {
    const missing = REQUIRED_ENV_VARS.filter(name => !environment[name] || environment[name].trim() === '')
    if (missing.length > 0) {
        logger.error('Missing required environment variables: ' + missing.join(', '))
        process.exit(1)
    }
    const portVars = ['NODE_PORT', 'REGTEST_MINER_API_PORT']
    for (const name of portVars) {
        const val = parseInt(environment[name], 10)
        if (isNaN(val) || val < 1 || val > 65535) {
            logger.error(name + ' must be a valid port number (1-65535)')
            process.exit(1)
        }
    }
    // Refuse mainnet outright. This tool auto-mines and exposes an
    // unauthenticated send_funds endpoint by default; pointed at a live mainnet
    // node it would drain a funded wallet via sendtoaddress. regtest is the
    // intended target; testnet is tolerated for faucet-style flows (valueless coins).
    const validNetworks = ['regtest', 'testnet']
    if (!validNetworks.includes(network)) {
        logger.error('NETWORK must resolve to one of: ' + validNetworks.join(', ') + ' (got: ' + environment.NETWORK + '). mainnet is refused.')
        process.exit(1)
    }
    const nodeUrl = environment.NODE_URL
    if (nodeUrl !== 'localhost' && nodeUrl !== '127.0.0.1') {
        logger.warn('WARNING: NODE_URL is not localhost (' + nodeUrl + '). RPC credentials will be transmitted over the network in plaintext.')
    }
}

function createMiner(config) {
    return new XChainRegtestMiner(config.coinNetwork, config.nodeUrl, config.nodePort, config.nodeUser, config.nodePassword)
}

function startMinerDetached(miner, logger) {
    miner.start().catch(err => {
        logger.error('Miner failed to start: ' + (err && err.message ? err.message : err))
        process.exit(1)
    })
}

function createApiApp() {
    const app = express()
    app.use(helmet())
    app.use(bodyParser.json())
    app.use(cors())
    return app
}

function listenApi(app, miner, apiPort, logger) {
    // Start the server. Hand the listening handle to the miner so its shutdown
    // handler can close it; without this, a registered SIGTERM listener suppresses
    // Node's default terminate and the still-listening server keeps the event loop
    // alive until docker's stop-grace SIGKILL.
    miner.apiServer = app.listen(apiPort, () => {
        logger.log('API listening on port '+apiPort)
    })
}

function createStartApi({ config, environment, logger, createHealthController, mountJsonRpc, warnWhenApiIsOpen }) {
    return async function startApi(){
        validateEnvVars(environment, config.network, logger)

        const miner = createMiner(config)

        // Optional mine-empty heartbeat. Unset/0 keeps the historical behavior (mine
        // only when the mempool is non-empty); set it on venues whose drills wait on
        // BLOCK HEIGHT with no transactions in flight (stake activation delay,
        // confirmation depth) so the chain advances without raw node RPC.
        if (environment.IDLE_MINE_INTERVAL_MS){
            try { await miner.setIdleMineInterval(parseInt(environment.IDLE_MINE_INTERVAL_MS, 10)) }
            catch (err) {
                logger.error('Invalid IDLE_MINE_INTERVAL_MS: ' + (err && err.message ? err.message : err))
                process.exit(1)
            }
        }

        startMinerDetached(miner, logger)

        const app = createApiApp()
        warnWhenApiIsOpen()
        installAuthentication(app, config.apiKey, logger)
        const healthController = createHealthController(miner)
        const rpcMethods = createRpcMethods(miner, healthController.health)
        mountJsonRpc(app, rpcMethods)
        listenApi(app, miner, config.apiPort, logger)
    }
}

module.exports = { REQUIRED_ENV_VARS, createApiApp, createMiner, createStartApi, listenApi, startMinerDetached, validateEnvVars }
