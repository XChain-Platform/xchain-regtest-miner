# Maintainers

This file lists the people responsible for `xchain-regtest-miner`, what each of them owns, and how to escalate issues that need a human's attention beyond what `CONTRIBUTING.md` and `SECURITY.md` cover.

`xchain-regtest-miner` is a development and test utility that auto-mines blocks in regtest environments. It is never deployed as a production component.

The XChain Platform is in pre-launch development and ships under a single primary maintainer today. As contributors take on durable responsibility for areas of the codebase, they will be added here. This is a conventional MAINTAINERS file (an open-source norm used by distros and downstream packagers), not an aspirational org chart.

---

## Primary maintainer

| Role | Name | GitHub | Areas |
|---|---|---|---|
| Lead | J-Dog | [@J-Dog](https://github.com/J-Dog) | Everything: auto-mining loop, API, configuration, safety guards, releases |

Contact:

- General and non-sensitive: open an issue at <https://github.com/XChain-platform/xchain-regtest-miner/issues>.
- Code of Conduct: `conduct@dankest.llc` (per `CODE_OF_CONDUCT.md`).
- Security disclosures: GitHub Private Vulnerability Reporting, or `security@dankest.llc` (per `SECURITY.md`).

---

## Areas of responsibility

Until additional maintainers join, the lead owns every area below. The table is here so a future contributor (or downstream packager) can see what each area entails when scoping a contribution.

| Area | What it covers |
|---|---|
| Auto-mining loop | Adaptive dual-timer mining logic (`XChainRegtestMiner.js`), mempool polling, block generation via `generatetoaddress`, exponential backoff on connection failures |
| API | The JSON-RPC control API (`src/api.js`): `ping`, `send_funds`, `fill_mempool`, `continue_mining`, `set_mining_time`, `set_default_mining_time` |
| Blockchain connector | Node JSON-RPC client and error-sanitizing wrapper (`src/BlockchainConnector.js`); coin network definitions (`src/CryptoNetworks.js`) |
| Configuration and safety guards | Environment variable handling, dev-only guards ensuring the service cannot connect to a value-bearing network |
| Tests | The layered suites under `test/` (unit, integration, e2e, smoke, boundary, security, fuzz, chaos, performance, mutation, regression) |
| Documentation | `README`, `SECURITY`, `CODE_OF_CONDUCT`, `CONTRIBUTING`, `MAINTAINERS`, `CHANGELOG` |

---

## Adding a maintainer

A contributor becomes a maintainer when they have:

1. Sustained contribution in a specific area for at least one release cycle (typically 2 to 3 weeks of active work).
2. Reviewed and merged at least three PRs from outside contributors.
3. Demonstrated awareness of the project's conventions: this is a dev/test-only tool (no production use), raw parameterized RPC calls with no shell interpolation, the `Keep a Changelog` format, and Node 22 as the pinned runtime.

Open a PR adding the new maintainer to the table above with their GitHub handle and area(s) of responsibility. The lead approves and merges.

## Removing a maintainer

A maintainer steps down by opening a PR removing their row. The lead also removes a maintainer who has been inactive for six months or who violates the Code of Conduct, after a written notice period.

---

## Escalation paths

If you cannot reach the relevant area maintainer within a reasonable window:

| Situation | Escalate to |
|---|---|
| Active security incident | `security@dankest.llc` (per `SECURITY.md`) |
| Any path by which it could be pointed at a value-bearing network | Email `security@dankest.llc` |
| Code-of-conduct concern | `conduct@dankest.llc` (per `CODE_OF_CONDUCT.md`) |
| PR has been open without review for 14+ days | Comment `@J-Dog` on the PR; if no response within 7 more days, open an issue tagged `governance` with the PR link |

---

## Decision-making

The lead makes final calls on:

- Mining behavior and the dev-only safety guards.
- Configuration surface and environment variable handling.
- Release timing and version policy.
- Adopting a new heavy dependency.
- Code-of-conduct enforcement, and maintainer additions or removals.

Smaller calls (bug fixes, additions within an existing area, documentation, dependency bumps inside an existing minor) go through PR review by the area maintainer.

---

## Cross-project relationships

| Project | Relationship |
|---|---|
| [`xchain-e2e-test`](https://github.com/XChain-platform/xchain-e2e-test) | Drives the regtest miner during end-to-end test runs |
| [`xchain-documentation`](https://github.com/XChain-platform/xchain-documentation) | Protocol spec and component docs for the regtest miner |
| Coin nodes (`bitcoind` / `litecoind` / `dogecoind`) | The miner calls these via JSON-RPC to generate blocks; they are upstream projects, not maintained here |

The regtest-miner maintainer is not automatically a maintainer of those sibling projects. Cross-project changes go through each project's own review process.
