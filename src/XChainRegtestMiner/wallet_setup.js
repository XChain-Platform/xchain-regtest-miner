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
    PER_CALL_FEE_RATE_COINS,
    SETTXFEE_COINS,
    FEE_RATE_REFUSING_COINS,
    logger,
} = require('./constants.js');
const { trySetTxFee } = require('./settxfee_probe.js');
const { loadWalletOnce, WALLET_LOAD_MAX_ATTEMPTS, WALLET_LOAD_RETRY_INTERVAL_MS } = require('./wallet_load.js');
const { probeWalletAddress, bindProbedWallet } = require('./wallet_probe.js');

function recordFundingFeeMechanism(mechanism, reprobeNeeded = false) {
    this.fundingFeeMechanism = mechanism;
    this.fundingFeePinnedAt = Date.now();
    this.fundingFeeReprobeNeeded = reprobeNeeded;
    return mechanism;
}

function usePerCallFundingFeeRate() {
    this.fundingFeeRateSatPerVb = FUNDING_FEE_RATE_SAT_PER_VB;
    logger.info(
        'Funding sends pinned to ' +
            FUNDING_FEE_RATE_SAT_PER_VB +
            ' sat/vB via the per-call fee_rate argument (settxfee is gone as of Bitcoin Core 31)',
    );
    return recordFundingFeeMechanism.call(this, 'fee_rate');
}

// Settles the startup balance read. A wallet prepareWallet found empty is mined
// to coinbase maturity and polled for a spendable balance, throwing when it never
// arrives; then the read is stamped and the funding fee rate pinned. The mining,
// the stamp and the pin share this one async body so the final balance check, the
// stamp and the opening run of the pin stay one synchronous run: across two async
// functions a turn would separate them, and a concurrent flow could land there.
function runtimeRecoveryMayMine() {
    return this.keepMining && !this.fillMempoolRunning && this._reorgPauseDepth === 0;
}

function warmupDeferredError() {
    const err = new Error(
        'wallet recreated on the node; maturity warmup is deferred until mining resumes after the pause, fill, or reorg',
    );
    err.warmupDeferred = true;
    return err;
}

async function settleStartupBalance({ runtimeRecovery = false } = {}) {
    if (this.balance <= 0) {
        logger.info('Mining blocks to get balance in the wallet');
        // Always mine to coinbase-maturity depth regardless of current chain
        // height: fewer blocks (e.g. a single one on an aged chain) would only
        // add an immature coinbase (spendable after 100 confirmations), leaving
        // the balance at 0 while walletReady is about to be set true. The
        // bounded balance re-poll below is the real readiness guard.
        // Startup may bypass the runtime gates. Recovery rechecks them at the
        // queue append point and records the maturity work for the mine loop.
        if (runtimeRecovery && !runtimeRecoveryMayMine.call(this)) {
            this._walletWarmupPending = true;
            throw warmupDeferredError();
        }
        try {
            await this.generateBlocksQueued(101);

            // Re-poll the balance in a bounded loop instead of trusting the
            // mining call: ping/status export walletReady as the readiness
            // oracle, so it must reflect an observed spendable balance, not
            // just that a mining RPC was issued.
            const BALANCE_POLL_MAX_ATTEMPTS = 10;
            const BALANCE_POLL_INTERVAL_MS = 1000;
            for (let attempt = 1; attempt <= BALANCE_POLL_MAX_ATTEMPTS; attempt++) {
                this.balance = await this.connector.getBalance();
                if (this.balance > 0) {
                    break;
                }
                if (attempt < BALANCE_POLL_MAX_ATTEMPTS) {
                    await this.sleep(BALANCE_POLL_INTERVAL_MS);
                }
            }

            if (this.balance <= 0) {
                throw new Error('Wallet balance still 0 after mining to maturity; cannot mark wallet ready');
            }
        } catch (err) {
            if (runtimeRecovery) this._walletWarmupPending = true;
            throw err;
        }
    }

    // Stamp the startup read so the auto-mine loop's cadence starts one full
    // interval from here rather than firing a redundant getbalance on its very
    // first tick, which would also null the balance just measured on any venue
    // whose connector answers that call less reliably than this one just did.
    this._balanceReadAt = Date.now();

    await this.pinFundingFeeRate();
}

async function prepareWalletFunding(options) {
    logger.info('Getting a new address to receive blocks reward');
    this.walletAddress = await this.connector.getNewAddress();
    logger.info('Checking wallet balance');
    this.balance = await this.connector.getBalance();
    await settleStartupBalance.call(this, options);
}

async function recoverRuntimeWallet() {
    const outcome = await this.ensureWalletLoaded();
    if ((!outcome || !outcome.created) && !this._walletWarmupPending) {
        await this.pinFundingFeeRate();
        return;
    }
    this.walletReady = false;
    this._walletWarmupPending = true;
    await prepareWalletFunding.call(this, { runtimeRecovery: true });
    this._walletWarmupPending = false;
    this.walletReady = true;
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
     *
     * Only a loadwallet "not found" (-18) creates the wallet: an existing wallet
     * answers createwallet with "Database already exists" forever. Any other
     * failure is retried within WALLET_LOAD_MAX_ATTEMPTS, checking listwallets.
     */
    async ensureWalletLoaded() {
        const walletName = this.walletNameParam;
        for (let attempt = 1; attempt <= WALLET_LOAD_MAX_ATTEMPTS; attempt++) {
            const outcome = await loadWalletOnce.call(this, walletName);
            if (outcome) {
                this.connector.setWalletName(walletName);
                return outcome;
            }
            if (attempt < WALLET_LOAD_MAX_ATTEMPTS) {
                logger.warn(
                    `Wallet '${walletName}' not confirmed loaded (attempt ${attempt}/${WALLET_LOAD_MAX_ATTEMPTS}); retrying the load`,
                );
                await this.sleep(WALLET_LOAD_RETRY_INTERVAL_MS);
            }
        }
        throw new Error(`Could not load wallet '${walletName}' on regtest node: the node never confirmed it loaded`);
    },

    async reloadWallet() {
        if (this.walletReloadInFlight) return this.walletReloadInFlight;
        const outcome = recoverRuntimeWallet.call(this).then(
            () => ({ ok: true, error: null }),
            (error) => ({ ok: false, error }),
        );
        const tracked = outcome.finally(() => {
            if (this.walletReloadInFlight === tracked) this.walletReloadInFlight = null;
        });
        this.walletReloadInFlight = tracked;
        return tracked;
    },

    async sendFundsToAddress(address, amount) {
        if (typeof address !== 'string' || address.length === 0) {
            throw new Error('Invalid address: must be a non-empty string');
        }
        if (typeof amount !== 'number' || !isFinite(amount) || amount <= 0) {
            throw new Error('Invalid amount: must be a positive finite number');
        }
        try {
            return await this.connector.sendToAddress(address, amount, this.fundingFeeRateSatPerVb);
        } catch (err) {
            // A node RESTARTED under a long-running miner comes back with no
            // wallet loaded, and the wallet is bootstrapped exactly once, at
            // miner startup. Every funding call then fails forever while
            // mining keeps working, because generatetoaddress reuses the
            // address cached before the restart - so the venue looks alive and
            // is unusable. Measured 2026-08-11: BTC regtest sat like this for
            // 30 hours and read, from the outside, as an unexplained
            // "Error sending funds to address".
            if (!err || !err.walletMissing) throw err;
            logger.info('Wallet is no longer loaded on the node (restarted?); reloading and retrying once');
            const recovery = await this.reloadWallet();
            if (!recovery.ok) throw recovery.error;
            return await this.connector.sendToAddress(address, amount, this.fundingFeeRateSatPerVb);
        }
    },

    async createWallet(walletName) {
        try {
            await this.connector.createWallet(walletName);
            return true;
        } catch (err) {
            throw new Error('Error creating wallet: ' + (err && err.message ? err.message : err));
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
     * Bitcoin Core 31 DELETED the RPC. On BTC that call answers method-not-found,
     * and "best effort, fall back to the estimate" silently gives the ceiling up
     * on exactly the chain that needs it. Core 0.21 added a per-call fee_rate
     * argument to sendtoaddress as the replacement, so BTC pins per call instead.
     * LTC v0.21 and DOGE v1.14 keep settxfee and pin wallet-wide; only DOGE v1.14
     * lacks fee_rate, so an LTC daemon whose settxfee is missing, or stays
     * unreachable through its retries, moves to the per-call rate.
     *
     * A refusal (any other RPC code, or a reply that is not true) stays on the
     * positional no-rate form for every coin: the daemon rejected the rate itself,
     * so the same rate per call is no ceiling to rely on and the estimate remains.
     *
     * The unknown-coin case is neither: NETWORK may be a bare 'regtest' with no
     * coin half. Those try settxfee first and switch to the per-call rate only on
     * method-not-found, so a Core 31 node keeps a ceiling. A timeout or transport
     * failure is retried, and one that outlives its retries stays on the positional
     * no-rate form, since a DOGE node refuses fee_rate.
     *
     * A re-pin after a wallet reload that cannot reach settxfee keeps a per-call
     * rate already in force: only the wallet-wide settxfee pin is lost on reload.
     *
     * Records the mechanism and whether a transient failure needs a later recovery probe.
     * @returns {Promise<'fee_rate'|'settxfee'|'none'>} the mechanism in force
     */
    async pinFundingFeeRate() {
        const coin = String(this.network || '')
            .split('-')[0]
            .toLowerCase();

        if (PER_CALL_FEE_RATE_COINS.includes(coin)) {
            return usePerCallFundingFeeRate.call(this);
        }

        const answer = await trySetTxFee.call(this);
        if (answer === true) {
            // Leave the per-call rate null: the wallet-wide pin already caps the
            // send, and DOGE v1.14 refuses a fee_rate argument.
            this.fundingFeeRateSatPerVb = null;
            logger.info(
                'Pinned wallet fee rate to ' +
                    FUNDING_FEE_RATE_COINS_PER_KB +
                    '/kB via settxfee (regtest estimatesmartfee bypass)',
            );
            return recordFundingFeeMechanism.call(this, 'settxfee');
        }
        const takesFeeRate = SETTXFEE_COINS.includes(coin) && !FEE_RATE_REFUSING_COINS.includes(coin);
        if (answer === 'unreachable' && takesFeeRate) {
            // Nothing is known about the rate, and this daemon accepts fee_rate, so keep a ceiling.
            logger.warn('settxfee could not be reached on this ' + coin + ' daemon; pinning fee_rate per call');
            return usePerCallFundingFeeRate.call(this);
        }
        if (answer === 'unreachable' && this.fundingFeeRateSatPerVb != null) {
            // A re-pin after a wallet reload: the per-call rate holds no wallet state, so keep it.
            logger.warn('settxfee could not be reached on re-pin; keeping the per-call fee_rate already in force');
            return recordFundingFeeMechanism.call(this, 'fee_rate');
        }
        if (answer === 'refused' || answer === 'unreachable') {
            // Stay on the positional no-rate form, which every supported daemon accepts.
            this.fundingFeeRateSatPerVb = null;
            logger.warn('settxfee could not be confirmed on this daemon; funding sends use the fee estimate');
            return recordFundingFeeMechanism.call(this, 'none', answer === 'unreachable');
        }

        if (FEE_RATE_REFUSING_COINS.includes(coin)) {
            // Stay positional on a daemon that refuses fee_rate (DOGE v1.14).
            this.fundingFeeRateSatPerVb = null;
            logger.info('settxfee not found on this ' + coin + ' daemon; funding sends use the fee estimate');
            return recordFundingFeeMechanism.call(this, 'none');
        }
        // Surface the daemon change: a coin that shipped settxfee losing it means a new release.
        if (SETTXFEE_COINS.includes(coin))
            logger.warn('settxfee not found on this ' + coin + ' daemon; pinning fee_rate per call');
        return usePerCallFundingFeeRate.call(this);
    },

    async prepareWallet() {
        logger.info('Checking wallet availability');

        const probeAddress = await probeWalletAddress.call(this);

        if (probeAddress == null) {
            await this.ensureWalletLoaded();
            await prepareWalletFunding.call(this);
        } else {
            // Probe succeeded; make sure the wallet that answered is ours before using it
            this.walletAddress = await bindProbedWallet.call(this, probeAddress);
            logger.info('Checking wallet balance');
            this.balance = await this.connector.getBalance();
            await settleStartupBalance.call(this);
        }

        // Wallet is fully prepared (address assigned, coinbase matured): wallet-dependent
        // RPCs (generateToAddress) are safe from here. Callers gate on this via ping/status,
        // closing the cold-start race where ping returned success before walletAddress was set.
        //
        // Startup-completion, except while a wallet created during runtime recovery is
        // assigned a new mining address and warmed to maturity. A simulated reorg deep
        // enough to disconnect the matured coinbase leaves this true while the wallet can no
        // longer fund a send, so a reorg drill must read wallet_funded / wallet_balance from
        // status rather than wallet_ready. Whether this flag should instead become
        // a live fund-capability oracle is an open call, because the container health probe
        // reads it as startup-completion () and would report the miner degraded for
        // the duration of every deliberate reorg drill. The published contract says
        // startup-completion as well (xchain-documentation, components/regtest-miner/
        // operations.md, the wallet_ready row of the status field table), so redefining this
        // flag is a docs change in a separate repo rather than a local one.
        this.walletReady = true;
    },
};
