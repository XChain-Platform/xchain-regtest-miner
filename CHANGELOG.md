# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
