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
const {
    state,
    useConnectorFixtures,
    makeAxiosError,
    assertConsoleClean,
    expectCleanRejection,
    expectNoCredentialLogging,
} = require('../helpers/connector_sanitization_fixture');

describe('Security: BlockchainConnector Error Sanitization', function () {
    useConnectorFixtures();

    // ─── Per-method error sanitization tests ──────────────────────────

    describe('getNetworkInfo', function () {
        it('throws clean error without credentials', async function () {
            await expectCleanRejection(() => state.connector.getNetworkInfo(), 'Error getting network info');
        });
        it('does not log credentials', async function () {
            await expectNoCredentialLogging(() => state.connector.getNetworkInfo());
        });
    });

    describe('getBlockchainInfo', function () {
        it('throws clean error without credentials', async function () {
            await expectCleanRejection(() => state.connector.getBlockchainInfo(), 'Error getting blockchain info');
        });
        it('does not log credentials', async function () {
            await expectNoCredentialLogging(() => state.connector.getBlockchainInfo());
        });
    });

    describe('getBlockHash', function () {
        it('throws clean error without credentials', async function () {
            await expectCleanRejection(() => state.connector.getBlockHash(0), 'Error getting block hash');
        });
        it('does not log credentials', async function () {
            await expectNoCredentialLogging(() => state.connector.getBlockHash(0));
        });
    });
});

describe('Security: BlockchainConnector Error Sanitization', function () {
    useConnectorFixtures();
    describe('getBlock', function () {
        it('throws clean error without credentials', async function () {
            await expectCleanRejection(() => state.connector.getBlock('abc123'), 'Error getting block');
        });
        it('does not log credentials', async function () {
            await expectNoCredentialLogging(() => state.connector.getBlock('abc123'));
        });
    });

    describe('getRawMempool', function () {
        it('throws clean error without credentials', async function () {
            await expectCleanRejection(() => state.connector.getRawMempool(), 'Error getting raw mempool');
        });
        it('does not log credentials', async function () {
            await expectNoCredentialLogging(() => state.connector.getRawMempool());
        });
    });

    describe('getMempoolEntry', function () {
        it('throws clean error without credentials', async function () {
            await expectCleanRejection(() => state.connector.getMempoolEntry('txid123'), 'Error getting mempool entry');
        });
        it('does not log credentials', async function () {
            await expectNoCredentialLogging(() => state.connector.getMempoolEntry('txid123'));
        });
    });
});

describe('Security: BlockchainConnector Error Sanitization', function () {
    useConnectorFixtures();
    describe('getRawTransaction', function () {
        it('returns null on error without logging credentials', async function () {
            state.axiosPostStub.rejects(makeAxiosError('connect ECONNREFUSED'));
            const result = await state.connector.getRawTransaction('txid123');
            assert.strictEqual(result, null);
            assertConsoleClean();
        });
    });

    describe('createWallet', function () {
        it('throws clean error without credentials after retries', async function () {
            await expectCleanRejection(() => state.connector.createWallet('test_wallet', 2), 'Error creating wallet');
        });
        it('does not log credentials', async function () {
            await expectNoCredentialLogging(() => state.connector.createWallet('test_wallet', 2));
        });
    });

    describe('getWalletInfo', function () {
        it('throws clean error without credentials after retries', async function () {
            await expectCleanRejection(
                () => state.connector.getWalletInfo(2),
                'Error getting wallet info: max retries exceeded',
            );
        });
        it('does not log credentials during retries', async function () {
            await expectNoCredentialLogging(() => state.connector.getWalletInfo(2));
        });
    });
});

describe('Security: BlockchainConnector Error Sanitization', function () {
    useConnectorFixtures();
    describe('loadWallet', function () {
        it('throws clean error without credentials', async function () {
            await expectCleanRejection(() => state.connector.loadWallet('test_wallet'), 'Error loading wallet');
        });
        it('does not log credentials', async function () {
            await expectNoCredentialLogging(() => state.connector.loadWallet('test_wallet'));
        });
    });

    describe('getNewAddress', function () {
        it('throws clean error without credentials', async function () {
            await expectCleanRejection(() => state.connector.getNewAddress(), 'Error getting new address');
        });
        it('does not log credentials', async function () {
            await expectNoCredentialLogging(() => state.connector.getNewAddress());
        });
    });

    describe('generateToAddress', function () {
        it('throws clean error without credentials', async function () {
            await expectCleanRejection(
                () => state.connector.generateToAddress(1, 'bcrt1qtest'),
                'Error generating to address',
            );
        });
        it('does not log credentials', async function () {
            await expectNoCredentialLogging(() => state.connector.generateToAddress(1, 'bcrt1qtest'));
        });
    });
});

describe('Security: BlockchainConnector Error Sanitization', function () {
    useConnectorFixtures();
    describe('getBalance', function () {
        it('throws clean error without credentials', async function () {
            await expectCleanRejection(() => state.connector.getBalance(), 'Error getting balance');
        });
        it('does not log credentials', async function () {
            await expectNoCredentialLogging(() => state.connector.getBalance());
        });
    });

    describe('sendToAddress', function () {
        it('throws clean error without credentials', async function () {
            await expectCleanRejection(
                () => state.connector.sendToAddress('bcrt1qtest', 1.0),
                'Error sending funds to address',
            );
        });
        it('does not log credentials', async function () {
            await expectNoCredentialLogging(() => state.connector.sendToAddress('bcrt1qtest', 1.0));
        });
    });

    describe('sendRawTransaction', function () {
        it('throws clean error without credentials', async function () {
            await expectCleanRejection(
                () => state.connector.sendRawTransaction('deadbeef'),
                'Error sending raw transaction',
            );
        });
        it('does not log credentials', async function () {
            await expectNoCredentialLogging(() => state.connector.sendRawTransaction('deadbeef'));
        });
    });
});
