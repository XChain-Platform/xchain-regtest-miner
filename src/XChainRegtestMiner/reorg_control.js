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
 * XChain Regtest Miner - Reorg Control
 *
 * Invalidate and reconsider blocks, plus the reorg mine-hold and pause
 * windows that keep mining out of a reorg, installed onto the XChainRegtestMiner prototype.
 *
 ********************************************************************/

'use strict';


module.exports = {
    // Invalidates a block by hash, triggering a node-side rollback to the fork
    // point. Auto-mining is paused beforehand so the miner does not race ahead
    // with new blocks while the reorg is being constructed; callers must call
    // continueMining() when done.
    async invalidateBlock(blockHash) {
        if (typeof blockHash !== 'string' || blockHash.length === 0) {
            throw new Error('invalidateBlock: blockHash must be a non-empty string')
        }
        // Raised before the pause barrier, not after it: a mine appended while
        // pauseMining() is draining would otherwise run the instant the drain
        // resolves, overlapping the invalidate below.
        const mineHold = this.enterReorgMineHold()
        let result
        try {
            await this.pauseMining()
            result = await this.connector.invalidateBlock(blockHash)
        } finally {
            this.exitReorgMineHold(mineHold)
        }
        // A deep invalidate is exactly the case that can strand the wallet at 0.
        await this.refreshWalletFunds()
        return result
    },

    // Re-enables consideration of a block invalidateBlock marked invalid, letting the
    // node resolve which chain is longest. Should be called after the competing
    // branch is mined and before continueMining().
    async reconsiderBlock(blockHash) {
        if (typeof blockHash !== 'string' || blockHash.length === 0) {
            throw new Error('reconsiderBlock: blockHash must be a non-empty string')
        }
        // Take the same mine-barrier invalidateBlock takes, so the node never
        // re-evaluates the chain while a generateToAddress is in flight. Under the
        // documented invalidate -> mine branch -> reconsider flow mining is already
        // paused and this is a no-op; it is a standalone reconsider (or one issued
        // after continue_mining) that could otherwise race a mine into the node's
        // reorg. Prior auto-mining state is restored afterwards: unlike invalidate,
        // reconsider is the END of the reorg sequence, so leaving the miner paused
        // here would silently stall a caller that never calls continueMining().
        //
        // The restore is conditional on no OPERATOR pause having landed meanwhile.
        // A pause_mining RPC landing inside the awaited body below sets the flag
        // false and answers "ok"; an unconditional restore then flipped it back
        // and put the auto-mine loop live inside the height-deterministic section
        // that operator had just been told was serialized. Scoping that condition
        // to "nothing bumped the generation" instead was worse: a second
        // reconsider_block bumps it too, and then NEITHER call restored and the
        // miner stalled for good. enterReorgPause/exitReorgPause share one
        // refcounted pause between concurrent reconsiders so only a foreign
        // mutation cancels the restore.
        this.enterReorgPause()
        // Raised synchronously alongside the pause, so a mine appended while the
        // barrier below drains cannot run against the node's re-evaluation.
        const mineHold = this.enterReorgMineHold()
        // Dropped as soon as the node call returns rather than in the finally, so
        // the balance re-read below does not keep mines waiting; the finally still
        // covers every early exit. exitReorgMineHold is a no-op on a second call.
        const dropMineHold = () => this.exitReorgMineHold(mineHold)
        try {
            // Same barrier pauseMining takes, drained inside the try so a rejected
            // in-flight mine still releases the reorg pause.
            await this._generateQueue
            const result = await this.connector.reconsiderBlock(blockHash)
            dropMineHold()
            // The reorg terminus, so this is where a restored balance shows up.
            await this.refreshWalletFunds()
            return result
        } finally {
            dropMineHold()
            this.exitReorgPause()
        }
    },

    // Raise a mine-vs-reorg hold and return its id. Called SYNCHRONOUSLY at the top
    // of a reorg primitive, before its first await, so no mine can be appended
    // between the decision to reorg and the hold becoming visible.
    enterReorgMineHold(){
        const id = ++this._reorgMineHoldSeq
        let release
        const held = new Promise((resolve) => { release = resolve })
        this._reorgMineHolds.set(id, { held, release })
        return id
    },

    // Drop one hold, releasing the mines that snapshotted it. Always called from a
    // finally, so a rejected reorg RPC never leaves the miner unable to mine.
    exitReorgMineHold(id){
        const hold = this._reorgMineHolds.get(id)
        if (!hold) return
        this._reorgMineHolds.delete(id)
        hold.release()
    },

    // Wait out the reorgs that were already in flight when this mine was queued,
    // then mine. `heldBy` is the append-time snapshot, never a live read: a reorg
    // raised after the append is itself waiting on this mine, so waiting on it back
    // would deadlock. After the last await there is no yield before generateBlocksRaw,
    // whose first statement dispatches generatetoaddress synchronously, so a reorg
    // raised meanwhile cannot slip its own RPC in ahead of this one.
    async mineWhenReorgIdle(count, heldBy){
        for (const held of heldBy) await held
        return this.generateBlocksRaw(count)
    },

    // Synchronous half of pauseMining: clear the flag and claim the generation
    // with no await between them, so no other writer can slot in and be mistaken
    // for this pause.
    claimPause(){
        this.keepMining = false
        return ++this._miningStateGeneration
    },

    // Claim, or join, the shared reorg pause. The first reconsider in flight
    // records whether auto-mining was live; a concurrent one inherits that record
    // rather than snapshotting the paused state the first one just installed
    // (snapshotting it is what stalled the miner). Inheritance is dropped when a
    // foreign writer moved the generation since the last reorg pause: whatever
    // the operator did most recently is then the state to honour.
    enterReorgPause(){
        const inherit = this._reorgPauseDepth > 0
            && this._miningStateGeneration === this._reorgPauseGeneration
        if (!inherit) this._reorgPauseWasMining = this.keepMining
        this._reorgPauseDepth++
        this._reorgPauseGeneration = this.claimPause()
    },

    // Release one hold on the reorg pause. Only the last one out restores, so a
    // nested reconsider never hands the chain back to the auto-mine loop while an
    // outer one is still mid-reorg. Returns whether it restored.
    exitReorgPause(){
        if (this._reorgPauseDepth > 0) this._reorgPauseDepth--
        if (this._reorgPauseDepth > 0) return false
        const restore = this._reorgPauseWasMining
            && this._miningStateGeneration === this._reorgPauseGeneration
        this._reorgPauseWasMining = false
        if (restore){
            this.keepMining = true
            this._miningStateGeneration++
        }
        return restore
    }
}
