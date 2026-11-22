/*********************************************************************
 *
 * Copyright © 2025-2026 Dankest, LLC
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This file is part of XChain Platform. Licensed under the GNU Affero
 * General Public License v3.0 or later; see LICENSE.md.
 *
 **********************************************************************/
'use strict';

const assert = require('assert');

const { parseMochaReport } = require('../suite-title-map.js');

const REPORT = JSON.stringify({ stats: { tests: 1 }, tests: [{ fullTitle: 'a b', file: '/x/a.test.js' }] }, null, 2);

describe('bin/suite-title-map.js: reading the mocha json report out of stdout', () => {
    it('reads a bare report', () => {
        assert.deepStrictEqual(parseMochaReport(REPORT).tests[0].fullTitle, 'a b');
    });

    it('skips lines a spec logged before the report opened', () => {
        const out = `Idle mine every 1000ms\nReady.\n${REPORT}`;
        assert.deepStrictEqual(parseMochaReport(out).stats, { tests: 1 });
    });

    it('skips lines a leftover timer logged after the report closed', () => {
        const out = `Ready.\n${REPORT}Could not verify the wallet funding fee pin: x\n}\nmore\n`;
        assert.deepStrictEqual(parseMochaReport(out).tests.length, 1);
    });

    it('still refuses output that holds no report', () => {
        assert.throws(() => parseMochaReport('not json at all'), SyntaxError);
    });
});
