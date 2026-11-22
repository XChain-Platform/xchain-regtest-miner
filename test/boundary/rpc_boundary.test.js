// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

const assert = require('assert');
const BlockchainConnector = require('../../src/rpc/blockchain_connector');
const { state, registerConnectorHooks, rpcSuccess, rpcNoResult } = require('../helpers/rpc_boundary_fixture');

describe('Boundary: RPC Retry and Response Shapes', function () {
    registerConnectorHooks();

    // ═══════════════════════════════════════════════════════════════════
    // createWallet retry boundaries
    // ═══════════════════════════════════════════════════════════════════

    describe('R-04: createWallet fails on exactly attempt 10 of 10', function () {
        it('throws after exhausting all 10 retries', async function () {
            state.axiosPostStub.rejects(new Error('always fails'));

            await assert.rejects(() => state.connector.createWallet('w', 10), /Error creating wallet/);
            assert.strictEqual(state.axiosPostStub.callCount, 10, 'Should attempt exactly 10 times');
        });
    });

    describe('R-05: createWallet succeeds on exactly attempt 10 of 10', function () {
        it('returns success on final retry', async function () {
            for (let i = 0; i < 9; i++) {
                state.axiosPostStub.onCall(i).rejects(new Error('fail'));
            }
            state.axiosPostStub.onCall(9).resolves(rpcSuccess({ name: 'w' }));

            const result = await state.connector.createWallet('w', 10);
            assert.deepStrictEqual(result, { name: 'w' });
            assert.strictEqual(state.axiosPostStub.callCount, 10);
        });
    });

    describe('R-06: createWallet fails once then succeeds', function () {
        it('returns success after 2 attempts', async function () {
            state.axiosPostStub.onFirstCall().rejects(new Error('busy'));
            state.axiosPostStub.onSecondCall().resolves(rpcSuccess({ name: 'w' }));

            const result = await state.connector.createWallet('w', 10);
            assert.deepStrictEqual(result, { name: 'w' });
            assert.strictEqual(state.axiosPostStub.callCount, 2);
        });
    });
});

describe('Boundary: RPC Retry and Response Shapes', function () {
    registerConnectorHooks();
    describe('createWallet with tries=1', function () {
        it('gets exactly one attempt', async function () {
            state.axiosPostStub.rejects(new Error('fail'));

            await assert.rejects(() => state.connector.createWallet('w', 1));
            assert.strictEqual(state.axiosPostStub.callCount, 1);
        });
    });

    describe('createWallet with tries=0', function () {
        it('throws immediately with zero tries (no attempts made)', async function () {
            await assert.rejects(() => state.connector.createWallet('w', 0), /Error creating wallet/);
            assert.strictEqual(state.axiosPostStub.callCount, 0, 'Should make zero attempts when tries=0');
        });
    });

    describe('createWallet with falsy result then success', function () {
        it('decrements tries on falsy result and retries', async function () {
            state.axiosPostStub.onFirstCall().resolves({ data: { result: null, error: null, id: 1 } });
            state.axiosPostStub.onSecondCall().resolves({ data: { result: null, error: null, id: 1 } });
            state.axiosPostStub.onThirdCall().resolves(rpcSuccess({ name: 'w' }));

            const result = await state.connector.createWallet('w', 5);
            assert.deepStrictEqual(result, { name: 'w' });
            assert.strictEqual(state.axiosPostStub.callCount, 3);
        });
    });
});

// ═══════════════════════════════════════════════════════════════════
// getWalletInfo retry boundaries
// ═══════════════════════════════════════════════════════════════════

describe('Boundary: RPC Retry and Response Shapes', function () {
    registerConnectorHooks();
    describe('R-07: getWalletInfo fails many times then succeeds', function () {
        it('succeeds after N failures (bounded by maxRetries)', async function () {
            // Fail 9 times, succeed on 10th
            for (let i = 0; i < 9; i++) {
                state.axiosPostStub.onCall(i).rejects(new Error('not ready'));
            }
            state.axiosPostStub.onCall(9).resolves(rpcSuccess({ walletname: 'w' }));

            const result = await state.connector.getWalletInfo(10);
            assert.deepStrictEqual(result, { walletname: 'w' });
            assert.strictEqual(state.axiosPostStub.callCount, 10);
        });
    });

    describe('getWalletInfo with maxRetries=1', function () {
        it('gets exactly one attempt', async function () {
            state.axiosPostStub.rejects(new Error('fail'));

            await assert.rejects(() => state.connector.getWalletInfo(1), /max retries exceeded/);
            assert.strictEqual(state.axiosPostStub.callCount, 1);
        });
    });

    describe('getWalletInfo with maxRetries=0', function () {
        it('throws immediately with zero retries', async function () {
            await assert.rejects(() => state.connector.getWalletInfo(0), /max retries exceeded/);
            assert.strictEqual(state.axiosPostStub.callCount, 0);
        });
    });

    describe('getWalletInfo succeeds on first try', function () {
        it('makes exactly one call', async function () {
            state.axiosPostStub.resolves(rpcSuccess({ walletname: 'w' }));

            const result = await state.connector.getWalletInfo(50);
            assert.deepStrictEqual(result, { walletname: 'w' });
            assert.strictEqual(state.axiosPostStub.callCount, 1);
        });
    });

    describe('getWalletInfo sleeps between retries', function () {
        it('sleeps 1000ms on each retry', async function () {
            state.axiosPostStub.onFirstCall().rejects(new Error('fail'));
            state.axiosPostStub.onSecondCall().rejects(new Error('fail'));
            state.axiosPostStub.onThirdCall().resolves(rpcSuccess({ walletname: 'w' }));

            await state.connector.getWalletInfo(5);
            assert.strictEqual(state.connector.sleep.callCount, 2, 'Should sleep twice for two failures');
            assert(state.connector.sleep.alwaysCalledWith(1000));
        });
    });
});

// ═══════════════════════════════════════════════════════════════════
// RPC response shape boundaries
// ═══════════════════════════════════════════════════════════════════

describe('Boundary: RPC Retry and Response Shapes', function () {
    registerConnectorHooks();
    describe('R-10: RPC returns result: null', function () {
        it('getNetworkInfo throws on null result', async function () {
            state.axiosPostStub.resolves(rpcNoResult());
            await assert.rejects(() => state.connector.getNetworkInfo(), /Error getting network info/);
        });

        it('getBlockchainInfo throws on null result', async function () {
            state.axiosPostStub.resolves(rpcNoResult());
            await assert.rejects(() => state.connector.getBlockchainInfo(), /Error getting blockchain info/);
        });

        it('getRawMempool throws on null result', async function () {
            state.axiosPostStub.resolves(rpcNoResult());
            await assert.rejects(() => state.connector.getRawMempool(), /Error getting raw mempool/);
        });
    });

    describe('R-11: getRawMempool returns empty array', function () {
        it('returns empty array successfully', async function () {
            state.axiosPostStub.resolves(rpcSuccess([]));
            const result = await state.connector.getRawMempool();
            assert.deepStrictEqual(result, []);
        });
    });

    describe('R-12: RPC returns error object in response', function () {
        it('methods that check result truthiness throw on null result', async function () {
            const errorResponse = {
                data: { result: null, error: { code: -32600, message: 'Invalid request' }, id: 1 },
            };
            state.axiosPostStub.resolves(errorResponse);
            await assert.rejects(() => state.connector.getBlockchainInfo());
        });
    });
});

describe('Boundary: RPC Retry and Response Shapes', function () {
    registerConnectorHooks();
    describe('R-13: RPC returns malformed JSON (axios parse error)', function () {
        it('throws clean error (does not expose parse details)', async function () {
            const parseError = new Error('Unexpected token in JSON');
            parseError.code = 'ERR_BAD_RESPONSE';
            state.axiosPostStub.rejects(parseError);

            await assert.rejects(() => state.connector.getNetworkInfo(), /Error getting network info/);
        });
    });

    describe('R-14: RPC returns HTTP 500', function () {
        it('throws clean error (does not expose status code)', async function () {
            const serverError = new Error('Request failed with status code 500');
            serverError.response = { status: 500 };
            state.axiosPostStub.rejects(serverError);

            await assert.rejects(() => state.connector.getBlockchainInfo(), /Error getting blockchain info/);
        });
    });

    describe('R-15: Connection refused (node not running)', function () {
        it('throws clean error (does not expose connection details)', async function () {
            const connError = new Error('connect ECONNREFUSED 127.0.0.1:18332');
            connError.code = 'ECONNREFUSED';
            state.axiosPostStub.rejects(connError);

            await assert.rejects(() => state.connector.getNetworkInfo(), /Error getting network info/);
        });
    });

    describe('R-16: getRawTransaction returns null on error', function () {
        it('returns null on network error', async function () {
            state.axiosPostStub.rejects(new Error('timeout'));
            const result = await state.connector.getRawTransaction('txid1');
            assert.strictEqual(result, null);
        });

        it('returns null on RPC error', async function () {
            state.axiosPostStub.resolves(rpcNoResult());
            const result = await state.connector.getRawTransaction('txid1');
            assert.strictEqual(result, null);
        });

        it('returns hex on success', async function () {
            state.axiosPostStub.resolves(rpcSuccess('0200dead...'));
            const result = await state.connector.getRawTransaction('txid1');
            assert.strictEqual(result, '0200dead...');
        });
    });
});

describe('Boundary: RPC Retry and Response Shapes', function () {
    registerConnectorHooks();
    describe('R-17: generateToAddress returns empty array', function () {
        it('returns empty array for 0 blocks', async function () {
            state.axiosPostStub.resolves(rpcSuccess([]));
            const result = await state.connector.generateToAddress(0, 'addr');
            assert.deepStrictEqual(result, []);
        });
    });

    describe('R-18: generateToAddress called with 0 blocks', function () {
        it('sends count=0 as param', async function () {
            state.axiosPostStub.resolves(rpcSuccess([]));
            await state.connector.generateToAddress(0, 'addr');
            const data = state.axiosPostStub.firstCall.args[1];
            assert.deepStrictEqual(data.params, [0, 'addr']);
        });
    });
});

describe('Boundary: RPC Retry and Response Shapes', function () {
    registerConnectorHooks();

    // ═══════════════════════════════════════════════════════════════════
    // getBalance response boundaries
    // ═══════════════════════════════════════════════════════════════════

    describe('getBalance boundary responses', function () {
        it('returns 0 for zero balance', async function () {
            state.axiosPostStub.resolves(rpcSuccess(0));
            const result = await state.connector.getBalance();
            assert.strictEqual(result, 0);
        });

        it('returns very small positive balance', async function () {
            state.axiosPostStub.resolves(rpcSuccess(0.00000001));
            const result = await state.connector.getBalance();
            assert.strictEqual(result, 0.00000001);
        });

        it('throws when result is string (NaN check)', async function () {
            state.axiosPostStub.resolves({ data: { result: 'not_a_number' } });
            await assert.rejects(() => state.connector.getBalance(), /Error getting balance/);
        });

        it('accepts -0 as valid (isNaN(-0) is false)', async function () {
            state.axiosPostStub.resolves(rpcSuccess(-0));
            const result = await state.connector.getBalance();
            assert.strictEqual(result, -0);
        });

        it('throws when result is null (explicit null check)', async function () {
            state.axiosPostStub.resolves({ data: { result: null } });
            await assert.rejects(
                () => state.connector.getBalance(),
                /Error getting balance/,
                'null should be rejected by explicit null check',
            );
        });

        it('throws when result is undefined', async function () {
            state.axiosPostStub.resolves({ data: { result: undefined } });
            // isNaN(undefined) is true, so !isNaN is false -> throws
            await assert.rejects(() => state.connector.getBalance(), /Error getting balance/);
        });
    });
});

// ═══════════════════════════════════════════════════════════════════
// sendToAddress response boundaries
// ═══════════════════════════════════════════════════════════════════

describe('Boundary: RPC Retry and Response Shapes', function () {
    registerConnectorHooks();
    describe('sendToAddress response shape boundaries', function () {
        it('extracts txid from verbose response', async function () {
            state.axiosPostStub.resolves(rpcSuccess({ txid: 'abc123', fee_reason: 'not_set' }));
            const result = await state.connector.sendToAddress('addr', 1.0);
            assert.strictEqual(result, 'abc123');
        });

        it('throws when response has no txid key', async function () {
            // An object result without a txid string is treated as a failed
            // send (static error message, no host/port leakage).
            state.axiosPostStub.resolves(rpcSuccess({ other_field: 'value' }));
            await assert.rejects(() => state.connector.sendToAddress('addr', 1.0), /Error sending funds to address/);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // generateToAddress timeout configuration
    // ═══════════════════════════════════════════════════════════════════

    describe('generateToAddress timeout boundary', function () {
        it('inherits the connector-wide default timeout (no per-call override)', async function () {
            state.axiosPostStub.resolves(rpcSuccess(['hash']));
            await state.connector.generateToAddress(1, 'addr');

            const config = state.axiosPostStub.firstCall.args[2];
            assert.strictEqual(
                config.timeout,
                undefined,
                'Mining should inherit axios.defaults.timeout (NODE_RPC_TIMEOUT), not hardcode one',
            );
        });
    });
});

// ═══════════════════════════════════════════════════════════════════
// Constructor URL building boundaries
// ═══════════════════════════════════════════════════════════════════

describe('Boundary: RPC Retry and Response Shapes', function () {
    registerConnectorHooks();
    describe('Constructor URL boundaries', function () {
        it('builds URL with empty host', function () {
            const c = new BlockchainConnector('', '18332', 'u', 'p');
            assert.strictEqual(c.url, 'http://:18332');
        });

        it('builds URL with empty port', function () {
            const c = new BlockchainConnector('localhost', '', 'u', 'p');
            assert.strictEqual(c.url, 'http://localhost:');
        });

        it('builds URL with IPv6 address', function () {
            const c = new BlockchainConnector('::1', '18332', 'u', 'p');
            assert.strictEqual(c.url, 'http://::1:18332');
        });

        it('stores credentials as-is (no encoding)', function () {
            const c = new BlockchainConnector('h', '1', 'user@name', 'p@ss:word');
            assert.strictEqual(c.rpcUser, 'user@name');
            assert.strictEqual(c.rpcPassword, 'p@ss:word');
        });
    });
});
