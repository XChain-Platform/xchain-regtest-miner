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
 **********************************************************************
 * VENDORED BY COPY, byte-for-byte apart from the ignores block below, from
 * the platform's master eslint preset: a public clone of this repo has no
 * platform tree beside it to import from. Changes belong in the master
 * copy first and travel here as a re-vendor.
 */
'use strict';

const src = {
    files: ['src/**/*.js'],
    languageOptions: {
        ecmaVersion: 2023,
        sourceType: 'commonjs',
        globals: {
            require: 'readonly', module: 'writable', exports: 'writable', process: 'readonly', Buffer: 'readonly',
            __dirname: 'readonly', __filename: 'readonly', console: 'readonly', setTimeout: 'readonly',
            clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', setImmediate: 'readonly',
            URL: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly', AbortController: 'readonly',
        },
    },
    rules: {
        // Naming: camelCase everywhere except property keys, which carry
        // protocol fields and DB columns through one-to-one.
        camelcase: ['error', { properties: 'never', ignoreDestructuring: true, ignoreImports: true }],
        'no-underscore-dangle': ['error', { enforceInMethodNames: true, allowAfterThis: false, allowFunctionParams: false }],
        // Logging: one logger. Entry points override this below.
        'no-console': 'error',
        // Module shape: requires at the top, environment in config.js only,
        // one export shape per file.
        'no-restricted-syntax': ['error',
            {
                selector: ':function CallExpression[callee.name="require"][arguments.0.type="Literal"]',
                message: 'require() at the top of the file; inside a body only for a computed path (CODE-STYLE.md, Module shape)',
            },
            {
                selector: 'MemberExpression[object.name="process"][property.name="env"]',
                message: 'environment is read in config.js only (CODE-STYLE.md, Module shape)',
            },
        ],
        'prefer-const': 'error',
        'no-var': 'error',
        eqeqeq: ['error', 'smart'],
    },
};

const configAndEntry = {
    files: ['src/config.js', 'src/api.js', 'src/migrate.js', 'src/index.js', 'bin/**/*.js'],
    rules: {
        'no-console': 'off',
        'no-restricted-syntax': ['error',
            {
                selector: ':function CallExpression[callee.name="require"][arguments.0.type="Literal"]',
                message: 'require() at the top of the file; inside a body only for a computed path (CODE-STYLE.md, Module shape)',
            },
        ],
    },
};

const tests = {
    files: ['test/**/*.js'],
    languageOptions: src.languageOptions,
    rules: {
        camelcase: src.rules.camelcase,
        'no-underscore-dangle': src.rules['no-underscore-dangle'],
        'prefer-const': 'error',
        'no-var': 'error',
    },
};

// Repo-specific addition, not part of the shared preset: src/coins/ is
// hub-vendored (refreshed by sync-coins.sh, CODE-STYLE's "third-party or
// generated code already in a file" carve-out) and is not this repo's own
// text to lint clean.
const vendored = { ignores: ['src/coins/**'] };

module.exports = [vendored, src, configAndEntry, tests];
