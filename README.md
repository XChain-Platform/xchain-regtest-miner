<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright © 2025-2026 Dankest, LLC -->

# XChain Platform Regtest Miner

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.18-blue" alt="Version">
  <img src="https://img.shields.io/badge/tests-901%20passing-brightgreen" alt="Tests">
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
- **JSON-RPC control API:** 7 endpoints (`ping`, `send_funds`, `generate_blocks`, `fill_mempool`, `continue_mining`, `set_mining_time`, `set_default_mining_time`) for test orchestration
- **Mempool stress testing:** `fill_mempool` constructs and broadcasts thousands of raw Bitcoin transactions using BIP32/BIP39 key derivation and PSBT signing
- **Exponential backoff:** automatic retry with capped exponential backoff (1s to 30s) on RPC connection failures
- **Graceful shutdown:** SIGTERM handler allows the current mining loop iteration to complete before exiting
- **Input validation:** rejects invalid addresses, amounts, timer values, and transaction quantities before any RPC call
- **Error sanitization:** RPC credentials never exposed in error messages or console output
- **Concurrent call protection:** `fillMempool` mutex prevents overlapping stress test runs with automatic flag restoration
- **Docker-ready:** Alpine Node 22, non-root user, JSON-RPC healthcheck, Helmet security headers
- **901 tests:** unit, integration, e2e, smoke, boundary, security, fuzz, chaos, performance, mutation, and regression testing

## Documentation

Full regtest miner documentation is available in the [xchain-documentation](https://github.com/XChain-platform/xchain-documentation/tree/master/components/regtest-miner) repository:

| Document | Description |
|---|---|
| [README](https://github.com/XChain-platform/xchain-documentation/blob/master/components/regtest-miner/README.md) | Overview, features, installation, quick start, scripts, dependencies |
| [Architecture](https://github.com/XChain-platform/xchain-documentation/blob/master/components/regtest-miner/ARCHITECTURE.md) | Component diagram, source files, mining loop, wallet lifecycle, fillMempool |
| [Configuration](https://github.com/XChain-platform/xchain-documentation/blob/master/components/regtest-miner/CONFIGURATION.md) | Environment variables, internal constants, timer behavior, backoff |
| [Operations](https://github.com/XChain-platform/xchain-documentation/blob/master/components/regtest-miner/OPERATIONS.md) | JSON-RPC API endpoints, startup sequence, Docker, troubleshooting |

## Quick Start

```bash
git clone https://github.com/XChain-platform/xchain-regtest-miner.git
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

## Scripts

| Command | Description |
|---|---|
| `npm run api` | Start the miner and JSON-RPC API server |
| `npm test` | All tests (~901 tests) |
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
| Unit | ~120 | `XChainRegtestMiner.test.js`, `BlockchainConnector.test.js`, `api.test.js`: constructor, timers, wallet prep, mining loop, fillMempool chunking, RPC formatting, API dispatch |
| Integration | ~80 | 4 seam files: HTTP/JSON-RPC, Miner/Connector sequences, fillMempool/bitcoinjs-lib crypto, Connector/MockRpcServer |
| E2E | ~30 | StatefulMockNode: startup lifecycle, mempool detection, block generation, fill-mempool, API, chain state, resilience |
| Smoke | 12 | Instantiation, wallet prep paths, mempool detection, timer expiry, pause/resume, API health |
| Boundary | ~87 | Timer edges, mempool state machine, fillMempool quantities, wallet state transitions, RPC edge cases, combined scenarios |
| Security | ~159 | Input validation, env validation, connector error sanitization, error disclosure, API hardening, resource exhaustion |
| Fuzz | ~50 | Property-based via fast-check: RPC parameters, RPC responses, fillMempool stress, mining loop edge cases, timer behavior |
| Chaos | ~22 | RPC disruption, timeout, flapping, response corruption, auth failures, fillMempool interruption, SIGTERM |
| Performance | ~28 | Block generation latency, mempool polling, fillMempool scaling, RPC latency, sustained load, API throughput |
| Mutation | - | Stryker Mutator: full service and unit-only configs, 90% high / 75% low / 60% break thresholds |
| Regression | 147 | Three-tier suite: T0 critical gate (45), T1 standard (89), T2 full E2E (13) |
| **Total** | **~901** | |

---

**Copyright &copy; 2025-2026 Dankest, LLC**

**Based on XChain Platform by Dankest, LLC &ndash; https://dankest.llc**

Licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0-or-later)
with a commercial license available for proprietary use.

You may use, modify, and distribute this material under the terms of the License.
See [LICENSE](./LICENSE.md) and [NOTICE](./NOTICE.md) for full terms.
See the [licensing overview](https://docs.xchain.io/legal/LICENSING.html).
