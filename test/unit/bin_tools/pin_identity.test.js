'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { buildIdentity, compare, hashFiles, serialize } = require('../../../bin/pin-identity.js');

const REPO_ROOT = path.resolve(__dirname, '../../..');

function sha256(relativePath) {
    const bytes = fs.readFileSync(path.join(REPO_ROOT, relativePath));
    return crypto.createHash('sha256').update(bytes).digest('hex');
}

describe('pin identity tool', () => {
    it('builds a fresh identity that compares equal to itself', () => {
        const identity = buildIdentity();

        assert.equal(identity.algorithm, 'sha256');
        assert.deepEqual(compare(identity, identity), []);
    });

    it('reports the coins section when exactly one file digest changes', () => {
        const fresh = buildIdentity();
        const target = 'src/coins/BTC.js';
        const changed = {
            ...fresh,
            coins: { ...fresh.coins, [target]: 'changed' },
        };
        const differingFiles = Object.keys(fresh.coins)
            .filter((file) => changed.coins[file] !== fresh.coins[file]);

        assert.deepEqual(Object.keys(changed.coins), Object.keys(fresh.coins));
        assert.deepEqual(differingFiles, [target]);
        assert.deepEqual(compare(changed, fresh), ['coins']);
    });

    it('hashes files in deterministic key order', () => {
        const first = 'src/coins/BTC.js';
        const second = 'src/coins/DOGE.js';
        const hashes = hashFiles([second, first]);

        assert.deepEqual(Object.keys(hashes), [first, second]);
        assert.deepEqual(hashes, {
            [first]: sha256(first),
            [second]: sha256(second),
        });
    });

    it('serializes deterministically with stable formatting and a final newline', () => {
        const identity = { algorithm: 'sha256', coins: { alpha: 'one', beta: 'two' } };
        const expected = '{\n  "algorithm": "sha256",\n  "coins": {\n    "alpha": "one",\n    "beta": "two"\n  }\n}\n';

        assert.equal(serialize(identity), expected);
        assert.equal(serialize(identity), serialize(identity));
    });
});
