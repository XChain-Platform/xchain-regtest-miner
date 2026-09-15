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
 * XChain Regtest Miner - Wallet Setup
 *
 * Wallet load and create, funding sends and the funding fee-rate pin,
 * installed onto the XChainRegtestMiner prototype.
 *
 ********************************************************************/

'use strict';

const {
    FUNDING_FEE_RATE_COINS_PER_KB,
    FUNDING_FEE_RATE_SAT_PER_VB,
    SETTXFEE_COINS,
    logger
} = require('./constants.js')

// The wallet-availability probe prepareWallet opens with. Resolves the probed
// address, or null when every attempt failed and the load/create path must run.
async function probeWalletAddress(){
    // Probe with getNewAddress: succeeds whenever ANY wallet is usable,
    // including modern Bitcoin Core 0.17+ with an already-loaded named
    // wallet, or legacy single-wallet chains (Dogecoin v1.14.x, older
    // Litecoin) that auto-load a default wallet and don't implement
    // createwallet / loadwallet / listwallets at all.
    //
    // Retry the probe for a few seconds because legacy daemons accept
    // RPC requests before their wallet has finished loading. Dogecoin
    // v1.14 in particular reliably loses this race on the first start
    // after a fresh `xchain-node reset` (the miner crashes because
    // `createWallet` as the fallback isn't supported on DOGE). A handful
    // of 1-second retries covers wallet load in practice.
    let probeAddress = null
    const PROBE_MAX_ATTEMPTS = 10
    const PROBE_INTERVAL_MS  = 1000
    for (let attempt = 1; attempt <= PROBE_MAX_ATTEMPTS; attempt++) {
        try {
            probeAddress = await this.connector.getNewAddress()
            break
        } catch(err){
            if (attempt < PROBE_MAX_ATTEMPTS) {
                await this.sleep(PROBE_INTERVAL_MS)
            }
            // After the last attempt, fall through to the load/create path.
        }
    }
    return probeAddress
}

// Settles the startup balance read. A wallet prepareWallet found empty is mined
// to coinbase maturity and polled for a spendable balance, throwing when it never
// arrives; then the read is stamped and the funding fee rate pinned. The mining,
// the stamp and the pin share this one async body so the final balance check, the
// stamp and the opening run of the pin stay one synchronous run: across two async
// functions a turn would separate them, and a concurrent flow could land there.
async function settleStartupBalance(){
    if (this.balance <= 0){
        logger.info("Mining blocks to get balance in the wallet")
        // Always mine to coinbase-maturity depth regardless of current chain
        // height: fewer blocks (e.g. a single one on an aged chain) would only
        // add an immature coinbase (spendable after 100 confirmations), leaving
        // the balance at 0 while walletReady is about to be set true. The
        // bounded balance re-poll below is the real readiness guard.
        // Private entry point: start() runs this warmup without awaiting while the API
        // is already listening, so a fill_mempool arriving during it must not
        // turn wallet preparation into a boot failure.
        await this.generateBlocksQueued(101)

        // Re-poll the balance in a bounded loop instead of trusting the
        // mining call: ping/status export walletReady as the readiness
        // oracle, so it must reflect an observed spendable balance, not
        // just that a mining RPC was issued.
        const BALANCE_POLL_MAX_ATTEMPTS = 10
        const BALANCE_POLL_INTERVAL_MS = 1000
        for (let attempt = 1; attempt <= BALANCE_POLL_MAX_ATTEMPTS; attempt++) {
            this.balance = await this.connector.getBalance()
            if (this.balance > 0){
                break
            }
            if (attempt < BALANCE_POLL_MAX_ATTEMPTS) {
                await this.sleep(BALANCE_POLL_INTERVAL_MS)
            }
        }

        if (this.balance <= 0){
            throw new Error("Wallet balance still 0 after mining to maturity; cannot mark wallet ready")
        }
    }

    // Stamp the startup read so the auto-mine loop's cadence starts one full
    // interval from here rather than firing a redundant getbalance on its very
    // first tick, which would also null the balance just measured on any venue
    // whose connector answers that call less reliably than this one just did.
    this._balanceReadAt = Date.now()

    await this.pinFundingFeeRate()
}

module.exports = {
    /**
     * Loads the named wallet, creating it if the node has never seen it, and
     * pins the connector to it.
     *
     * Split out of the startup path so `sendFundsToAddress` can re-run it. The
     * daemon that reaches here supports named wallets (Bitcoin Core 0.17+);
     * pinning via /wallet/<name>/ URI routing keeps subsequent wallet RPCs
     * (sendtoaddress, getbalance) working even if extra wallets get loaded on
     * the same node later. Legacy single-wallet chains (Dogecoin v1.14.x) never
     * take this path - their probe succeeds on the base URL.
     */
    async ensureWalletLoaded(){
        let walletLoaded = false
        try {
            await this.connector.loadWallet(this.walletNameParam)
            walletLoaded = true
        } catch(err){
            //The named wallet couldn't be loaded (may not exist, or RPC unsupported)
        }

        if (!walletLoaded){
            logger.info("Wallet not found. Creating a new wallet")
            try{
                await this.createWallet(this.walletNameParam)
            } catch(err){
                throw new Error(`Could not create wallet '${this.walletNameParam}' on regtest node (chain may not support createwallet RPC, e.g. Dogecoin v1.14.x): ${err.message}`)
            }
        }
        this.connector.setWalletName(this.walletNameParam)
    },

    async sendFundsToAddress(address, amount){
        if (typeof address !== 'string' || address.length === 0) {
            throw new Error('Invalid address: must be a non-empty string')
        }
        if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
            throw new Error('Invalid amount: must be a positive finite number')
        }
        try {
            return await this.connector.sendToAddress(address, amount, this.fundingFeeRateSatPerVb)
        } catch (err) {
            // A node RESTARTED under a long-running miner comes back with no
            // wallet loaded, and the wallet is bootstrapped exactly once, at
            // miner startup. Every funding call then fails forever while
            // mining keeps working, because generatetoaddress reuses the
            // address cached before the restart - so the venue looks alive and
            // is unusable. Measured 2026-08-11: BTC regtest sat like this for
            // 30 hours and read, from the outside, as an unexplained
            // "Error sending funds to address".
            if (!err || !err.walletMissing) throw err
            logger.info('Wallet is no longer loaded on the node (restarted?); reloading and retrying once')
            await this.ensureWalletLoaded()
            return await this.connector.sendToAddress(address, amount, this.fundingFeeRateSatPerVb)
        }
    },

    async createWallet(walletName){
        try {
            await this.connector.createWallet(walletName)
            return true
        } catch(err){
            throw new Error('Error creating wallet: ' + (err && err.message ? err.message : err))
        }
    },

    /**
     * Give funding sends (sendtoaddress) a fixed fee ceiling, by whichever
     * mechanism this coin's daemon actually implements.
     *
     * Why a ceiling at all: on a matured regtest chain estimatesmartfee inflates
     * to absurd values (observed 0.49 LTC/kB after ~1200 blocks of fee history).
     * The wallet then computes a fee above the daemon's -maxtxfee ceiling and
     * rejects the send with RPC error -6, which reads from the outside as
     * funded-address tests failing for no reason late in a long run.
     *
     * Why two mechanisms: settxfee (wallet-wide, set once) was the ceiling, and
     * Bitcoin Core 31 DELETED the RPC. On BTC that call just answers false,
     * and "best effort, fall back to the estimate" silently gives the ceiling up
     * on exactly the chain that needs it. Core 0.21 added a per-call fee_rate
     * argument to sendtoaddress as the replacement, so BTC pins per call instead.
     * LTC v0.21 and DOGE v1.14 have no fee_rate and keep settxfee.
     *
     * The unknown-coin case is neither: NETWORK may be a bare 'regtest' with no
     * coin half. Those try settxfee first (harmless and correct on the legacy
     * daemons that cannot take fee_rate) and fall back to the per-call rate when
     * the daemon answers no, so a Core 31 node reached through a bare NETWORK
     * keeps a ceiling rather than reverting to the estimate.
     *
     * @returns {Promise<'fee_rate'|'settxfee'|'none'>} the mechanism in force
     */
    async pinFundingFeeRate(){
        const coin = String(this.network || '').split('-')[0].toLowerCase()

        const useFeeRate = () => {
            this.fundingFeeRateSatPerVb = FUNDING_FEE_RATE_SAT_PER_VB
            logger.info('Funding sends pinned to ' + FUNDING_FEE_RATE_SAT_PER_VB +
                ' sat/vB via the per-call fee_rate argument (settxfee is gone as of Bitcoin Core 31)')
            return 'fee_rate'
        }

        if (coin === 'bitcoin') {
            return useFeeRate()
        }

        const pinned = await this.connector.setTxFee(FUNDING_FEE_RATE_COINS_PER_KB)
        if (pinned) {
            // Leave the per-call rate null: these daemons have no fee_rate
            // argument and a named-param send would fail outright.
            this.fundingFeeRateSatPerVb = null
            logger.info('Pinned wallet fee rate to ' + FUNDING_FEE_RATE_COINS_PER_KB +
                '/kB via settxfee (regtest estimatesmartfee bypass)')
            return 'settxfee'
        }

        if (SETTXFEE_COINS.includes(coin)) {
            // A coin known NOT to have fee_rate: there is no second mechanism to
            // try, so say so instead of claiming a ceiling that is not there.
            this.fundingFeeRateSatPerVb = null
            logger.info('settxfee not honored by this daemon and ' + coin +
                ' has no fee_rate argument; funding sends use the fee estimate')
            return 'none'
        }

        return useFeeRate()
    },

    async prepareWallet(){
        logger.info("Checking wallet availability")

        const probeAddress = await probeWalletAddress.call(this)

        if (probeAddress == null){
            await this.ensureWalletLoaded()
            logger.info("Getting a new address to receive blocks reward")
            this.walletAddress = await this.connector.getNewAddress()
        } else {
            // Probe succeeded; wallet is already usable, use that address
            this.walletAddress = probeAddress
        }

        logger.info("Checking wallet balance")
        this.balance = await this.connector.getBalance()

        await settleStartupBalance.call(this)

        // Wallet is fully prepared (address assigned, coinbase matured): wallet-dependent
        // RPCs (generateToAddress) are safe from here. Callers gate on this via ping/status,
        // closing the cold-start race where ping returned success before walletAddress was set.
        //
        // Startup-completion only, and never re-evaluated afterwards: a simulated reorg deep
        // enough to disconnect the matured coinbase leaves this true while the wallet can no
        // longer fund a send, so a reorg drill must read wallet_funded / wallet_balance from
        // status rather than wallet_ready. Whether this flag should instead become
        // a live fund-capability oracle is an open call, because the container health probe
        // reads it as startup-completion () and would report the miner degraded for
        // the duration of every deliberate reorg drill. The published contract says
        // startup-completion as well (xchain-documentation, components/regtest-miner/
        // operations.md, the wallet_ready row of the status field table), so redefining this
        // flag is a docs change in a separate repo rather than a local one.
        this.walletReady = true
    }
}
