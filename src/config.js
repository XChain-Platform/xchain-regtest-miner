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
 ********************************************************************/

'use strict';

// The one place outside src/api.js (the process entry point) that may read
// process.env: CODE-STYLE.md, Module shape. A module-load-time process.env
// read anywhere else is a violation the structure gate catches.

// codemod:env-entries

// The node RPC client's request timeout in ms, coerced here because it crosses
// into axios as a number: anything but a plain non-negative integer falls back to
// 60s (axios reads NaN as no timeout, a negative throws in the socket, and
// parseInt would read "60s" as 60ms). 0 stays 0, axios's own "no timeout".
const DEFAULT_NODE_RPC_TIMEOUT_MS = 60000;
const rawNodeRpcTimeout = String(process.env.NODE_RPC_TIMEOUT ?? '').trim();
const NODE_RPC_TIMEOUT_MS = /^\d+$/.test(rawNodeRpcTimeout)
    ? parseInt(rawNodeRpcTimeout, 10)
    : DEFAULT_NODE_RPC_TIMEOUT_MS;

module.exports = { NODE_RPC_TIMEOUT_MS };
