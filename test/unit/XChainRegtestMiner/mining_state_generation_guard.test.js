// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..', '..', 'src');

function sourceFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const target = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(target);
        return entry.isFile() && entry.name.endsWith('.js') ? [target] : [];
    });
}

function miningStateWrites(files) {
    const writes = [];
    for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        const lines = text.split('\n');
        lines.forEach((line, index) => {
            if (/this\.keepMining\s*=(?!=)/.test(line)) {
                writes.push({ file, line: index + 1, kind: 'flag' });
            }
            if (/(?:\+\+this\._miningStateGeneration|this\._miningStateGeneration\+\+)/.test(line)) {
                writes.push({ file, line: index + 1, kind: 'generation' });
            }
        });
    }
    return writes;
}

describe('mining state generation guard', function () {
    it('keeps flag writes and generation bumps in the synchronous setter', function () {
        const writes = miningStateWrites(sourceFiles(SRC));
        const allowedFlag = path.join(SRC, 'XChainRegtestMiner', 'mining_schedule.js');
        const constructor = path.join(SRC, 'XChainRegtestMiner.js');
        const unexpected = writes.filter((write) => {
            if (write.kind === 'generation') return write.file !== allowedFlag;
            return write.file !== allowedFlag && write.file !== constructor;
        });

        assert.deepStrictEqual(unexpected, []);
        assert.deepStrictEqual(
            writes
                .filter((write) => write.file === allowedFlag)
                .map((write) => write.kind)
                .sort(),
            ['flag', 'generation'],
        );
        assert.strictEqual(
            writes.filter((write) => write.file === constructor && write.kind === 'flag').length,
            1,
            'the constructor owns exactly one initial flag value',
        );
    });

    it('CONTROL: reports a flag write that bypasses the setter', function () {
        const fixture = path.join(__dirname, 'bare-write-fixture.js');
        const original = fs.readFileSync;
        fs.readFileSync = (file, encoding) =>
            file === fixture ? 'function bypass() { this.keepMining = false; }\n' : original(file, encoding);
        try {
            assert.deepStrictEqual(miningStateWrites([fixture]), [{ file: fixture, line: 1, kind: 'flag' }]);
        } finally {
            fs.readFileSync = original;
        }
    });
});
