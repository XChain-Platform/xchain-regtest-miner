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

async function startApi(){
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

		// Function to send funds to any address
		async send_funds({address, amount}) {
			let txid = null
		
			try {
				txid = await miner.sendFundsToAddress(address, amount)
			} catch(err){
				console.log(err)
				return {"error":"There was a problem sending "+amount+" to "+address}
			}

			// Return ok
			return {"result":txid}
		},
		
		// Function to fill the mempool with a specific number of transactions randomly created
		async fill_mempool({tx_quantity}) {
			try {
				await miner.fillMempool(tx_quantity)
			} catch(err){
				console.log(err)
				return {"error":"There was a problem trying to fill mempool with "+tx_quantity+" transactions"}
			}

			// Return ok
			return {"result":"ok"}
		},
		
		// Function to fill the mempool with a specific number of transactions randomly created
		async continue_mining({}) {
			try {
				await miner.continueMining()
			} catch(err){
				console.log(err)
				return {"error":"There was a problem trying to continue the mining"}
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

startApi()