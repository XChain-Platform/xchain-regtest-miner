<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright © 2025-2026 Dankest, LLC -->

# XChain Platform Regtest Miner

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.20-blue" alt="Version">
  <img src="https://img.shields.io/badge/tests-1003%2B%20passing-brightgreen" alt="Tests">
  <img src="https://img.shields.io/badge/node-%3E%3D22-green" alt="Node">
  <img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue" alt="License">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/coverage-unit%20%7C%20integration%20%7C%20e2e%20%7C%20smoke%20%7C%20boundary%20%7C%20security%20%7C%20fuzz%20%7C%20chaos%20%7C%20performance%20%7C%20mutation%20%7C%20regression-brightgreen" alt="Coverage">
</p>

Auto-mining service for XChain Platform regtest environments. Polls the mempool every second, batches transactions using an adaptive dual-timer system (30s max / 5s extension), and mines blocks via `generatetoaddress`. Exposes a JSON-RPC API for test orchestration including fund transfers, mempool stress testing, and runtime timer configuration.

## Features

- **Adaptive dual-timer mining:** 30-second max timer with 5-second extension on each new transaction, configurable at runtime via JSON-RPC
- **Automatic wallet management:** creates, loads, and funds a regtest wallet on startup; mines 101 bootstrap blocks on a fresh chain for coinbase maturity
- **JSON-RPC control API:** 14 endpoints (`ping`, `status`, `health`, `send_funds`, `fill_mempool`, `pause_mining`, `continue_mining`, `set_mining_time`, `set_default_mining_time`, `set_mock_time`, `set_idle_mine_interval`, `generate_blocks`, `invalidate_block`, `reconsider_block`) for test orchestration
- **Optional mine-empty heartbeat:** mining is mempool-driven, so an idle chain never gains height; set `IDLE_MINE_INTERVAL_MS` (or call `set_idle_mine_interval`) to mine one empty block per idle interval and let height-gated states (stake activation, confirmation depth) advance on their own. Off by default.
- **Deterministic reorg testing:** `invalidate_block`/`reconsider_block` roll a block back and re-evaluate chain selection without dropping to raw node RPC; auto-mining pauses automatically for the duration, and each re-reads the wallet balance so a reorg that strands the matured coinbase shows up as `wallet_funded: false`
- **Mock clock control:** `set_mock_time` pins the node clock via `setmocktime` so time-based expiries land on a deterministic block; refused on mainnet
- **Loop diagnostics:** `status` reports `wallet_ready`, `wallet_balance`, `wallet_funded`, `mempool_size`, `blocks_mined`, `last_mine_at`, `consecutive_errors`, `mining_paused`, and `mining_started` for operators and CI. `wallet_ready` means startup finished and is never re-evaluated; a reorg drill asking whether the wallet can still fund a send reads `wallet_funded` (`wallet_balance` is `null` when the last read failed, which is not funded either)
- **Optional API key auth:** set `MINER_API_KEY` to require a matching `X-API-Key` header on every request (401 otherwise); the read-only `ping`/`status`/`health` methods always bypass the gate so Docker healthchecks keep working
- **Mempool stress testing:** `fill_mempool` constructs and broadcasts thousands of raw Bitcoin transactions using BIP32/BIP39 key derivation and PSBT signing
- **Exponential backoff:** automatic retry with capped exponential backoff (1s to 30s) on RPC connection failures
- **Pinned wallet fee rate:** `settxfee` pins a fixed funding fee on startup so an inflated `estimatesmartfee` on a matured regtest chain can't fail `send_funds`/`fill_mempool`; falls back to the fee estimate if the daemon rejects `settxfee`
- **Graceful shutdown:** SIGTERM handler allows the current mining loop iteration to complete before exiting
- **Input validation:** rejects invalid addresses, amounts, timer values, and transaction quantities before any RPC call
- **Error sanitization:** RPC credentials never exposed in error messages or console output
- **Concurrent call protection:** `fillMempool` mutex prevents overlapping stress test runs with automatic flag restoration
- **Stall-aware container health:** the Docker HEALTHCHECK probes `health`, not `ping`. `ping` always answers 200, so a miner wedged on wallet preparation or a run of failed mining cycles read healthy forever; `health` answers 503 once the cold-start grace (`MINER_WALLET_GRACE_MS`, default 60000) has passed with no wallet, or after `MINER_STALL_ERROR_THRESHOLD` (default 5) consecutive failures. A deliberate `pause_mining` stays healthy.
- **Docker-ready:** Alpine Node 22, non-root user, JSON-RPC healthcheck, Helmet security headers
- **1003+ tests:** unit, integration, e2e, smoke, boundary, security, fuzz, chaos, performance, mutation, and regression testing

## Documentation

Full regtest miner documentation is available in the [xchain-documentation](https://github.com/XChain-Platform/xchain-documentation/tree/master/components/regtest-miner) repository:

| Document | Description |
|---|---|
| [README](https://github.com/XChain-Platform/xchain-documentation/blob/master/components/regtest-miner/README.md) | Overview, features, installation, quick start, scripts, dependencies |
| [Architecture](https://github.com/XChain-Platform/xchain-documentation/blob/master/components/regtest-miner/architecture.md) | Component diagram, source files, mining loop, wallet lifecycle, fillMempool |
| [Configuration](https://github.com/XChain-Platform/xchain-documentation/blob/master/components/regtest-miner/configuration.md) | Environment variables, internal constants, timer behavior, backoff |
| [Operations](https://github.com/XChain-Platform/xchain-documentation/blob/master/components/regtest-miner/operations.md) | JSON-RPC API endpoints, startup sequence, Docker, troubleshooting |

## Quick Start

```bash
git clone https://github.com/XChain-Platform/xchain-regtest-miner.git
cd xchain-regtest-miner
npm install
```

Create a `.env` file:

```env
NETWORK=regtest
NODE_URL=localhost
NODE_PORT=18443
NODE_USER=rpc
NODE_PASSWORD=rpc
REGTEST_MINER_API_PORT=3001
```

Start the miner:

```bash
npm run api
```

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `NETWORK` | Yes | (none) | Must resolve to `regtest` or `testnet` (accepts the platform's `coin-network` form, e.g. `bitcoin-regtest`); `mainnet` is refused at startup |
| `NODE_URL` | Yes | (none) | Coin node JSON-RPC hostname (non-`localhost`/`127.0.0.1` logs a plaintext-credential warning) |
| `NODE_PORT` | Yes | (none) | Coin node JSON-RPC port (1-65535) |
| `NODE_USER` | Yes | (none) | RPC username |
| `NODE_PASSWORD` | Yes | (none) | RPC password |
| `REGTEST_MINER_API_PORT` | Yes | (none) | Miner JSON-RPC API listening port (1-65535) |
| `MINER_API_KEY` | No | Disabled | When set, requires a matching `X-API-Key` header on every request (401 otherwise); `ping`/`status`/`health` are always exempt |
| `NODE_RPC_TIMEOUT` | No | `60000` | HTTP timeout in milliseconds for coin node JSON-RPC calls |
| `MINER_WALLET_GRACE_MS` | No | `60000` | Cold-start grace before `health` calls a not-yet-ready wallet a stall; keep the Docker `--start-period` at least this long |
| `MINER_STALL_ERROR_THRESHOLD` | No | `5` | Consecutive failed mining cycles before `health` answers 503 |
| `IDLE_MINE_INTERVAL_MS` | No | `0` (off) | Mine one empty block after the mempool has been idle this long, so height-gated states can advance with no transactions in flight; also settable at runtime via `set_idle_mine_interval` |

## Scripts

| Command | Description |
|---|---|
| `npm run api` | Start the miner and JSON-RPC API server |
| `npm test` | All tests (~1003 tests) |
| `npm run test:smoke` | Smoke tests (12 tests) |
| `npm run test:e2e` | End-to-end tests |
| `npm run test:security` | Security tests (input validation, error sanitization, env validation, API hardening) |
| `npm run test:fuzz` | Fuzz tests (property-based via fast-check) |
| `npm run test:fuzz:quick` | Quick fuzz (60s timeout) |
| `npm run test:chaos` | Chaos engineering tests |
| `npm run test:performance` | Performance tests |
| `npm run test:mutation` | Mutation testing (Stryker Mutator) |
| `npm run test:mutation:unit` | Unit-only mutation testing |
| `npm run test:regression` | Regression tests: T1 standard gate (134 tests) |
| `npm run test:regression:t0` | Regression T0: critical gate (45 tests, < 15s) |
| `npm run test:regression:t1` | Regression T1: standard (134 tests, < 2 min) |
| `npm run test:regression:t2` | Regression T2: full E2E (147 tests, < 10 min) |

## Test Suite

| Type | Tests | Description |
|---|---|---|
| Unit | 216 | `XChainRegtestMiner.test.js`, `BlockchainConnector.test.js`, `api.test.js`, and 7 more: constructor, timers, wallet prep, mining loop, fillMempool chunking, RPC formatting, API dispatch |
| Integration | 80 | 4 seam files: HTTP/JSON-RPC, Miner/Connector sequences, fillMempool/bitcoinjs-lib crypto, Connector/MockRpcServer |
| E2E | 26 | StatefulMockNode: startup lifecycle, mempool detection, block generation, fill-mempool, API, chain state, resilience |
| Smoke | 12 | Instantiation, wallet prep paths, mempool detection, timer expiry, pause/resume, API health |
| Boundary | 189 | Timer edges, mempool state machine, fillMempool quantities, wallet state transitions, RPC edge cases, combined scenarios |
| Security | 159 | Input validation, env validation, connector error sanitization, error disclosure, API hardening, resource exhaustion |
| Fuzz | 124 | Property-based via fast-check: RPC parameters, RPC responses, fillMempool stress, mining loop edge cases, timer behavior |
| Chaos | 22 | RPC disruption, timeout, flapping, response corruption, auth failures, fillMempool interruption, SIGTERM |
| Performance | 28 | Block generation latency, mempool polling, fillMempool scaling, RPC latency, sustained load, API throughput |
| Mutation | - | Stryker Mutator: full service and unit-only configs, 90% high / 75% low / 60% break thresholds |
| Regression | 147 | Three-tier suite: T0 critical gate (45), T1 standard (89), T2 full E2E (13) |
| **Total** | **1003** | |

---

**Copyright &copy; 2025-2026 Dankest, LLC**

**Based on XChain Platform by Dankest, LLC &ndash; https://dankest.llc**

Licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0-or-later)
with a commercial license available for proprietary use.

You may use, modify, and distribute this material under the terms of the License.
See [LICENSE](./LICENSE.md) and [NOTICE](./NOTICE.md) for full terms.
See the [licensing overview](https://docs.xchain.io/legal/LICENSING.html).
