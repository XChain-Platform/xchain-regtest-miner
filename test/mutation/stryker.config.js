// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// @ts-check
'use strict'

const os = require('os')
const path = require('path')

const serviceRoot = path.resolve(__dirname, '..', '..')

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
  // ─── Mutation targets ────────────────────────────────────────────────────
  mutate: [
    'src/**/*.js',
  ],

  // ─── Test runner ─────────────────────────────────────────────────────────
  testRunner: 'mocha',

  mochaOptions: {
    // Includes: unit (root-level), smoke, boundary, security, integration, e2e
    // Excludes: performance, chaos, fuzz (too slow for mutation testing)
    spec: [
      'test/*.test.js',
      'test/smoke/**/*.test.js',
      'test/boundary/**/*.test.js',
      'test/security/**/*.test.js',
      'test/integration/**/*.test.js',
      'test/e2e/**/*.test.js',
    ],
    // Use a dedicated mocha config that sets timeout to 10s (instead of
    // the project default of --timeout 0 which would hang on infinite-loop mutations)
    config: 'test/mutation/.mocharc.stryker.yml',
    'no-package': true,
  },

  // ─── Coverage analysis ───────────────────────────────────────────────────
  // perTest maps each mutant to only the test(s) that cover it.
  // Note: require.cache clearing in afterEach may cause some NoCoverage
  // false positives. If this is a problem, switch to 'all'.
  coverageAnalysis: 'perTest',

  // ─── Reporting ───────────────────────────────────────────────────────────
  reporters: ['html', 'json', 'clear-text', 'progress'],
  htmlReporter: {
    fileName: 'reports/mutation/index.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/mutation.json',
  },

  // ─── Thresholds ──────────────────────────────────────────────────────────
  thresholds: {
    high: 90,
    low: 75,
    break: 60,
  },

  // ─── Concurrency ─────────────────────────────────────────────────────────
  concurrency: Math.max(1, os.cpus().length - 1),

  // ─── Mutators ────────────────────────────────────────────────────────────
  // Exclude StringLiteral: RPC method-name strings and error messages
  // generate enormous noise without meaningful test quality signal.
  mutator: {
    excludedMutations: ['StringLiteral'],
  },

  // ─── Misc ────────────────────────────────────────────────────────────────
  ignoreStatic: true,
  tempDirName: '.stryker-tmp',
}
