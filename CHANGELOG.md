# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.18.0] - 2026-09-11

### Changed
- The vendored BTC registry and the consensus pin comments are refreshed from canonical; comment text only, no behavioural change.

## [0.17.0] - 2026-09-10

### Fixed
- The BTC regtest fee rate is pinned per call instead of through `settxfee`, so a fee-bearing action prices the same on every miner container.

## [0.15.0] - 2026-09-07

### Changed
- The vendored coin registry is resynced from the hub.

## [0.11.0] - 2026-08-25

### Fixed
- Corrected the vendored coin bundles' fee-destination comment to say the override is regtest-only.
- Updated the BTC mainnet reward pool address.
- Re-pinned the testnet genesis for BTC, LTC, and DOGE to match the platform's fresh testnet genesis.

## [0.10.0] - 2026-08-22

Joins the platform version stream. This component moves from `0.1.21` to
`0.10.0`. **The number is higher but nothing was skipped**: the platform stream
names the train a component shipped in, and this component shipped in v0.10.0.
Versions below this line are its own legacy stream and are not comparable.

### Changed
- Adopted the platform version stream, so the version now matches the `v0.10.0` train tag.

### Fixed
- Mining is held while a reorg primitive is in flight.
- Tests wait on observable state instead of fixed sleeps.

## [0.1.21] - 2026-08-13

### Fixed
- Make generateBlocks async so failures reject instead of throwing synchronously, and add a CI job that checks the vendored coin registry for drift.
- Exempt the read-only `ping` and `status` methods from the `MINER_API_KEY` gate so the Docker healthcheck no longer 401s into a permanently-unhealthy container when auth is enabled.

### Added
- Surface `mining_paused` in `getStatus()` so an unpaired `fill_mempool`/`invalidate_block` reads as a deliberate pause rather than a node hang.

## [0.1.20] - 2026-07-16

### Fixed
- Simplify prepareWallet's chain-height handling to one unconditional block-generation call and drop an unused RPC fetch.

## [0.1.18] - 2026-06-20

### Added
- Add `.env.example` listing every environment variable the miner reads, with safe regtest defaults and inline comments.

### Changed
- Pin `bitcoinjs-lib`, `ecpair`, `bip32`, and `tiny-secp256k1` to exact versions so every install resolves an identical dependency tree.
- Align the `bitcoinjs-lib` version floor with the other platform services to avoid lockfile divergence.

### Fixed
- Fix a stale integration test assertion for `sendToAddress`'s call signature.
- Fix `fillMempool` to resolve network parameters from the full coin-network identifier so testnet and mainnet addresses encode correctly.

## [0.1.17] - 2026-05-30

### Fixed
- Fix the `fill_mempool` handler to surface validation errors instead of always returning success.

## [0.1.16] - 2026-05-30

### Fixed
- Treat a zero or negative block count as a no-op instead of forwarding it to the node.

## [0.1.15] - 2026-05-29

### Fixed
- Serialize concurrent block-generation calls behind a promise queue so requests can no longer overlap.
- Isolate a failed mining attempt so it no longer wedges the serialization queue for good.

## [0.1.14] - 2026-04-06

### Changed
- Move the coverage badge to its own line in README.md for cleaner formatting.

## [0.1.13] - 2026-04-06

### Changed
- Update the README documentation table to link the full docs set.

## [0.1.12] - 2026-04-06

### Added
- Add a three-tier regression test suite with a flaky-test quarantine log.

## [0.1.11] - 2026-04-06

### Added
- Add mutation testing infrastructure with coverage thresholds and dedicated npm scripts.

### Changed
- Guard `startApi()` behind a `require.main === module` check so tooling can import it safely.

## [0.1.10] - 2026-04-05

### Added
- Add a chaos engineering test suite covering RPC disruption, corruption, startup resilience, and process lifecycle.
- Add graceful shutdown on SIGTERM and exponential backoff for mining loop error retries.

### Fixed
- Validate the mempool RPC response shape to prevent phantom mining on malformed replies.
- Widen the wallet-creation retry budget to match the startup window.
- Restore mining state correctly after a failed `fillMempool` call.
- Reorder `fillMempool` validation so bad input can no longer disrupt mining state.

## [0.1.9] - 2026-04-05

### Added
- Add a performance and load testing suite covering block generation, mempool polling, and RPC latency.
- Add supporting test helpers for latency simulation, memory sampling, and performance assertions.

## [0.1.8] - 2026-04-05

### Added
- Strengthen the security test suite with broader error-object and sanitization coverage.
- Exclude `.env`, `node_modules`, and other non-essential paths from Docker builds.

### Fixed
- Make every `BlockchainConnector` method throw a clean error instead of leaking a raw RPC error.
- Validate the NETWORK environment variable against the allowed chain values.
- Warn when NODE_URL points off localhost, since RPC credentials would then cross the network in plaintext.

### Changed
- Harden the Dockerfile: pin the base image, add a non-root user, and drop the `.env` copy.
- Stop copying `.env` into the Docker image; credentials are passed at runtime instead.

## [0.1.7] - 2026-04-05

### Added
- Add a security test suite covering input validation, timer bounds, and resource exhaustion.

### Fixed
- Cap retries and mempool fill size to prevent unbounded loops and memory growth.
- Validate `sendFundsToAddress` input and stop leaking raw RPC errors in send/broadcast error paths.
- Validate required environment variables and port ranges at startup.
- Guard concurrent `fillMempool` calls with a mutex.
- Bound `setMiningTime` to a sane interval and return clean error objects on invalid input.
- Use generic error strings in API error responses to stop reflecting user input.
- Sanitize logged error objects during wallet creation and preparation.

## [0.1.6] - 2026-04-05

### Fixed
- Fix a crash when logging non-stringifiable error objects during mining-time updates and API errors.
- Add a retry limit to `fillMempool` to stop an infinite loop when the node returns no transaction.
- Validate mining-time and mempool parameters to reject non-positive values.

## [0.1.5] - 2026-04-05

### Added
- Add a property-based fuzz test suite covering the API, mining timer, mempool filling, and RPC responses.

## [0.1.4] - 2026-04-05

### Fixed
- Guard against a null mempool response crashing the mining loop.
- Fix a chunk-counter reset bug that stopped `fillMempool` firing after its first run.
- Reject `null` as a valid wallet balance instead of silently treating it as zero.

## [0.1.3] - 2026-04-05

### Added
- Add a boundary test suite covering the mining timer, mempool polling, wallet preparation, and API input edge cases.

## [0.1.2] - 2026-04-05

### Added
- Add an end-to-end test suite validating the full mining pipeline against a stateful mock node.

## [0.1.1] - 2026-04-05

### Added
- Add a smoke test suite for fast health-check validation.

## [0.1.0] - 2026-04-05

### Added
- Add the initial unit and integration test suites covering the connector, miner, and API.
- Add deterministic crypto test fixtures and the Mocha/Sinon test setup.

### Fixed
- Remove a duplicate method definition and a Promise-constructor anti-pattern.
- Add a retry limit to wallet-info polling to prevent infinite loops.
- Fix a mining-loop timer bug that reset on every poll instead of only on new transactions.

### Changed
- Convert module-level mutable timing variables to per-instance properties for test isolation.
