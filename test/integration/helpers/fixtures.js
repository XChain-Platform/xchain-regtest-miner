// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const { BIP32Factory } = require('bip32')
const ecc = require('tiny-secp256k1')
const bip32 = BIP32Factory(ecc)
const bip39 = require('bip39')
const bitcoin = require('bitcoinjs-lib')

// Deterministic mnemonic — all derived keys/addresses are predictable across runs
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const network = bitcoin.networks.regtest

// Derive the same key hierarchy that fillMempool uses
const seed = bip39.mnemonicToSeedSync(MNEMONIC)
const root = bip32.fromSeed(seed)
const account = root.derivePath("m/44'/0'/0'/0")
const mainKeyNode = account.derive(0).derive(0)
const MAIN_ADDRESS = bitcoin.payments.p2pkh({ pubkey: mainKeyNode.publicKey, network }).address

// fillMempool constants (must match XChainRegtestMiner.js)
const OUTPUTS_QUANTITY_PER_TX = 2500
const AMOUNT_FOR_EACH_ADDRESS = 1000
const FEE = 1000
const SATOSHI_UNIT = 100000000.0

function deriveChildKey(index) {
    return account.derive(index + 1).derive(0)
}

function deriveChildAddress(index) {
    const key = deriveChildKey(index)
    return bitcoin.payments.p2pkh({ pubkey: key.publicKey, network }).address
}

/**
 * Build a synthetic funding transaction with an output paying `amountSats` to `toAddress`.
 * The transaction has a single dummy input (no real signature) which is fine because
 * bitcoinjs-lib's PSBT only inspects the *outputs* of the nonWitnessUtxo — it does not
 * re-validate the previous transaction's inputs.
 */
function createFundingTx(toAddress, amountSats) {
    const tx = new bitcoin.Transaction()
    tx.version = 2
    // Dummy input — non-zero hash so it isn't treated as coinbase
    const dummyHash = Buffer.alloc(32, 0)
    dummyHash[0] = 0x01
    tx.addInput(dummyHash, 0)
    // Real output to the target address
    tx.addOutput(bitcoin.address.toOutputScript(toAddress, network), amountSats)
    return {
        hex: tx.toHex(),
        txid: tx.getId(),
    }
}

/**
 * Compute the funding amount the miner will request for a given txQuantity and chunk.
 * Mirrors the calculation in fillMempool.
 */
function chunkFundingAmount(txQuantity, chunkIndex) {
    const txsChunksCount = Math.ceil(txQuantity / OUTPUTS_QUANTITY_PER_TX)
    let txRemainder = OUTPUTS_QUANTITY_PER_TX
    if (chunkIndex === txsChunksCount - 1) {
        const remainder = txQuantity % OUTPUTS_QUANTITY_PER_TX
        if (remainder > 0) txRemainder = remainder
    }
    return (AMOUNT_FOR_EACH_ADDRESS + FEE + 50) * txRemainder
}

// Sample RPC responses matching real Bitcoin Core output shapes
const RPC_RESPONSES = {
    WALLET_INFO: { walletname: 'xchain_regtest_wallet', walletversion: 210000, balance: 50.0 },
    WALLET_INFO_EMPTY: { walletname: 'xchain_regtest_wallet', walletversion: 210000, balance: 0 },
    BLOCKCHAIN_INFO_FRESH: { chain: 'regtest', blocks: 0, headers: 0, bestblockhash: '0f9188f13cb7b2c71f2a335e3a4fc328bf5beb436012afca590b1a11466e2206' },
    BLOCKCHAIN_INFO_MATURE: { chain: 'regtest', blocks: 200, headers: 200, bestblockhash: 'abc123' },
    BLOCKCHAIN_INFO_AT_100: { chain: 'regtest', blocks: 100, headers: 100, bestblockhash: 'def456' },
    NETWORK_INFO: { version: 250000, subversion: '/Satoshi:25.0.0/', protocolversion: 70016 },
    NEW_ADDRESS: 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080',
    BLOCK_HASHES: ['00000000000000000001a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3'],
    SEND_RESULT: { txid: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2' },
}

module.exports = {
    MNEMONIC,
    network,
    seed,
    root,
    account,
    mainKeyNode,
    MAIN_ADDRESS,
    OUTPUTS_QUANTITY_PER_TX,
    AMOUNT_FOR_EACH_ADDRESS,
    FEE,
    SATOSHI_UNIT,
    deriveChildKey,
    deriveChildAddress,
    createFundingTx,
    chunkFundingAmount,
    RPC_RESPONSES,
    bitcoin,
    bip39,
    bip32,
    ecc,
}
