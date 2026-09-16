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

// The node RPC client's request timeout, in milliseconds. Coerced here
// (not left to the read site) because the value crosses into axios as a
// number: a bad or missing env value falls back to 60s rather than NaN.
const NODE_RPC_TIMEOUT_MS = parseInt(process.env.NODE_RPC_TIMEOUT ?? '60000', 10);

module.exports = { NODE_RPC_TIMEOUT_MS };
