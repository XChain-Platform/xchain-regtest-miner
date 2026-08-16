/*********************************************************************
 * test/unit/api-key-exemption.test.js
 *
 * When MINER_API_KEY is set, the read-only health/observability
 * methods (ping, status, health) must bypass the key gate. The bundled Docker
 * HEALTHCHECK POSTs `health` with no X-API-Key, so gating it would 401 every
 * probe and mark the container permanently unhealthy. (An earlier version of
 * this header cited a `depends_on: service_healthy` warmup contract; no compose
 * file in this tree makes the miner a depends_on target, so api.js dropped the
 * claim and this file follows it.)
 *
 * Asserts the exported exemption contract directly (no drift-prone mirror).
 *********************************************************************/

'use strict';

const assert = require('assert');
const { UNAUTHENTICATED_METHODS } = require('../../src/api');

describe('MINER_API_KEY exemption contract @regression', function () {
    it('exempts the healthcheck `ping` method', function () {
        assert.ok(UNAUTHENTICATED_METHODS.has('ping'),
            'ping must bypass the API-key gate or the Docker healthcheck 401s and the container goes permanently unhealthy');
    });

    it('exempts the read-only `status` method', function () {
        assert.ok(UNAUTHENTICATED_METHODS.has('status'));
    });

    it('exempts the `health` readiness probe the container healthcheck POSTs', function () {
        assert.ok(UNAUTHENTICATED_METHODS.has('health'),
            'health must bypass the API-key gate or the Docker HEALTHCHECK 401s on every interval');
    });

    it('does NOT exempt mutating/spend methods (the gate still protects them)', function () {
        for (const m of ['send_funds', 'fill_mempool', 'invalidate_block', 'continue_mining', 'set_mining_time']) {
            assert.ok(!UNAUTHENTICATED_METHODS.has(m), `${m} must still require the API key`);
        }
    });
});
