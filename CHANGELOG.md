# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
