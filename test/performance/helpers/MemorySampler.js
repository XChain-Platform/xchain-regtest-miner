/*********************************************************************
 *
 * Copyright © 2025–2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC – https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available —
 * contact legal@dankest.llc.
 *
 **********************************************************************
 * MemorySampler — periodic process.memoryUsage() sampling for soak tests.
 *
 * Start/stop interval-based sampling, then summarize heap growth trends.
 */

class MemorySampler {
    constructor(intervalMs = 100) {
        this._intervalMs = intervalMs
        this._timer = null
        this._samples = []
        this._startTime = null
    }

    /** Begin sampling at the configured interval. */
    start() {
        this._startTime = Date.now()
        this.sample() // take an initial sample
        this._timer = setInterval(() => this.sample(), this._intervalMs)
    }

    /** Stop sampling. */
    stop() {
        if (this._timer) {
            clearInterval(this._timer)
            this._timer = null
        }
        this.sample() // take a final sample
    }

    /** Manually take a single sample. */
    sample() {
        const mem = process.memoryUsage()
        this._samples.push({
            t: Date.now(),
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal,
            rss: mem.rss,
            external: mem.external,
        })
    }

    /** Reset all samples for reuse. */
    reset() {
        this._samples = []
        this._startTime = null
    }

    /**
     * Compute a summary of the collected samples.
     * @returns {{heapUsedMin, heapUsedMax, heapUsedDelta, heapGrowthRatePerSecond,
     *            rssMax, externalMax, durationMs, sampleCount, samples}}
     */
    summarize() {
        const s = this._samples
        if (s.length === 0) {
            return {
                heapUsedMin: 0, heapUsedMax: 0, heapUsedDelta: 0,
                heapGrowthRatePerSecond: 0, rssMax: 0, externalMax: 0,
                durationMs: 0, sampleCount: 0, samples: [],
            }
        }

        const heapValues = s.map(x => x.heapUsed)
        const heapUsedMin = Math.min(...heapValues)
        const heapUsedMax = Math.max(...heapValues)
        const heapUsedDelta = s[s.length - 1].heapUsed - s[0].heapUsed
        const durationMs = s[s.length - 1].t - s[0].t
        const heapGrowthRatePerSecond = durationMs > 0
            ? (heapUsedDelta / durationMs) * 1000
            : 0

        return {
            heapUsedMin,
            heapUsedMax,
            heapUsedDelta,
            heapGrowthRatePerSecond,
            rssMax: Math.max(...s.map(x => x.rss)),
            externalMax: Math.max(...s.map(x => x.external)),
            durationMs,
            sampleCount: s.length,
            samples: s,
        }
    }
}

module.exports = MemorySampler
