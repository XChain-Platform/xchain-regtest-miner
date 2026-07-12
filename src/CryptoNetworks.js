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
 * XChain Regtest Miner - Crypto Networks Class
 *
 * Thin adapter over the canonical coin registry (src/coins, vendored from
 * xchain-hub via bin/sync-coins.sh). The bitcoinjs network object comes from
 * the single source of truth instead of an in-file switch, matching the
 * pattern already used by xchain-decoder / xchain-encoder / xchain-utxo-tracker.
 * Unlike those repos, this legacy contract returns `undefined` for an
 * unrecognized network instead of throwing (dustThreshold is read straight
 * off the returned object by XChainRegtestMiner.js's fillMempool path).
 *
 ********************************************************************/

const coins = require('./coins');

// Split a "<fullname>-<network>" key (e.g. "bitcoin-mainnet") into a canonical
// {tick, net} pair, or null when it names no known coin/network.
function parseNetworkName(networkName){
    const s = String(networkName == null ? '' : networkName);
    const i = s.lastIndexOf('-');
    if(i < 0) return null;
    const tick = coins.FULL_NAME_TO_TICK[s.slice(0, i)];
    const net  = s.slice(i + 1);
    if(!tick || !coins.NETWORKS.includes(net)) return null;
    return { tick, net };
}

class CryptoNetworks {
    // bitcoinjs-lib network object (+ XChain relay overlays) for a network key.
    static getBitcoinJsNetwork(networkName){
        const p = parseNetworkName(networkName);
        return p ? coins.getCoinConfig(p.tick, p.net).net : undefined;
    }
}

module.exports = CryptoNetworks
