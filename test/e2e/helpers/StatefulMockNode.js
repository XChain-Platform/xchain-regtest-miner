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
 * Stateful mock Bitcoin Core regtest node.
 *
 * Unlike MockRpcServer (which returns pre-programmed static responses),
 * this server maintains internal wallet, mempool, and chain state that
 * evolves as RPC methods are called, simulating a real bitcoind lifecycle.
 */

const express = require('express')
const crypto = require('crypto')
const bitcoin = require('bitcoinjs-lib')

const network = bitcoin.networks.regtest

class StatefulMockNode {
    constructor() {
        this.app = express()
        this.app.use(express.json())
        this.server = null
        this.port = null
        this.calls = []

        // ── Internal state ──────────────────────────────────────────
        this.wallet = { exists: false, loaded: false, name: null }
        this.addresses = []
        this.height = 0
        this.blocks = []          // [{hash, height, txids, previousHash}]
        this.mempool = []         // [{txid, hex}]
        this.transactions = {}    // txid → hex
        this.matureBalance = 0    // spendable balance (coinbases older than 100 blocks)
        this.pendingRewards = []  // [{height, amount}] (immature coinbase rewards)
        this.addressCounter = 0

        // ── RPC dispatch ────────────────────────────────────────────
        // Registered on both the base URL and the /wallet/<name> URI that the
        // connector switches to after setWalletName (Bitcoin Core 0.17+ style).
        this.app.post(['/', '/wallet/:walletName'], (req, res) => {
            const { method, params, id } = req.body
            this.calls.push({ method, params, id })

            const handler = this['_rpc_' + method]
            if (!handler) {
                return res.json({
                    jsonrpc: '2.0', result: null,
                    error: { code: -32601, message: `Method "${method}" not found` }, id,
                })
            }

            try {
                const result = handler.call(this, params)
                res.json({ jsonrpc: '2.0', result, error: null, id })
            } catch (err) {
                res.json({
                    jsonrpc: '2.0', result: null,
                    error: { code: err.rpcCode || -1, message: err.message }, id,
                })
            }
        })
    }

    // ── Server lifecycle ────────────────────────────────────────────

    async start() {
        return new Promise(resolve => {
            this.server = this.app.listen(0, '127.0.0.1', () => {
                this.port = this.server.address().port
                resolve()
            })
        })
    }

    async stop() {
        return new Promise(resolve => {
            if (this.server) {
                this.server.close(resolve)
                this.server = null
            } else {
                resolve()
            }
        })
    }

    reset() {
        this.calls = []
        this.wallet = { exists: false, loaded: false, name: null }
        this.addresses = []
        this.height = 0
        this.blocks = []
        this.mempool = []
        this.transactions = {}
        this.matureBalance = 0
        this.pendingRewards = []
        this.addressCounter = 0
    }

    callsFor(method) {
        return this.calls.filter(c => c.method === method)
    }

    /** Inject a transaction into the mempool externally (for test setup). */
    injectMempoolTx(txid, hex) {
        this.mempool.push({ txid, hex: hex || '0200000000' })
        this.transactions[txid] = hex || '0200000000'
    }

    // ── Helpers ─────────────────────────────────────────────────────

    _generateHash() {
        return crypto.randomBytes(32).toString('hex')
    }

    _generateAddress() {
        this.addressCounter++
        // Generate a deterministic-looking regtest address
        const buf = Buffer.alloc(20, 0)
        buf.writeUInt32BE(this.addressCounter, 16)
        return bitcoin.address.toBech32(buf, 0, 'bcrt')
    }

    _matureCoinbases() {
        const maturityThreshold = this.height - 100
        const matured = this.pendingRewards.filter(r => r.height <= maturityThreshold)
        for (const r of matured) {
            this.matureBalance += r.amount
        }
        this.pendingRewards = this.pendingRewards.filter(r => r.height > maturityThreshold)
    }

    /**
     * Build a minimal valid transaction hex with one output paying toAddress.
     * Used by sendtoaddress to produce parseable raw transactions.
     */
    _buildSimpleTx(toAddress, amountSats) {
        const tx = new bitcoin.Transaction()
        tx.version = 2
        const prevHash = Buffer.alloc(32, 0)
        prevHash[0] = 0x01
        prevHash.writeUInt32BE(this.addressCounter + this.height, 0)
        tx.addInput(prevHash, 0)
        tx.addOutput(bitcoin.address.toOutputScript(toAddress, network), amountSats)
        return { hex: tx.toHex(), txid: tx.getId() }
    }

    // ── RPC method handlers ─────────────────────────────────────────

    _rpc_getnetworkinfo() {
        return { version: 250000, subversion: '/Satoshi:25.0.0/', protocolversion: 70016 }
    }

    _rpc_getblockchaininfo() {
        return {
            chain: 'regtest',
            blocks: this.height,
            headers: this.height,
            bestblockhash: this.blocks.length > 0
                ? this.blocks[this.blocks.length - 1].hash
                : '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206',
        }
    }

    _rpc_getwalletinfo() {
        if (!this.wallet.loaded) {
            const err = new Error('No wallet is loaded')
            err.rpcCode = -18
            throw err
        }
        return {
            walletname: this.wallet.name,
            walletversion: 210000,
            balance: this.matureBalance / 100000000,
        }
    }

    _rpc_createwallet(params) {
        const name = Array.isArray(params) ? params[0] : params
        this.wallet = { exists: true, loaded: true, name }
        return { name, warning: '' }
    }

    _rpc_loadwallet(params) {
        const name = Array.isArray(params) ? params[0] : params
        if (!this.wallet.exists) {
            const err = new Error('Wallet file not found')
            err.rpcCode = -18
            throw err
        }
        this.wallet.loaded = true
        this.wallet.name = name
        return { name, warning: '' }
    }

    _rpc_getnewaddress() {
        // Wallet RPCs fail until a wallet is loaded, matching Bitcoin Core
        // 0.17+; the miner's getNewAddress probe relies on this to detect a
        // fresh node and fall through to the load/create path.
        if (!this.wallet.loaded) {
            const err = new Error('No wallet is loaded')
            err.rpcCode = -18
            throw err
        }
        const addr = this._generateAddress()
        this.addresses.push(addr)
        return addr
    }

    _rpc_settxfee() {
        // Fee pinning is best-effort in the miner; honor it like Bitcoin Core.
        return true
    }

    _rpc_getbalance() {
        this._matureCoinbases()
        return this.matureBalance / 100000000
    }

    _rpc_generatetoaddress(params) {
        const count = params[0]
        const address = params[1]
        const hashes = []

        for (let i = 0; i < count; i++) {
            this.height++
            const hash = this._generateHash()
            const previousHash = this.blocks.length > 0
                ? this.blocks[this.blocks.length - 1].hash
                : '0000000000000000000000000000000000000000000000000000000000000000'

            // Collect mempool txids into this block
            const txids = ['coinbase_' + this.height, ...this.mempool.map(m => m.txid)]

            this.blocks.push({ hash, height: this.height, txids, previousHash })
            hashes.push(hash)

            // Add coinbase reward (immature until 100 blocks later)
            this.pendingRewards.push({ height: this.height, amount: 5000000000 })

            // Clear mempool (all txs included in this block)
            this.mempool = []
        }

        this._matureCoinbases()
        return hashes
    }

    _rpc_getrawmempool() {
        return this.mempool.map(m => m.txid)
    }

    _rpc_sendtoaddress(params) {
        // Named params: {address, amount, verbose}
        const address = params.address || (Array.isArray(params) ? params[0] : null)
        const amount = params.amount || (Array.isArray(params) ? params[1] : 0)

        const amountSats = Math.round(amount * 100000000)

        // Deduct from balance
        if (this.matureBalance < amountSats) {
            const err = new Error('Insufficient funds')
            err.rpcCode = -6
            throw err
        }
        this.matureBalance -= amountSats

        // Build a real parseable transaction
        const { hex, txid } = this._buildSimpleTx(address, amountSats)
        this.mempool.push({ txid, hex })
        this.transactions[txid] = hex

        return { txid }
    }

    _rpc_sendrawtransaction(params) {
        const hex = Array.isArray(params) ? params[0] : params
        let txid
        try {
            const tx = bitcoin.Transaction.fromHex(hex)
            txid = tx.getId()
        } catch (e) {
            txid = this._generateHash()
        }
        this.mempool.push({ txid, hex })
        this.transactions[txid] = hex
        return txid
    }

    _rpc_getrawtransaction(params) {
        const txid = Array.isArray(params) ? params[0] : params
        const hex = this.transactions[txid]
        if (!hex) {
            const err = new Error('No such mempool or blockchain transaction')
            err.rpcCode = -5
            throw err
        }
        return hex
    }

    _rpc_getmempoolentry(params) {
        const txid = Array.isArray(params) ? params[0] : params
        const entry = this.mempool.find(m => m.txid === txid)
        if (!entry) {
            const err = new Error('Transaction not in mempool')
            err.rpcCode = -5
            throw err
        }
        return { vsize: 200, weight: 800, fee: 0.0001, time: Date.now() }
    }

    _rpc_getblockhash(params) {
        const index = Array.isArray(params) ? params[0] : params
        const block = this.blocks.find(b => b.height === index)
        if (!block) {
            const err = new Error('Block height out of range')
            err.rpcCode = -8
            throw err
        }
        return block.hash
    }

    _rpc_getblock(params) {
        const hash = Array.isArray(params) ? params[0] : null
        const block = this.blocks.find(b => b.hash === hash)
        if (!block) {
            const err = new Error('Block not found')
            err.rpcCode = -5
            throw err
        }
        // Return JSON format (verbosity >= 1)
        return {
            hash: block.hash,
            height: block.height,
            previousblockhash: block.previousHash,
            tx: block.txids,
            nTx: block.txids.length,
            time: Math.floor(Date.now() / 1000),
        }
    }
}

module.exports = StatefulMockNode
