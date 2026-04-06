# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.12] - 2026-04-06

### Added
- Three-tier regression test suite (147 tests across 3 files)
  - `test/regression/t0-critical-gate.test.js` — 45 tests covering constructor defaults, timer validation, wallet branching, mining loop core paths, fillMempool guards, input validation, API health, and connector construction
  - `test/regression/t1-standard-regression.test.js` — 89 tests covering all 13 RPC methods, Miner↔Connector integration seams, boundary conditions (timer edges, chunking math, wallet height), security validation (input rejection, credential leak prevention), and exponential backoff behavior
  - `test/regression/t2-full-regression.test.js` — 13 E2E tests against StatefulMockNode covering wallet lifecycle (fresh/restart/unloaded), mempool detection and block generation, pause/resume, timer override, send_funds round-trip, RPC error resilience, chain state progression, and graceful shutdown
  - `test/regression/FLAKY_TESTS.md` — quarantine log for non-deterministic tests
  - `npm run test:regression:t0` (< 15s gate), `test:regression:t1` (< 2min PR gate), `test:regression:t2` (< 10min nightly/release gate), `test:regression` (alias for t1)

## [0.1.11] - 2026-04-06

### Added
- StrykerJS mutation testing infrastructure (v8.7.1 with Mocha runner)
  - `stryker.config.js` — full mutation run across unit, smoke, boundary, security, integration, and e2e tests
  - `stryker.unit.config.js` — fast unit-only mutation run for quick feedback
  - `npm run test:mutation` and `npm run test:mutation:unit` scripts
  - HTML, JSON, and clear-text reporters outputting to `reports/mutation/`
  - perTest coverage analysis for optimized mutant-to-test mapping
  - StringLiteral mutations excluded to reduce noise from RPC method names and error messages
  - Thresholds: break at 60%, low at 75%, high at 90%

### Changed
- `src/api.js` now guards `startApi()` behind `require.main === module` check, enabling safe instrumentation by mutation testing and other tooling

## [0.1.10] - 2026-04-05

### Added
- Chaos engineering test suite (22 tests across 6 files implementing 10 experiments)
  - ChaosNode helper extending LatencyMockNode with fault injection (offline, fail rates, response corruption, method interception, auth enforcement)
  - CE-01/02/03: RPC disruption tests (connection loss, timeout, 50% flapping)
  - CE-04/10: RPC corruption tests (invalid response shapes, auth failure)
  - CE-05: Startup resilience tests (node unavailable during initialization)
  - CE-06: fillMempool interruption tests (state recovery verification)
  - CE-07/09: Stress tests (10k+ mempool entries, concurrent API abuse)
  - CE-08: Process lifecycle tests (SIGTERM handler, crash/restart)
- `npm run test:chaos` script
- Graceful shutdown via SIGTERM handler in mining loop (W-4 fix)
- Exponential backoff for mining loop error retries, capped at 30s (W-5 fix)

### Fixed
- getRawMempool now validates response is an Array via `Array.isArray()`, preventing string responses from causing phantom mining (W-1)
- createWallet default retries increased from 10 to 50, matching getWalletInfo and providing a wider startup window (W-2)
- fillMempool now restores `keepMining=true` in its finally block, preventing stuck mining state after failures (W-3)
- fillMempool validation moved before `keepMining=false` assignment, so invalid inputs no longer disrupt mining state

## [0.1.9] - 2026-04-05

### Added
- Performance and load testing suite (28 tests across 6 categories)
  - Block generation latency (BG): empty/small/medium/large mempool, sequential and burst mining
  - Mempool polling (MP): steady trickle, burst arrival, continuous flood, timer boundary, 5000-txid overhead
  - fillMempool scaling (FM): 10/100/500 txs, scaling ratio analysis, mutex rejection timing
  - RPC latency (RPC): baseline all methods, concurrent load, simulated delay, connection reuse, mixed concurrent
  - Soak stability (SL): idle soak, active soak, burst soak, error recovery
  - API throughput (API): ping flood, mixed workload, concurrent requests
- Performance test helpers: PerformanceCollector (timing/percentiles), MemorySampler (heap tracking), LatencyMockNode (configurable RPC delays), perfAssert (threshold assertions)
- `npm run test:performance` script

## [0.1.8] - 2026-04-05

### Added
- Strengthened security test suite (159 tests, up from 114)
  - BlockchainConnector: full error object property checks (`.config`, `.response` must be undefined on thrown errors)
  - BlockchainConnector: `getNetworkInfo` and `getBlockchainInfo` error sanitization coverage (previously untested)
  - Environment validation: NETWORK value restriction tests (regtest/testnet/mainnet only, case-sensitive)
  - Environment validation: NODE_URL localhost warning tests (warns on non-localhost, does not exit)
- `.dockerignore` file excluding `.env`, `node_modules`, `test`, `.git`, and markdown files from Docker builds

### Fixed
- Completed RPC credential leak remediation across all BlockchainConnector methods (SEC-004)
  - `getNetworkInfo`, `getBlockchainInfo`: added try-catch, throw clean `new Error()` instead of propagating raw axios errors
  - `getBlockHash`, `getBlock`, `getRawMempool`, `getMempoolEntry`, `loadWallet`, `getNewAddress`, `generateToAddress`, `getBalance`: replaced `console.error(error.message); throw error` with `throw new Error('...')` to prevent credential-bearing error objects from propagating
  - `createWallet`: removed `console.error` in outer catch, throw clean error
  - `getWalletInfo`: removed `console.error` in retry loop to prevent credential logging
- NETWORK environment variable now validated against allowed values: regtest, testnet, mainnet (SEC-018)
- NODE_URL now logs a warning when set to a non-localhost value, alerting that RPC credentials will transit the network in plaintext (SEC-017)

### Changed
- Dockerfile hardened: pinned base image (`node:20-alpine`), non-root user, `npm ci --omit=dev`, removed `.env` copy, added `HEALTHCHECK`
- Removed `.env` file from Docker image build (SEC-015) — credentials must be passed via environment variables at runtime

## [0.1.7] - 2026-04-05

### Added
- Security test suite (114 tests) covering all hardening fixes
  - Input validation: sendFundsToAddress address/amount type checking, boundary values, invalid type rejection
  - Timer bounds: setMiningTime min/max enforcement (1000ms–3600000ms), error return objects
  - fillMempool quantity cap: rejection above 50,000, memory exhaustion prevention
  - Resource exhaustion: sendFundsToAddress retry limit (50), fillMempool mutex, concurrent call rejection
  - Error sanitization: RPC credential non-disclosure across all BlockchainConnector methods
  - Environment validation: missing vars, empty vars, invalid port numbers
  - API hardening: generic error messages, prototype pollution resistance, XSS non-reflection
- `npm run test:security` script

### Fixed
- Infinite retry loop in `fillMempool` when `sendFundsToAddress` perpetually fails — added 50-retry limit with backoff (SEC-001)
- Unbounded memory allocation via `fillMempool` with large `txQuantity` — added 50,000 cap (SEC-002)
- Missing input validation on `sendFundsToAddress` — now requires non-empty string address and positive finite number amount (SEC-003)
- RPC credential leakage in `sendToAddress` and `sendRawTransaction` error paths — errors now throw clean messages without axios internals (SEC-004)
- Missing environment variable validation at startup — `validateEnvVars()` checks all 6 required vars and validates port ranges (SEC-005)
- Race condition on concurrent `fillMempool` calls — added `fillMempoolRunning` mutex with try/finally cleanup (SEC-006)
- Missing timer bounds on `setMiningTime` — enforced 1000ms minimum and 3600000ms maximum, returns error objects on invalid input (SEC-008)
- User input reflected in API error messages (`send_funds`, `fill_mempool`) — now uses generic error strings (SEC-012)
- `setMiningTime` silently rejecting invalid input — now returns `{error: "..."}` to caller (SEC-013)
- Full error objects logged to console in `createWallet` and `prepareWallet` — sanitized to clean error messages (SEC-004)

## [0.1.6] - 2026-04-05

### Fixed
- TypeError crash when `setMiningTime` logs non-stringifiable objects (e.g., `{toString: 0}`) — wrapped error logging in try-catch
- TypeError crash in `send_funds` and `fill_mempool` API error handlers for non-stringifiable parameter values — wrapped error message construction in try-catch
- Infinite loop in `fillMempool` when `getRawTransaction` perpetually returns null — added 50-retry limit with 1s backoff
- `fillMempool` accepting non-positive-integer `txQuantity` values (Infinity caused OOM, floats/strings caused undefined behavior) — added input validation requiring positive integer
- `setMiningTime` accepting zero and negative values which caused excessive RPC calls — added `> 0` validation for both parameters

## [0.1.5] - 2026-04-05

### Added
- Fuzz test suite (115 tests) using fast-check for property-based testing
  - JSON-RPC API parameter fuzzing: arbitrary types, boundary values, malformed objects for all 6 methods
  - Mining timer fuzzing: integer boundaries, non-integer rejection, zero/negative edge cases, rapid sequential calls
  - fillMempool input fuzzing: txQuantity boundaries (0, -1, NaN, Infinity), chunk math verification, infinite loop detection
  - RPC response fuzzing: malformed mempool responses, error resilience, fluctuating sizes, wallet setup edge cases
  - Mining loop state fuzzing: timer transitions, keepMining flag toggling, interleaved errors, random event sequences
- `fast-check` dev dependency for property-based/fuzz testing
- `npm run test:fuzz` and `npm run test:fuzz:quick` scripts

## [0.1.4] - 2026-04-05

### Fixed
- Mining loop crash when `getRawMempool` returns null — added null guard before `.length` access
- `fillMempool` intermediate block mining firing on every chunk after the 20th — reset `processedChunkCount` after mining
- `getBalance` silently accepting `null` as a valid balance (due to `isNaN(null)` returning false) — added explicit null/undefined check

## [0.1.3] - 2026-04-05

### Added
- Boundary test suite (184 tests) covering edge-case behavior across all components
  - Adaptive mining timer: zero/negative/MAX_SAFE_INTEGER values, simultaneous expiry, state transitions
  - Mempool polling: empty/single/burst/shrink scenarios, null response handling, rapid changes
  - fillMempool chunking: tx_quantity at 0/1/2499/2500/2501, chunk mining threshold, BIP32 index math
  - Combined boundaries: timer+mempool interactions, mid-countdown threshold changes, double-error recovery
  - Wallet preparation: height 99/100/101 boundary, floating-point balance, -0 edge case, null walletInfo
  - API input validation: type rejection (float/string/null/Infinity), partial validity, pass-through behavior
  - RPC retry: exact retry counts for createWallet/getWalletInfo, response shape edge cases, null balance
  - Block generation: count 0/1/101/negative, null walletAddress, concurrent calls

## [0.1.2] - 2026-04-05

### Added
- E2E test suite (26 tests) validating full mining pipeline against a stateful mock node
  - Startup/wallet lifecycle: fresh creation, restart, unloaded recovery, empty balance, failure
  - Mining loop: mempool detection, timer batching, max timer forcing, idle behavior, multi-cycle
  - JSON-RPC API: ping, send_funds, timing changes, pause/resume with live miner
  - fillMempool: real PSBT construction and broadcasting (single and multi-transaction)
  - Error resilience: RPC recovery, insufficient balance, invalid input validation
  - Chain state: block continuity, balance tracking, transaction inclusion
- StatefulMockNode test helper simulating Bitcoin Core regtest node with wallet, mempool, and chain state
- `npm run test:e2e` script (runs in ~3s with no external dependencies)

## [0.1.1] - 2026-04-05

### Added
- Smoke test suite (12 tests) for fast health-check validation of core functionality
  - BlockchainConnector instantiation and credential wiring
  - Wallet preparation flows (fresh node create+fund, existing wallet load)
  - Mining loop: mempool detection, timer-based block generation, max timer forcing, pause/resume
  - JSON-RPC API controller dispatch (ping, send_funds, set_mining_time)
- `npm run test:smoke` script (runs in ~200ms with no external dependencies)

## [0.1.0] - 2026-04-05

### Added
- Unit test suite (120 tests) covering BlockchainConnector, XChainRegtestMiner, and api.js
- Integration test suite (80 tests) covering four integration seams:
  - Seam A: HTTP client ↔ Express JSON-RPC controller with real middleware stack
  - Seam B: Miner ↔ Connector call sequences (prepareWallet, mining loop)
  - Seam C: fillMempool ↔ bitcoinjs-lib PSBT crypto pipeline with real crypto libraries
  - Seam D: BlockchainConnector ↔ MockRpcServer RPC round-trips
- MockRpcServer test helper simulating Bitcoin Core JSON-RPC interface
- Test fixtures with deterministic BIP39 mnemonic for reproducible crypto tests
- Mocha and Sinon as dev dependencies with `npm test` script

### Fixed
- Removed duplicate `getBlock()` method definition in BlockchainConnector.js
- Added max retry limit (default 50) to `getWalletInfo()` to prevent infinite loops
- Fixed `lastRawMempoolLength` never being updated in the mining loop, which caused the extended timer to reset every poll cycle instead of only on new transactions
- Removed Promise constructor anti-pattern from `fillMempool()`, `sendFundsToAddress()`, and `createWallet()`

### Changed
- Converted module-level mutable timing variables (`MAX_TIME_TO_MINE_TXS`, `ADDED_TIME_TO_MINE_TXS`) to instance properties (`maxTimeToMineTxs`, `addedTimeToMineTxs`) for per-instance isolation and testability
