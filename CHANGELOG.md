# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.18] - 2026-06-20

### Added
- Add `.env.example` configuration template listing every environment variable the miner reads, with safe regtest defaults and inline comments.

### Changed
- Pin `bitcoinjs-lib` 6.1.7, `ecpair` 2.1.0, `bip32` 4.0.0, `tiny-secp256k1` 2.2.4 to exact versions (drop `^` caret ranges) so every install resolves a byte-identical dependency tree.
- Raise the `bitcoinjs-lib` dependency floor to `^6.1.7` to match the encoder, decoder, UTXO-tracker, and SDK services and eliminate isolated-lockfile divergence risk.

### Fixed
- Fix stale `connector-rpc` integration test assertion: `sendToAddress` now expects positional params `['<address>', <amount>]` instead of a named-parameter object with `verbose`, matching `BlockchainConnector`'s Dogecoin v1.14-compatible call style.
- Fix `fillMempool` to resolve bitcoinjs-lib network parameters from the full coin-network identifier (e.g. `dogecoin-regtest`) via a new `CryptoNetworks` helper; `api.js` now forwards the full identifier so Dogecoin/Litecoin testnet and mainnet addresses encode correctly.

## [0.1.17] - 2026-05-30

### Fixed
- Fix `fill_mempool` JSON-RPC handler to surface `fillMempool` validation errors (bad `txQuantity`, concurrent call) in its error response instead of always returning `{"result":"ok"}`.

## [0.1.16] - 2026-05-30

### Fixed
- Fix `generateBlocks(count)` to treat a count of 0 or less as a no-op (returns empty array) instead of forwarding to the node, which rejects `generatetoaddress 0` with an RPC error.

## [0.1.15] - 2026-05-29

### Fixed
- Serialize concurrent `generateBlocks` callers behind a promise queue so the auto-mine loop and `generate_blocks` RPC handler can no longer issue overlapping `generateToAddress` requests.
- Isolate a failed mining attempt to its own caller via a rejection-swallowing tail so a single failure no longer permanently wedges the serialization queue.

## [0.1.14] - 2026-04-06

### Changed
- Move coverage badge to its own line in README.md for cleaner formatting

## [0.1.13] - 2026-04-06

### Changed
- Update `README.md` Documentation table to link to 4 docs (README, Architecture, Configuration, Operations) matching the xchain-sdk/xchain-indexer format.

## [0.1.12] - 2026-04-06

### Added
- Add three-tier regression test suite (147 tests): `t0-critical-gate.test.js` (45 tests, core paths), `t1-standard-regression.test.js` (89 tests, all 13 RPC methods), `t2-full-regression.test.js` (13 E2E tests vs `StatefulMockNode`); `FLAKY_TESTS.md` quarantine log; and `test:regression:t0/t1/t2` scripts.

## [0.1.11] - 2026-04-06

### Added
- Add StrykerJS mutation testing infrastructure (v8.7.1): `stryker.config.js` (full) and `stryker.unit.config.js` (fast), reporters to `reports/mutation/`, thresholds (break 60%/low 75%/high 90%), and `npm run test:mutation` / `test:mutation:unit` scripts.

### Changed
- Guard `startApi()` in `src/api.js` behind a `require.main === module` check to allow safe instrumentation by mutation testing and other tooling.

## [0.1.10] - 2026-04-05

### Added
- Add chaos engineering test suite (22 tests, 10 experiments): `ChaosNode` helper with fault injection (offline, fail rates, corruption, auth), plus CE-01 through CE-10 covering RPC disruption, corruption, startup resilience, `fillMempool` interruption, stress, and process lifecycle.
- Add `npm run test:chaos` script.
- Add graceful shutdown via SIGTERM handler in mining loop (W-4).
- Add exponential backoff for mining loop error retries, capped at 30s (W-5).

### Fixed
- Validate `getRawMempool` response with `Array.isArray()` to prevent string responses from triggering phantom mining (W-1).
- Increase `createWallet` default retries from 10 to 50 to match `getWalletInfo` and widen the startup window (W-2).
- Restore `keepMining=true` in `fillMempool`'s `finally` block to prevent stuck mining state after failures (W-3).
- Move `fillMempool` input validation before the `keepMining=false` assignment so invalid inputs no longer disrupt mining state.

## [0.1.9] - 2026-04-05

### Added
- Add performance and load testing suite (28 tests): block generation latency, mempool polling, `fillMempool` scaling, RPC latency, soak stability, and API throughput categories.
- Add `PerformanceCollector`, `MemorySampler`, `LatencyMockNode`, and `perfAssert` test helpers.
- Add `npm run test:performance` script.

## [0.1.8] - 2026-04-05

### Added
- Strengthen security test suite to 159 tests (up from 114): adds `BlockchainConnector` error-object property checks, `getNetworkInfo`/`getBlockchainInfo` sanitization coverage, NETWORK value restriction tests, and NODE_URL localhost warning tests.
- Add `.dockerignore` excluding `.env`, `node_modules`, `test`, `.git`, and markdown files from Docker builds.

### Fixed
- Complete RPC credential leak remediation across all `BlockchainConnector` methods: `getNetworkInfo`, `getBlockchainInfo`, `getBlockHash`, `getBlock`, `getRawMempool`, `getMempoolEntry`, `loadWallet`, `getNewAddress`, `generateToAddress`, `getBalance`, `createWallet`, and `getWalletInfo` all throw clean `new Error()` instead of propagating raw axios errors (SEC-004).
- Validate the NETWORK environment variable against allowed values: regtest, testnet, mainnet (SEC-018).
- Warn when NODE_URL is set to a non-localhost value to alert that RPC credentials will transit the network in plaintext (SEC-017).

### Changed
- Harden Dockerfile: pin base image (`node:20-alpine`), add non-root user, use `npm ci --omit=dev`, remove `.env` copy, add `HEALTHCHECK`.
- Remove `.env` from the Docker image build; credentials must be passed via environment variables at runtime (SEC-015).

## [0.1.7] - 2026-04-05

### Added
- Add security test suite (114 tests) covering input validation, timer bounds, `fillMempool` quantity cap, resource exhaustion, RPC credential non-disclosure, environment validation, and API hardening.
- Add `npm run test:security` script.

### Fixed
- Add 50-retry limit with backoff to `fillMempool` to prevent infinite retry when `sendFundsToAddress` perpetually fails (SEC-001).
- Cap `fillMempool` `txQuantity` at 50,000 to prevent unbounded memory allocation (SEC-002).
- Add input validation to `sendFundsToAddress`: requires non-empty string address and positive finite number amount (SEC-003).
- Throw clean error messages from `sendToAddress` and `sendRawTransaction` error paths to prevent RPC credential leakage (SEC-004).
- Add `validateEnvVars()` at startup checking all 6 required vars and validating port ranges (SEC-005).
- Add `fillMempoolRunning` mutex with `try/finally` cleanup to prevent races on concurrent `fillMempool` calls (SEC-006).
- Enforce 1000ms minimum and 3600000ms maximum on `setMiningTime`; return error objects on invalid input (SEC-008).
- Use generic error strings in `send_funds` and `fill_mempool` API error messages to prevent user input reflection (SEC-012).
- Return `{error: "..."}` from `setMiningTime` on invalid input instead of silently rejecting it (SEC-013).
- Sanitize full error objects logged in `createWallet` and `prepareWallet` to clean error messages (SEC-004).

## [0.1.6] - 2026-04-05

### Fixed
- Fix TypeError crash in `setMiningTime` logging non-stringifiable objects (e.g. `{toString: 0}`) by wrapping error logging in try-catch.
- Fix TypeError crash in `send_funds` and `fill_mempool` API error handlers for non-stringifiable parameter values by wrapping error message construction in try-catch.
- Add 50-retry limit with 1s backoff to `fillMempool` to stop infinite loop when `getRawTransaction` perpetually returns null.
- Add input validation to `fillMempool` requiring a positive integer `txQuantity` (Infinity caused OOM; floats/strings caused undefined behavior).
- Add `> 0` validation to both `setMiningTime` parameters to prevent excessive RPC calls from zero and negative values.

## [0.1.5] - 2026-04-05

### Added
- Add fuzz test suite (115 tests) using fast-check: JSON-RPC API parameter fuzzing, mining timer fuzzing, `fillMempool` input fuzzing, RPC response fuzzing, and mining loop state fuzzing.
- Add `fast-check` dev dependency for property-based testing.
- Add `npm run test:fuzz` and `npm run test:fuzz:quick` scripts.

## [0.1.4] - 2026-04-05

### Fixed
- Fix mining loop crash when `getRawMempool` returns null by adding a null guard before `.length` access.
- Fix `fillMempool` to reset `processedChunkCount` after intermediate mining, preventing it from firing on every chunk after the 20th.
- Fix `getBalance` silently accepting `null` as a valid balance (caused by `isNaN(null)` returning false) by adding an explicit null/undefined check.

## [0.1.3] - 2026-04-05

### Added
- Add boundary test suite (184 tests) covering adaptive mining timer, mempool polling, `fillMempool` chunking, combined timer+mempool interactions, wallet preparation, API input validation, RPC retry, and block generation edge cases.

## [0.1.2] - 2026-04-05

### Added
- Add E2E test suite (26 tests) validating the full mining pipeline against `StatefulMockNode`: startup/wallet lifecycle, mining loop, JSON-RPC API, `fillMempool` PSBT construction, error resilience, and chain state tracking.
- Add `StatefulMockNode` test helper simulating Bitcoin Core regtest node with wallet, mempool, and chain state.
- Add `npm run test:e2e` script (runs in ~3s with no external dependencies).

## [0.1.1] - 2026-04-05

### Added
- Add smoke test suite (12 tests) for fast health-check validation: `BlockchainConnector` instantiation, wallet preparation flows, mining loop core paths, and JSON-RPC API dispatch.
- Add `npm run test:smoke` script (runs in ~200ms with no external dependencies).

## [0.1.0] - 2026-04-05

### Added
- Add unit test suite (120 tests) covering `BlockchainConnector`, `XChainRegtestMiner`, and `api.js`.
- Add integration test suite (80 tests) covering four seams: HTTP client to Express controller (A), Miner to Connector call sequences (B), `fillMempool` to bitcoinjs-lib PSBT pipeline (C), and `BlockchainConnector` to `MockRpcServer` round-trips (D).
- Add `MockRpcServer` test helper simulating the Bitcoin Core JSON-RPC interface.
- Add test fixtures with deterministic BIP39 mnemonic for reproducible crypto tests.
- Add Mocha and Sinon as dev dependencies with `npm test` script.

### Fixed
- Remove duplicate `getBlock()` method definition in `BlockchainConnector.js`.
- Add max retry limit (default 50) to `getWalletInfo()` to prevent infinite loops.
- Fix `lastRawMempoolLength` never being updated in the mining loop, causing the extended timer to reset every poll cycle instead of only on new transactions.
- Remove Promise constructor anti-pattern from `fillMempool()`, `sendFundsToAddress()`, and `createWallet()`.

### Changed
- Convert module-level mutable timing variables (`MAX_TIME_TO_MINE_TXS`, `ADDED_TIME_TO_MINE_TXS`) to instance properties (`maxTimeToMineTxs`, `addedTimeToMineTxs`) for per-instance isolation and testability.
