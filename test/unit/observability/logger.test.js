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
 * test/unit/observability/logger.test.js
 *
 * Pins the getLogger(name) contract: the [name] prefix, level to
 * console method routing, the fields second argument, the empty-line
 * call and the console.log fallback for a missing console method.
 *********************************************************************/

'use strict';

const assert = require('assert');
const sinon = require('sinon');
const { getLogger } = require('../../../src/observability/logger');

const CONSOLE_METHODS = ['debug', 'log', 'warn', 'error'];

function stubConsole() {
    const stubs = {};
    for (const m of CONSOLE_METHODS) stubs[m] = sinon.stub(console, m);
    return stubs;
}

describe('observability logger: shape and prefix', function () {
    afterEach(function () {
        sinon.restore();
    });

    it('returns debug, info, warn and error functions', function () {
        const logger = getLogger();
        for (const level of ['debug', 'info', 'warn', 'error']) {
            assert.strictEqual(typeof logger[level], 'function', `${level} must be a function`);
        }
    });

    it('prints an unnamed logger line with no prefix and one argument', function () {
        const c = stubConsole();
        getLogger().info('hi');
        sinon.restore();
        assert.ok(c.log.calledOnce);
        assert.deepStrictEqual(c.log.firstCall.args, ['hi']);
    });

    it('prefixes a named logger line with [name] and one space', function () {
        const c = stubConsole();
        getLogger('miner').info('hi');
        sinon.restore();
        assert.deepStrictEqual(c.log.firstCall.args, ['[miner] hi']);
    });

    it('keeps each named instance on its own prefix', function () {
        const c = stubConsole();
        getLogger('a').info('one');
        getLogger('b').info('two');
        sinon.restore();
        assert.deepStrictEqual(c.log.getCalls().map((call) => call.args[0]), ['[a] one', '[b] two']);
    });
});

describe('observability logger: level routing', function () {
    afterEach(function () {
        sinon.restore();
    });

    const ROUTES = [['debug', 'debug'], ['info', 'log'], ['warn', 'warn'], ['error', 'error']];
    for (const [level, method] of ROUTES) {
        it(`routes ${level} to console.${method} and no other console method`, function () {
            const c = stubConsole();
            getLogger('x')[level]('msg');
            sinon.restore();
            assert.ok(c[method].calledOnceWithExactly('[x] msg'), `console.${method} must receive the line`);
            for (const other of CONSOLE_METHODS.filter((m) => m !== method)) {
                assert.ok(c[other].notCalled, `console.${other} must not be called for ${level}`);
            }
        });
    }
});

describe('observability logger: fields, blank line and fallback', function () {
    afterEach(function () {
        sinon.restore();
    });

    it('passes an object, array or Error fields value as a second argument', function () {
        const err = new Error('boom');
        const values = [{ height: 7 }, ['a'], err];
        const c = stubConsole();
        const logger = getLogger('x');
        for (const fields of values) logger.info('msg', fields);
        sinon.restore();
        assert.strictEqual(c.log.callCount, values.length);
        values.forEach((fields, i) => {
            const args = c.log.getCall(i).args;
            assert.strictEqual(args.length, 2);
            assert.strictEqual(args[0], '[x] msg');
            assert.strictEqual(args[1], fields);
        });
    });

    it('drops a string, number, null or omitted fields value from the call', function () {
        const c = stubConsole();
        const logger = getLogger('x');
        logger.warn('msg', 'extra');
        logger.warn('msg', 42);
        logger.warn('msg', null);
        logger.warn('msg');
        sinon.restore();
        assert.strictEqual(c.warn.callCount, 4);
        for (const call of c.warn.getCalls()) assert.deepStrictEqual(call.args, ['[x] msg']);
    });

    it('emits a blank line for an empty message', function () {
        const c = stubConsole();
        getLogger().info('');
        sinon.restore();
        assert.deepStrictEqual(c.log.firstCall.args, ['']);
    });

    it('falls back to console.log when the mapped console method is absent', function () {
        const original = console.debug;
        const log = sinon.stub(console, 'log');
        try {
            console.debug = undefined;
            getLogger().debug('x');
        } finally {
            console.debug = original;
            sinon.restore();
        }
        assert.deepStrictEqual(log.firstCall.args, ['x']);
    });
});
