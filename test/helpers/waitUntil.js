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
 * Poll-until helper for tests that must wait for a condition.
 *
 * The one synchronization primitive: a test waits for the post-condition
 * it actually cares about, never for a fixed number of milliseconds that
 * happened to be long enough on the author's machine.
 *
 * REJECTS on timeout, and that is the whole point. The predecessor of this
 * helper returned false instead, so every call site that did not capture
 * and assert the return value waited zero-to-timeout milliseconds and then
 * continued regardless: a flaky test converted to one that passes
 * unconditionally, which is strictly worse than the flake. If this helper
 * is ever changed to resolve on timeout, every discarded-return call site
 * silently stops testing anything.
 *
 * A deliberate delay is NOT this helper's job. When the elapsed time is
 * itself the thing under test (a debounce window, a rate-limit interval, a
 * TTL expiry, a "stays quiet for N ms" negative assertion), keep the timer
 * and say in a comment why the wall clock is load-bearing.
 */

const POLL_INTERVAL_MS = 20

/**
 * Polls `predicate` until it returns truthy, then resolves `true`.
 *
 * @param {() => (boolean|Promise<boolean>)} predicate Condition to poll. May be async.
 * @param {number} [timeoutMs] Deadline, in ms, after which the wait rejects.
 * @param {string} [label] What is being waited for; appears in the timeout message.
 * @returns {Promise<true>} Resolves true once the predicate is satisfied.
 * @throws {Error} If the deadline passes with the predicate still unsatisfied.
 */
async function waitUntil(predicate, timeoutMs = 5000, label = 'condition') {
    const start = Date.now()
    let lastError = null

    for (;;) {
        try {
            if (await predicate()) return true
            lastError = null
        } catch (err) {
            // A predicate reading state mid-mutation can throw. Keep polling, but
            // carry the last throw into the timeout message instead of swallowing it.
            lastError = err
        }

        if (Date.now() - start >= timeoutMs) {
            const cause = lastError
                ? ' (predicate last threw: ' + lastError.message + ')'
                : ''
            throw new Error(
                'waitUntil timed out after ' + timeoutMs + 'ms waiting for ' + label + cause)
        }

        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    }
}

module.exports = waitUntil
