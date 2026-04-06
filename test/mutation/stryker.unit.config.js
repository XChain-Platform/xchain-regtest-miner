'use strict'

const base = require('./stryker.config.js')

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
module.exports = {
  ...base,
  mochaOptions: {
    ...base.mochaOptions,
    spec: ['test/*.test.js'],
  },
}
