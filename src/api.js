/*********************************************************************
 *
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC – https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available —
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
    const validNetworks = ['regtest', 'testnet', 'mainnet']
    if (!validNetworks.includes(NETWORK)) {
        console.error('NETWORK must resolve to one of: ' + validNetworks.join(', ') + ' (got: ' + process.env.NETWORK + ')')
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
    miner.start()

    // Create the app
    const app = express();

    // Use Helmet to increase security
    app.use(helmet());

    // Allow JSON requests
    app.use(bodyParser.json());

    // Allow CORS for development
    app.use(cors());


    const jsonRpcController = {
        // Function to check if xchain-regtest-miner is up
        async ping() {
            return {status:"success"};
        },
        
        // Function to send funds to any address
        async send_funds({address, amount}) {
            let txid = null
        
            try {
                txid = await miner.sendFundsToAddress(address, amount)
            } catch(err){
                return {"error":"There was a problem sending funds"}
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
            return {"result":"ok"}
        },
        
        // Function to fill the mempool with a specific number of transactions randomly created
        async continue_mining({}) {
            try {
                await miner.continueMining()
            } catch(err){
                return {"error":"There was a problem trying to continue the mining"}
            }

            // Return ok
            return {"result":"ok"}
        },
        
        async set_mining_time({max_time, tx_added_time}){
            try{
                await miner.setMiningTime(max_time, tx_added_time)
            } catch (err){
                return {"error":"There was a problem trying to set a new time to mine blocks"}
            }
            
            // Return ok
            return {"result":"ok"}
        },
        
        async set_default_mining_time(){
            try{
                await miner.setDefaultMiningTime()
            } catch (err){
                return {"error":"There was a problem trying to set a the default time to mine blocks"}
            }

            // Return ok
            return {"result":"ok"}
        },

        // Mine `count` empty blocks. Used by e2e tests to advance block height
        // past indexer time-locked states (e.g. STAKE ACTIVATION_DELAY_BLOCKS).
        async generate_blocks({count}){
            try {
                let hashes = await miner.generateBlocks(count)
                return { "result": { "count": hashes.length, "hashes": hashes } }
            } catch (err){
                return { "error": "There was a problem generating blocks: " + (err && err.message) }
            }
        }
    }

    // Allow JSON-RPC requests
    app.use(jsonRouter({methods: jsonRpcController}))


    // Start the server
    app.listen(REGTEST_MINER_API_PORT, () => {
      console.log('API listening on port '+REGTEST_MINER_API_PORT);
    });
}

if (require.main === module) {
    startApi()
}

module.exports = { startApi }