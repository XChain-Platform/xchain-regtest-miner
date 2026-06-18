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
 * PerformanceCollector: timing collection, percentile computation, and summary reporting.
 *
 * Records latency samples for named metrics, computes statistical summaries,
 * and produces formatted text tables for CI output.
 */

class PerformanceCollector {
    constructor(label) {
        this.label = label
        this._samples = {} // name → [ms, ms, ...]
    }

    /**
     * Record a pre-measured duration.
     * @param {string} name - metric name
     * @param {number} ms - duration in milliseconds
     */
    record(name, ms) {
        if (!this._samples[name]) this._samples[name] = []
        this._samples[name].push(ms)
    }

    /**
     * Time an async operation and record its latency.
     * @param {string} name - metric name
     * @param {Function} asyncFn - async function to measure
     * @returns {Promise<{result: *, latencyMs: number}>}
     */
    async measure(name, asyncFn) {
        const t0 = Date.now()
        const result = await asyncFn()
        const latencyMs = Date.now() - t0
        this.record(name, latencyMs)
        return { result, latencyMs }
    }

    /**
     * Monkey-patch an object's method to auto-record latency on every call.
     * @param {Object} obj - target object
     * @param {string} methodName - method to wrap
     */
    wrapMethod(obj, methodName) {
        const collector = this
        const original = obj[methodName].bind(obj)
        obj[methodName] = async function (...args) {
            const t0 = Date.now()
            const result = await original(...args)
            collector.record(methodName, Date.now() - t0)
            return result
        }
    }

    /**
     * Run multiple async functions concurrently, recording each individually.
     * @param {string} name - metric name for individual measurements
     * @param {Function[]} asyncFns - array of async functions
     * @returns {Promise<{results: Array, latencies: number[]}>}
     */
    async measureConcurrent(name, asyncFns) {
        const wallStart = Date.now()
        const entries = await Promise.all(asyncFns.map(async (fn) => {
            const { result, latencyMs } = await this.measure(name, fn)
            return { result, latencyMs }
        }))
        this.record(name + ':wall', Date.now() - wallStart)
        return {
            results: entries.map(e => e.result),
            latencies: entries.map(e => e.latencyMs),
        }
    }

    /**
     * Get computed metrics for a named metric.
     * @param {string} name
     * @returns {{name, count, min, max, mean, p50, p95, p99, samples}}
     */
    getMetrics(name) {
        const samples = this._samples[name]
        if (!samples || samples.length === 0) {
            return { name, count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0, samples: [] }
        }

        const sorted = [...samples].sort((a, b) => a - b)
        const count = sorted.length
        const sum = sorted.reduce((a, b) => a + b, 0)

        return {
            name,
            count,
            min: sorted[0],
            max: sorted[count - 1],
            mean: Math.round(sum / count * 100) / 100,
            p50: percentile(sorted, 0.50),
            p95: percentile(sorted, 0.95),
            p99: percentile(sorted, 0.99),
            samples: sorted,
        }
    }

    /**
     * Get all recorded metric names.
     * @returns {string[]}
     */
    getMetricNames() {
        return Object.keys(this._samples)
    }

    /**
     * Produce a formatted text summary of all metrics.
     * @returns {string}
     */
    summary() {
        const names = this.getMetricNames()
        if (names.length === 0) return `[${this.label}] No metrics recorded.\n`

        const header = `  ${'Metric'.padEnd(35)} ${'Count'.padStart(6)} ${'Min'.padStart(8)} ${'Mean'.padStart(8)} ${'P50'.padStart(8)} ${'P95'.padStart(8)} ${'P99'.padStart(8)} ${'Max'.padStart(8)}`
        const sep = '  ' + '-'.repeat(header.length - 2)

        const rows = names.map(name => {
            const m = this.getMetrics(name)
            return `  ${name.padEnd(35)} ${String(m.count).padStart(6)} ${fmt(m.min).padStart(8)} ${fmt(m.mean).padStart(8)} ${fmt(m.p50).padStart(8)} ${fmt(m.p95).padStart(8)} ${fmt(m.p99).padStart(8)} ${fmt(m.max).padStart(8)}`
        })

        return `\n  [${this.label}] Performance Summary (ms)\n${sep}\n${header}\n${sep}\n${rows.join('\n')}\n${sep}\n`
    }
}

function percentile(sorted, p) {
    if (sorted.length === 0) return 0
    if (sorted.length === 1) return sorted[0]
    const idx = p * (sorted.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    if (lo === hi) return sorted[lo]
    return Math.round((sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo])) * 100) / 100
}

function fmt(n) {
    return typeof n === 'number' ? n.toFixed(1) : String(n)
}

module.exports = PerformanceCollector
