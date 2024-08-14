const BlockchainConnector = require('./BlockchainConnector.js')

const CHECK_BLOCK_DELAY_MS = 1000 //1 second to continously ask for new block when all has been parsed
const SATOSHI_UNIT = 100000000.0

const MAX_TIME_TO_MINE_TXS = 30000 //max 30 seconds to mine a block after the first tx is found in the mempool
const ADDED_TIME_TO_MINE_TXS = 5000 //5 seconds extra before mining a block every time a new tx appears in the mempool

class XChainRegtestMiner {
	constructor(network, nodeUrl, nodePort, nodeUser, nodePassword) {
      this.connector = new BlockchainConnector(nodeUrl, nodePort, nodeUser, nodePassword)
	  this.walletNameParam = "xchain_regtest_wallet"
    }
	
	async sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
	
	async sendFundsToAddress(address, amount){
		return new Promise(async (resolve, reject) => {
			try{
				await this.connector.sendToAddress(address, amount)
				
				resolve(true)
			} catch(err){
				reject(err)
			}
		})
	}
	
	async createWallet(walletName){
		return new Promise(async (resolve, reject) => {
			try{
				await this.connector.createWallet(this.walletNameParam)
				
				resolve(true)
			} catch(err){
				console.log(err)
				reject(false)
			}
		})
	}
	
	async prepareWallet(){
		console.log("Checking if there is a wallet already loaded")
		let walletInfo = null
		try {
			walletInfo = await this.connector.getWalletInfo()
		} catch(err){
			//Assume that any error means there isn't a wallet
		}
		
		if (walletInfo == null){ //There is no wallet
			console.log("Wallet not found. Creating a new wallet")
			try{
				await this.createWallet(this.walletNameParam)
			} catch(err){
				throw Error("Error when trying to create the wallet in the regtest node")
			}
		}
	
		//Get from the database the last address from the wallet
		console.log("Getting a new address to receive blocks reward")
		this.walletAddress = await this.connector.getNewAddress()
		
		console.log("Checking wallet balance")
		this.balance = await this.connector.getBalance()
		
		if (this.balance <= 0){
			console.log("Mining blocks to get balance in the wallet")
			let blockchainInfo = await this.connector.getBlockchainInfo()
			if (blockchainInfo["blocks"] <= 100){
				await this.generateBlocks(101)
			} else {
				await this.generateBlocks(1)
			}
		}
	}
	
	async generateBlocks(numberOfBlocks){
		await this.connector.generateToAddress(numberOfBlocks, this.walletAddress)
	}
	
	async start(){
		//Prepare the wallet
		await this.prepareWallet()
		
		//Loop to check if there are transactions in the mempool, if there are, then
		//Wait some time for new txs, if there is a new tx in that time, then extended the waiting time again
		//If there are no new tx in that time, then mine a block
		console.log("Ready. Checking for new txs")
		
		let lastRawMempoolLength = 0
		let initialStartToMine = 0
		let extendedStartToMine = 0
		
		while (true){
			if ((initialStartToMine > 0) && (extendedStartToMine > 0)){
				let timeNow = Date.now()
				let initialTimePassed = timeNow-initialStartToMine
				let extendedStartTime = timeNow-extendedStartToMine
				
				if ((initialTimePassed >= MAX_TIME_TO_MINE_TXS) || (extendedStartTime >= ADDED_TIME_TO_MINE_TXS)){
					try {
						await this.generateBlocks(1)
					} catch (err){
						console.log("There were problems generating a new block. Trying again later.")
						await this.sleep(CHECK_BLOCK_DELAY_MS)
						continue
					}
					
					initialStartToMine = 0
					extendedStartToMine = 0
					lastRawMempoolLength = 0
				}
			}
			
			let rawMempool = null
			try {
				rawMempool = await this.connector.getRawMempool()
			} catch (error){
				console.log("There were problems getting the mempool, trying again later.")
				await this.sleep(CHECK_BLOCK_DELAY_MS)
				continue
			}
			
			if (rawMempool.length > 0){
				if (rawMempool.length > lastRawMempoolLength){
					//there are new txs in the mempool
					if (initialStartToMine == 0){
						initialStartToMine = Date.now()
						extendedStartToMine = initialStartToMine
					} else {
						extendedStartToMine = Date.now()
					}
				}
			} else {
				initialStartToMine = 0
				extendedStartToMine = 0
				lastRawMempoolLength = 0
			}
			
			await this.sleep(CHECK_BLOCK_DELAY_MS)
		}
	}
}

module.exports = XChainRegtestMiner