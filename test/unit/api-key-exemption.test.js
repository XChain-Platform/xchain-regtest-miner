/*********************************************************************
 * test/unit/api-key-exemption.test.js
 *
 * #5140: when MINER_API_KEY is set, the read-only health/observability
 * methods (ping, status) must bypass the key gate. The bundled Docker
 * HEALTHCHECK POSTs `ping` with no X-API-Key, so gating it would 401 every
 * probe and mark the container permanently unhealthy, stalling any
 * `depends_on: service_healthy` bring-up.
 *
 * Asserts the exported exemption contract directly (no drift-prone mirror).
 *********************************************************************/

'use strict';

const assert = require('assert');
const { UNAUTHENTICATED_METHODS } = require('../../src/api');

describe('MINER_API_KEY exemption contract (#5140) @regression', function () {
    it('exempts the healthcheck `ping` method', function () {
        assert.ok(UNAUTHENTICATED_METHODS.has('ping'),
            'ping must bypass the API-key gate or the Docker healthcheck 401s and the container goes permanently unhealthy');
    });

    it('exempts the read-only `status` method', function () {
        assert.ok(UNAUTHENTICATED_METHODS.has('status'));
    });

    it('does NOT exempt mutating/spend methods (the gate still protects them)', function () {
        for (const m of ['send_funds', 'fill_mempool', 'invalidate_block', 'continue_mining', 'set_mining_time']) {
            assert.ok(!UNAUTHENTICATED_METHODS.has(m), `${m} must still require the API key`);
        }
    });
});
