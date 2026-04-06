/**
 * Performance assertion helpers.
 *
 * Provide descriptive failure messages including actual vs threshold values.
 * All use Node's assert internally.
 */

const assert = require('assert')

/**
 * Assert that the p95 latency for a metric is under a threshold.
 */
function assertP95Under(collector, name, thresholdMs) {
    const m = collector.getMetrics(name)
    assert.ok(m.count > 0, `${name}: no samples recorded`)
    assert.ok(
        m.p95 <= thresholdMs,
        `${name} p95 latency: ${m.p95}ms exceeds threshold ${thresholdMs}ms (count: ${m.count}, mean: ${m.mean}ms, max: ${m.max}ms)`
    )
}

/**
 * Assert that the mean latency for a metric is under a threshold.
 */
function assertMeanUnder(collector, name, thresholdMs) {
    const m = collector.getMetrics(name)
    assert.ok(m.count > 0, `${name}: no samples recorded`)
    assert.ok(
        m.mean <= thresholdMs,
        `${name} mean latency: ${m.mean}ms exceeds threshold ${thresholdMs}ms (count: ${m.count}, p95: ${m.p95}ms, max: ${m.max}ms)`
    )
}

/**
 * Assert that the max latency for a metric is under a threshold.
 */
function assertMaxUnder(collector, name, thresholdMs) {
    const m = collector.getMetrics(name)
    assert.ok(m.count > 0, `${name}: no samples recorded`)
    assert.ok(
        m.max <= thresholdMs,
        `${name} max latency: ${m.max}ms exceeds threshold ${thresholdMs}ms (count: ${m.count}, mean: ${m.mean}ms)`
    )
}

/**
 * Assert that throughput exceeds a minimum operations-per-second.
 */
function assertThroughputAbove(collector, name, minOpsPerSecond, durationMs) {
    const m = collector.getMetrics(name)
    assert.ok(m.count > 0, `${name}: no samples recorded`)
    const opsPerSecond = (m.count / durationMs) * 1000
    assert.ok(
        opsPerSecond >= minOpsPerSecond,
        `${name} throughput: ${opsPerSecond.toFixed(1)} ops/s below minimum ${minOpsPerSecond} ops/s (count: ${m.count}, duration: ${durationMs}ms)`
    )
}

/**
 * Assert that memory growth rate stays under a threshold (bytes per second).
 */
function assertNoMemoryLeak(sampler, maxGrowthBytesPerSecond) {
    const s = sampler.summarize()
    assert.ok(s.sampleCount > 1, 'MemorySampler: need at least 2 samples')
    assert.ok(
        s.heapGrowthRatePerSecond <= maxGrowthBytesPerSecond,
        `Heap growth rate: ${(s.heapGrowthRatePerSecond / 1024).toFixed(1)} KB/s exceeds threshold ${(maxGrowthBytesPerSecond / 1024).toFixed(1)} KB/s ` +
        `(delta: ${(s.heapUsedDelta / 1024).toFixed(1)} KB over ${(s.durationMs / 1000).toFixed(1)}s, ${s.sampleCount} samples)`
    )
}

/**
 * Assert that total heap growth stays under a threshold (bytes).
 */
function assertHeapDeltaUnder(sampler, maxDeltaBytes) {
    const s = sampler.summarize()
    assert.ok(s.sampleCount > 1, 'MemorySampler: need at least 2 samples')
    assert.ok(
        s.heapUsedDelta <= maxDeltaBytes,
        `Heap delta: ${(s.heapUsedDelta / 1024 / 1024).toFixed(2)} MB exceeds threshold ${(maxDeltaBytes / 1024 / 1024).toFixed(2)} MB ` +
        `(over ${(s.durationMs / 1000).toFixed(1)}s, ${s.sampleCount} samples)`
    )
}

module.exports = {
    assertP95Under,
    assertMeanUnder,
    assertMaxUnder,
    assertThroughputAbove,
    assertNoMemoryLeak,
    assertHeapDeltaUnder,
}
