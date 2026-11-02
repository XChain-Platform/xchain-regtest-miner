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
 * XChain Regtest Miner - Mempool Fill
 *
 * Fills the mempool with funded stress transactions and refreshes the
 * observed wallet balance, installed onto the XChainRegtestMiner prototype.
 *
 ********************************************************************/

'use strict';

const bitcoin = require('bitcoinjs-lib');
const {
    WALLET_BALANCE_REFRESH_MS,
    MAX_FILL_MEMPOOL_QUANTITY,
    FUNDING_FEE_RATE_COINS_PER_KB,
    SETTXFEE_COINS,
    logger,
    ECPair,
} = require('./constants.js');
const { deriveFillKeys, fundMainAddress, findFundingUtxos } = require('./fill_plan.js');
const { confirmSplitTxs } = require('./split_confirmation.js');
const {
    startFillProgress,
    throwIfFillCancelled,
    enterFillPhase,
    noteStressSent,
    finishFillProgress,
    fillProgressSnapshot,
} = require('./fill_progress.js');

// Spends each funding utxo into one output per derived address, recording the
// signed tx and its txid on the utxo entry for the stress loop to spend.
async function splitFundingUtxos(
    utxos,
    { OUTPUTS_QUANTITY_PER_TX, AMOUNT_FOR_EACH_ADDRESS, FEE, network, address, addresses },
) {
    for (let nextUtxoIndex in utxos) {
        let nextUtxo = utxos[nextUtxoIndex];
        let utxoIndex = nextUtxo['utxoIndex'];
        let txid = nextUtxo['txid'];
        let rawTransaction = nextUtxo['rawTransaction'];
        let transaction = bitcoin.Transaction.fromHex(rawTransaction);

        //Create a single transaction with txQuantity outputs
        let psbt = new bitcoin.Psbt({ network: network });

        psbt.addInput({
            hash: txid,
            index: utxoIndex,
            // transaction.outs[n].sequence doesn't exist (.sequence is an
            // input field, not an output field); reading it always yields
            // undefined, which bitcoinjs-lib coerces to 0 (disabling RBF
            // signalling but also rejecting some nodes). Use the standard
            // final-sequence value instead.
            sequence: 0xffffffff,
            nonWitnessUtxo: Buffer.from(rawTransaction, 'hex'),
        });

        let total = 0;

        for (
            let nextAddressIndex = nextUtxoIndex * OUTPUTS_QUANTITY_PER_TX;
            nextAddressIndex < (parseInt(nextUtxoIndex) + 1) * OUTPUTS_QUANTITY_PER_TX &&
            nextAddressIndex < addresses.length;
            nextAddressIndex++
        ) {
            let nextAddress = addresses[nextAddressIndex];
            let nextAddressPayment = bitcoin.payments.p2pkh({ pubkey: nextAddress.publicKey, network }).address;
            let paymentAmount = AMOUNT_FOR_EACH_ADDRESS + FEE;

            total = total + paymentAmount;

            psbt.addOutput({
                address: nextAddressPayment,
                value: paymentAmount,
            });
        }

        let keyToSign = ECPair.fromPrivateKey(address.privateKey, { network });

        for (let nextInputIndex = 0; nextInputIndex < psbt.data.inputs.length; nextInputIndex++) {
            psbt.signInput(parseInt(nextInputIndex), keyToSign);
        }

        psbt.finalizeAllInputs();
        let extractedTransaction = psbt.extractTransaction();
        let txHex = extractedTransaction.toHex();

        nextUtxo['txHex'] = txHex;
        nextUtxo['txIdSource'] = await this.connector.sendRawTransaction(txHex);
    }
}

async function stressMempool(
    utxos,
    { OUTPUTS_QUANTITY_PER_TX, AMOUNT_FOR_EACH_ADDRESS, network, mainAddress, addresses },
) {
    // Creates txQuantity transactions to stress the mempool.
    for (let nextAddressIndex in addresses) {
        let nextAddress = addresses[nextAddressIndex];
        let psbt = new bitcoin.Psbt({ network: network });
        let paymentAmount = AMOUNT_FOR_EACH_ADDRESS;

        let utxoIndex = Math.floor(nextAddressIndex / OUTPUTS_QUANTITY_PER_TX);

        let txIdSource = utxos[utxoIndex]['txIdSource'];
        let txHex = utxos[utxoIndex]['txHex'];
        let outputIndex = nextAddressIndex % OUTPUTS_QUANTITY_PER_TX;

        psbt.addInput({
            hash: txIdSource,
            index: outputIndex,
            sequence: 0xffffffff,
            nonWitnessUtxo: Buffer.from(txHex, 'hex'),
        });

        psbt.addOutput({
            address: mainAddress,
            value: paymentAmount,
        });

        logger.info('Stressing the mempool with the transaction number ' + nextAddressIndex);

        let keyToSign = ECPair.fromPrivateKey(nextAddress.privateKey, { network });
        psbt.signInput(0, keyToSign);
        psbt.finalizeAllInputs();
        let outputTxHex = psbt.extractTransaction().toHex();

        throwIfFillCancelled.call(this);
        await this.connector.sendRawTransaction(outputTxHex);
        noteStressSent.call(this);
    }
}

// Reloads a wallet the node lost (restarted under the miner) from the read path, in the
// BACKGROUND: ensureWalletLoaded can retry for minutes, and refreshWalletFunds is awaited
// inline by the auto-mine loop, so awaiting it would stall mining on a wallet that will not load.
// Single-flight, at most one start per WALLET_BALANCE_REFRESH_MS, and never rejects.
function startWalletReload() {
    if (this.walletReloadInFlight) return this.walletReloadInFlight;
    const now = Date.now();
    if (this.walletReloadStartedAt != null && now - this.walletReloadStartedAt < WALLET_BALANCE_REFRESH_MS) return null;
    this.walletReloadStartedAt = now;
    logger.info('Wallet is no longer loaded on the node (restarted?); reloading it from the balance read');
    this.walletReloadInFlight = (async () => {
        try {
            await this.ensureWalletLoaded();
            // Re-pin after the reload: settxfee is in-memory wallet state on LTC/DOGE.
            await this.pinFundingFeeRate();
        } catch (err) {
            logger.info('Could not reload the wallet: ' + (err && err.message ? err.message : err));
        } finally {
            this.walletReloadInFlight = null;
        }
    })();
    return this.walletReloadInFlight;
}

// A legacy daemon can restart with its wallet loaded but its in-memory settxfee
// reset. Check in the background so a slow wallet RPC never stalls auto-mining.
function startFundingFeePinCheck() {
    const coin = String(this.network || '')
        .split('-')[0]
        .toLowerCase();
    if (!SETTXFEE_COINS.includes(coin) || this.fundingFeePinCheckInFlight) return null;
    this.fundingFeePinCheckInFlight = (async () => {
        try {
            const info = await this.connector.getWalletInfo(1);
            if (!info || info.paytxfee !== FUNDING_FEE_RATE_COINS_PER_KB) {
                await this.pinFundingFeeRate();
            }
        } catch (err) {
            logger.info('Could not verify the wallet funding fee pin: ' + (err && err.message ? err.message : err));
        } finally {
            this.fundingFeePinCheckInFlight = null;
        }
    })();
    return this.fundingFeePinCheckInFlight;
}

// Runs the claimed fill to its end, closing the progress record and releasing
// the mutex however it ends.
async function runFill(txQuantity) {
    try {
        await runFillPhases.call(this, txQuantity);
        finishFillProgress.call(this, null);
    } catch (err) {
        finishFillProgress.call(this, err || new Error(String(err)));
        throw err;
    } finally {
        this.fillMempoolRunning = false;
        this._fillRun = null;
    }
}

// The fill body. Each phase entry is a cancel point, as is every send loop inside.
async function runFillPhases(txQuantity) {
    // Mirror pauseMining's barrier: wait for any in-flight generateBlocks(1)
    // to settle before proceeding, so a mine that started just before the
    // flag flip can't land a new block while fillMempool is running.
    await this._generateQueue;
    logger.info('Filling mempool with ' + txQuantity + ' transactions');
    const plan = deriveFillKeys.call(this, txQuantity);

    enterFillPhase.call(this, 'funding');
    logger.info('Sending funds to the main address');
    const chunksTxids = await fundMainAddress.call(this, txQuantity, plan);
    const utxos = await findFundingUtxos.call(this, chunksTxids, plan);

    enterFillPhase.call(this, 'splitting');
    logger.info('Creating the transactions to send funds to those addresses');
    await splitFundingUtxos.call(this, utxos, plan);

    enterFillPhase.call(this, 'confirming');
    await confirmSplitTxs.call(this, utxos);

    enterFillPhase.call(this, 'stressing');
    await stressMempool.call(this, utxos, plan);
}

module.exports = {
    async fillMempool(txQuantity) {
        if (this.fillMempoolRunning) {
            logger.info('fillMempool is already running, rejecting concurrent call');
            throw new Error('fillMempool is already running');
        }

        if (!Number.isInteger(txQuantity) || txQuantity < 1) {
            try {
                logger.info('INVALID txQuantity: ' + txQuantity + '. Must be a positive integer.');
            } catch (e) {
                logger.info('INVALID txQuantity (non-printable value). Must be a positive integer.');
            }
            throw new Error('txQuantity must be a positive integer');
        }

        if (txQuantity > MAX_FILL_MEMPOOL_QUANTITY) {
            logger.info('txQuantity ' + txQuantity + ' exceeds maximum of ' + MAX_FILL_MEMPOOL_QUANTITY);
            throw new Error('txQuantity exceeds maximum of ' + MAX_FILL_MEMPOOL_QUANTITY);
        }

        // Claim the mutex synchronously, before the first await below. The
        // fillMempoolRunning guard at the top of this method and this assignment
        // must not straddle an await, or the guard is a no-op under real
        // concurrency: two fill_mempool RPCs arriving in the same tick would both
        // pass the guard (flag still false) while parked on the _generateQueue
        // barrier, then both run the stress body at once.
        this.fillMempoolRunning = true;
        this.keepMining = false; //Stop the mining so the txs stay in mempool
        this._miningStateGeneration++;
        this._operatorMiningGeneration++;
        startFillProgress.call(this, txQuantity);
        const run = runFill.call(this, txQuantity);
        this._fillRun = run.catch(() => {});
        return run;
    },

    // Asks the running fill to stop and waits until it has: the run ends after the
    // node call in flight, and its own fill_mempool call answers with a cancelled
    // error. Like a finished fill it leaves keepMining as it stands, so the miner
    // stays paused unless a continue_mining already landed; call continue_mining
    // to resume. With no fill running it answers cancelled: false and does nothing.
    async cancelFillMempool() {
        const run = this._fillRun;
        if (!this.fillMempoolRunning || !run) {
            return { cancelled: false, fill_mempool: fillProgressSnapshot.call(this) };
        }
        this._fillCancelRequested = true;
        logger.info('fill_mempool cancel requested; stopping after the node call in flight');
        await run;
        const progress = fillProgressSnapshot.call(this);
        return { cancelled: !!progress && progress.phase === 'cancelled', fill_mempool: progress };
    },

    // Re-reads the spendable balance so a reorg that disconnected the matured
    // coinbase, or a fill_mempool / send_funds run that drained the wallet,
    // becomes observable through status instead of silently outliving the flag
    // set at startup. Never throws: at the reorg termini it runs AFTER the reorg
    // RPC has already succeeded, so a failed balance read must not turn a
    // completed invalidate/reconsider into a rejected call, and in the auto-mine
    // loop a throw would kill mining outright. Deliberately does NOT
    // touch walletReady, which is a startup-completion flag; see the note where
    // prepareWallet sets it.
    //
    // Stamps _balanceReadAt on BOTH paths: it records the last read ATTEMPT, which
    // is what bounds staleness and what paces the loop's cadence guard. Stamping
    // only on success would let a node that keeps failing getbalance re-issue the
    // RPC on every 100ms loop tick.
    async refreshWalletFunds() {
        try {
            const observed = await this.connector.getBalance();
            this.balance = typeof observed === 'number' ? observed : null;
            if (this.balance !== null) startFundingFeePinCheck.call(this);
        } catch (err) {
            logger.info('Could not re-read the wallet balance: ' + (err && err.message ? err.message : err));
            this.balance = null;
            // A lost wallet is reloaded in the background, so the next read (one interval on) can
            // succeed: without it wallet_funded stayed false until a send happened to reload it.
            if (err && err.walletMissing) startWalletReload.call(this);
        }
        this._balanceReadAt = Date.now();
        return this.balance;
    },

    // True when the auto-mine loop owes a balance refresh. Split out as a
    // predicate (same shape as idleMineDue) because the interval guard is the
    // load-bearing part: the loop wakes every CHECK_BLOCK_DELAY_MS, so a guard
    // that mis-answers turns one RPC per 5s into ten per second.
    walletRefreshDue(now) {
        if (this._balanceReadAt == null) return true;
        return now - this._balanceReadAt >= WALLET_BALANCE_REFRESH_MS;
    },
};
