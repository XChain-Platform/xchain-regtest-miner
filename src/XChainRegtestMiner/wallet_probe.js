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
 * XChain Regtest Miner - Wallet Probe
 *
 * The startup wallet-availability probe and the binding of the probed
 * wallet to the miner's own named wallet, installed via wallet_setup.js.
 *
 ********************************************************************/

'use strict';

const { logger, MULTI_WALLET_COINS, SINGLE_WALLET_COINS } = require('./constants.js');

// The wallet-availability probe prepareWallet opens with. Resolves the probed
// address, or null when every attempt failed and the load/create path must run.
async function probeWalletAddress() {
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
    let probeAddress = null;
    const PROBE_MAX_ATTEMPTS = 10;
    const PROBE_INTERVAL_MS = 1000;
    for (let attempt = 1; attempt <= PROBE_MAX_ATTEMPTS; attempt++) {
        try {
            probeAddress = await this.connector.getNewAddress();
            break;
        } catch (err) {
            if (attempt < PROBE_MAX_ATTEMPTS) {
                await this.sleep(PROBE_INTERVAL_MS);
            }
            // After the last attempt, fall through to the load/create path.
        }
    }
    return probeAddress;
}

// Binds the miner to its own named wallet after the base-URL probe succeeded and
// resolves the address to mine to. Known coins use their registered wallet model;
// a bare or unknown network is classified by whether listwallets is available.
async function bindProbedWallet(probeAddress) {
    let info = null;
    try {
        // Keep the retries low: the probe just answered on this same endpoint.
        info = await this.connector.getWalletInfo(3);
    } catch (err) {
        const coin = String(this.network || '')
            .split('-')[0]
            .toLowerCase();
        const knownMultiWallet = MULTI_WALLET_COINS.includes(coin);
        const knownSingleWallet = SINGLE_WALLET_COINS.includes(coin);
        const listedWallets = knownMultiWallet || knownSingleWallet
            ? null
            : await this.connector.listWallets();
        if (knownMultiWallet || Array.isArray(listedWallets)) {
            logger.warn('Could not identify the wallet on the base RPC URL; loading and pinning the configured wallet');
            await this.ensureWalletLoaded();
            return await this.connector.getNewAddress();
        }
        logger.warn('Could not read wallet info after a successful probe; using the legacy base RPC URL');
        return probeAddress;
    }

    // No walletname field means a legacy single-wallet daemon (Dogecoin v1.14).
    if (!info || typeof info.walletname !== 'string') {
        return probeAddress;
    }

    // Our wallet answered: pin it so a second wallet loaded later cannot break routing.
    if (info.walletname === this.walletNameParam) {
        this.connector.setWalletName(this.walletNameParam);
        return probeAddress;
    }

    // A foreign wallet answered (an empty name is Core's unnamed default wallet).
    logger.warn(
        `Probe was answered by wallet '${info.walletname}', not '${this.walletNameParam}'; loading and pinning ours`,
    );
    await this.ensureWalletLoaded();
    return await this.connector.getNewAddress();
}

module.exports = { probeWalletAddress, bindProbedWallet };
