# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
