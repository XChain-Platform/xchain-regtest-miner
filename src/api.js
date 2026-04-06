/*********************************************************************
 * 
 * Copyright © 2025 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC – https://dankest.llc
 *
 * Licensed under the Dankest Community License (Apache License 2.0 + Additional Terms).
 * You may not use this file except in compliance with that License.
 * 
 * A copy of the License is available at:
 *     https://dankest.llc/license
 *
 * This software is provided “AS IS”, without warranties or conditions of any kind.
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


const NETWORK = process.env.NETWORK
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
    if (!validNetworks.includes(process.env.NETWORK)) {
        console.error('NETWORK must be one of: ' + validNetworks.join(', '))
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
    const miner = new XChainRegtestMiner(NETWORK, NODE_URL, NODE_PORT, NODE_USER, NODE_PASSWORD);
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
                return {"error":"There was a problem trying to fill the mempool"}
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