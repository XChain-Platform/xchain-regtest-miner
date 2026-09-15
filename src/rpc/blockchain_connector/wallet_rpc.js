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
 **********************************************************************/

const axios = require('axios');
const { logger } = require('./constants');

function buildSendToAddressData(address, amount, feeRateSatPerVb) {
    // Use POSITIONAL params for sendtoaddress, not named. Named-parameter
    // JSON-RPC is a Bitcoin Core 0.18+ feature. Dogecoin v1.14.x is
    // based on Bitcoin Core 0.14 and rejects named-param calls (returns
    // an error or empty response, which manifests as "There was a problem
    // sending funds" in the API layer). Positional works on every
    // supported chain (BTC v28.x, LTC v0.21.x, DOGE v1.14.x).
    //
    // Drop the `verbose: true` flag too; that is also 0.18+ and changes
    // the response shape from "<txid string>" to {"txid":"<...>","fee":...}.
    // Keeping the bare-string response form makes the code work on all
    // supported daemons.
    //
    // The fee_rate exception: when the caller passes a fee rate (BTC,
    // where settxfee no longer exists) the call goes out with NAMED
    // params instead. fee_rate is positional argument 10 of sendtoaddress,
    // so reaching it positionally would mean padding seven arguments whose
    // meaning differs between daemon versions; named params are safe here
    // precisely because this path is only taken on a daemon modern enough
    // to have fee_rate at all, which is far newer than the 0.18 named-param
    // floor. Legacy daemons are never given a rate and keep the positional form.
    const feeRate = (typeof feeRateSatPerVb === 'number' && isFinite(feeRateSatPerVb) && feeRateSatPerVb > 0)
        ? feeRateSatPerVb
        : null
    const data = {
        jsonrpc: '2.0',
        method: 'sendtoaddress',
        params: feeRate
            ? { address, amount, fee_rate: feeRate }
            : [address, amount],
        id: 1,
    }
    return data
}

module.exports = {
    async createWallet(walletName, tries = 50) {
        try {
            const data = {
                jsonrpc: '2.0',
                method: 'createwallet',
                params: [walletName],
                id: 1,
            }

            while (tries > 0){

                try{
                    const response = await axios.post(this.url, data, {
                        auth: {
                            username: this.rpcUser,
                            password: this.rpcPassword,
                        }
                    })

                    if (response.data.result) {
                        return response.data.result;
                    } else {
                        tries--
                    }
                } catch (err){
                    tries--
                }

                await this.sleep(1000)
            }

            throw new Error('Error creating wallet');
        } catch (error) {
            throw new Error('Error creating wallet');
        }
    },

    async getWalletInfo(maxRetries = 50){
        const data = {
            jsonrpc: '2.0',
            method: 'getwalletinfo',
            params: [],
            id: 1,
        }

        let response = null
        let attempts = 0
        while (attempts < maxRetries){
            attempts++
            try {
                response = await axios.post(this.walletEndpoint(), data, {
                    auth: {
                        username: this.rpcUser,
                        password: this.rpcPassword,
                    }
                })

                break
            } catch (error) {
                await this.sleep(1000)
            }
        }

        if (response === null) {
            throw new Error('Error getting wallet info: max retries exceeded');
        }

        if (response.data.result) {
            return response.data.result;
        } else {
            throw new Error('Error getting wallet info');
        }
    },

    async loadWallet(walletName){
        try {
            const data = {
                jsonrpc: '2.0',
                method: 'loadwallet',
                params: [walletName],
                id: 1,
            }

            const response = await axios.post(this.url, data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

            if (response.data.result) {
                return response.data.result;
            } else {
                throw new Error('Error loading wallet');
            }
        } catch (error) {
            throw new Error('Error loading wallet');
        }
    },

    async getNewAddress(){
        try {
            const data = {
                jsonrpc: '2.0',
                method: 'getnewaddress',
                params: [],
                id: 1,
            }

            const response = await axios.post(this.walletEndpoint(), data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

            if (response.data.result) {
                return response.data.result;
            } else {
                throw new Error('Error getting new address');
            }
        } catch (error) {
            throw new Error('Error getting new address');
        }
    },

    async getBalance(){
        try {
            const data = {
                jsonrpc: '2.0',
                method: 'getbalance',
                params: [],
                id: 1,
            }

            const response = await axios.post(this.walletEndpoint(), data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

            if (response.data.result !== null && response.data.result !== undefined && !isNaN(response.data.result)){
                return response.data.result;
            } else {
                throw new Error('Error getting balance');
            }
        } catch (error) {
            throw new Error('Error getting balance');
        }
    },

    // Pin a fixed wallet fee rate (coins/kB) so sendtoaddress never consults
    // estimatesmartfee. On a matured regtest chain estimatesmartfee inflates to
    // absurd values (observed 0.49 LTC/kB after ~1200 blocks of fee history),
    // and the wallet then computes a fee that exceeds the default -maxtxfee
    // ceiling and rejects funding sends with RPC error -6 ("Fee exceeds
    // maximum configured by user"). That silently broke every funded-address
    // test in the back half of a long e2e run. A fixed low rate is correct on
    // regtest where coins are valueless. Returns true on success.
    //
    // settxfee is a WALLET-WIDE pin and it is gone: Bitcoin Core 31 removed the
    // RPC outright, so on BTC this answers false forever and the caller
    // would silently drop back to the estimate path, losing the ceiling that is
    // the whole point of the pin. LTC v0.21 and DOGE v1.14 still honour it, so
    // this path stays for them; BTC uses the per-call fee_rate argument instead
    // (see setFundingFeeRate below). A daemon that rejects settxfee is tolerated
    // so callers can fall back rather than fail wallet preparation.
    async setTxFee(feePerKb){
        try {
            const data = { jsonrpc: '2.0', method: 'settxfee', params: [feePerKb], id: 1 }
            const response = await axios.post(this.walletEndpoint(), data, {
                auth: { username: this.rpcUser, password: this.rpcPassword }
            })
            return response.data && response.data.result === true
        } catch (error) {
            return false
        }
    },

    /**
     * @param {string} address destination
     * @param {number} amount  in coins
     * @param {number|null} [feeRateSatPerVb] per-call fee ceiling in sat/vB. This
     *   is the replacement for the wallet-wide settxfee pin on daemons that
     *   dropped that RPC (Bitcoin Core 31 deleted it). fee_rate was added to
     *   sendtoaddress in Core 0.21, so every supported BTC daemon takes it, and
     *   unlike settxfee it cannot be silently ignored: a daemon that does not
     *   know the argument fails the send loudly rather than quietly reverting to
     *   estimatesmartfee. Omit it (LTC/DOGE, which pin wallet-wide instead) for
     *   the bare positional call legacy daemons require.
     */
    async sendToAddress(address, amount, feeRateSatPerVb = null){
        try {
            const data = buildSendToAddressData(address, amount, feeRateSatPerVb)

            const response = await axios.post(this.walletEndpoint(), data, {
                auth: {
                    username: this.rpcUser,
                    password: this.rpcPassword,
                }
            })

            const result = response.data && response.data.result
            // sendtoaddress returns a bare txid string under positional params.
            // Still tolerate the verbose-object form {txid:...} in case a future
            // daemon returns it (e.g. if Bitcoin Core ever flips its default).
            if (typeof result === 'string' && result.length > 0) {
                return result
            }
            if (result && typeof result === 'object' && typeof result.txid === 'string') {
                return result.txid
            }
            const nodeErr = response.data && response.data.error
                ? (response.data.error.message || JSON.stringify(response.data.error))
                : 'no result, no error'
            // Log the node's own (safe) RPC error for diagnosis, but throw a static
            // message: a transport axios error.message leaks the RPC host:port, and the
            // sanitization security suite requires a clean static thrown message.
            logger.error('sendtoaddress returned no txid: ' + nodeErr)
            throw this.sendError(nodeErr)
        } catch (error) {
            if (error && error.walletMissing) throw error
            throw new Error('Error sending funds to address')
        }
    },

    /**
     * The static send failure, with ONE machine-readable bit attached.
     *
     * The message must stay static and contentless - a transport error leaks
     * the RPC host:port and the sanitization suite pins that - so the caller
     * has no way to tell a recoverable fault from a permanent one. It needs
     * exactly one: a node that has been restarted under a long-running miner
     * answers every `sendtoaddress` with "Requested wallet does not exist or
     * is not loaded", forever, because the wallet is bootstrapped once at
     * startup and nothing reloads it. A boolean discloses nothing and lets
     * `sendFundsToAddress` re-bootstrap without failing for days.
     */
    sendError(nodeErr) {
        const err = new Error('Error sending funds to address')
        if (/wallet does not exist or is not loaded/i.test(String(nodeErr))) {
            err.walletMissing = true
        }
        return err
    },
}
