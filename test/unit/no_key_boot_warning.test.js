/*********************************************************************
 *
 * Copyright © 2025-2026 Dankest, LLC
 * Based on XChain Platform by Dankest, LLC - https://dankest.llc
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md. A commercial
 * license (without AGPL source-disclosure terms) is available -
 * contact legal@dankest.llc.
 *
 *********************************************************************/

/*********************************************************************
 * test/unit/no-key-boot-warning.test.js
 *
 * Platform-wide no-API-key posture. Keyless is the regtest
 * default (fail-open), but the open state must be announced loudly at
 * boot. The warning lives inside startApi (only meaningful at startup),
 * so this is a source-level drift guard on the keyless branch.
 *********************************************************************/

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

describe('no-API-key boot warning @regression', function () {
    const src = fs.readFileSync(path.join(__dirname, '../../src/api.js'), 'utf8');

    it('warns at boot when MINER_API_KEY is unset', function () {
        assert.ok(/if\s*\(\s*!MINER_API_KEY\s*\)\s*\{\s*\n\s*console\.warn\(\s*'WARNING: MINER_API_KEY is not set/.test(src),
            'src/api.js must print a loud startup warning when MINER_API_KEY is unset (see operations/API_KEYS.md)');
    });

    it('the warning states authentication is disabled (fail-open)', function () {
        assert.ok(src.includes('authentication is DISABLED (open access)'),
            'warning must state the API is open');
    });
});
