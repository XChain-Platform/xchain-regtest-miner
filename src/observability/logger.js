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
 * The one logger. CODE-STYLE.md: "One logger, observability/logger.js,
 * with info, warn, error. Raw console.* is a violation outside bin/ and
 * the two process entry points."
 *
 * This repo is not one of the four that vendor xchain-hub's full
 * observability module (metrics registry, log shipping, HTTP
 * instrumentation): it has no Express metrics endpoint to wire and no
 * shipping transport, so none of that is worth carrying here. What is
 * carried is the same getLogger(name) SHAPE the vendored module exposes
 * in the repos that do carry it: a factory returning an instance with
 * debug/info/warn/error methods, console-backed, no new dependency.
 *
 * A caller that wants a fresh empty line still gets one: getLogger().info('')
 * calls straight through to console.log('').
 ********************************************************************/

'use strict';

const LEVEL_METHOD = { debug: 'debug', info: 'log', warn: 'warn', error: 'error' };

/**
 * @param {string} [name] optional label, prefixed on every line as [name]
 * @returns {{debug:function, info:function, warn:function, error:function}}
 */
function getLogger(name) {
    const prefix = name ? `[${name}] ` : '';
    const write = (level, msg, fields) => {
        const fn = console[LEVEL_METHOD[level]] || console.log;
        // Only pass fields through as a second console argument when it is a
        // non-null object (arrays and Error instances included); a string,
        // number or omitted fields prints as one line with no extra argument.
        if (fields && typeof fields === 'object') fn(`${prefix}${msg}`, fields);
        else fn(`${prefix}${msg}`);
    };
    return {
        debug: (msg, fields) => write('debug', msg, fields),
        info:  (msg, fields) => write('info', msg, fields),
        warn:  (msg, fields) => write('warn', msg, fields),
        error: (msg, fields) => write('error', msg, fields),
    };
}

module.exports = { getLogger };
