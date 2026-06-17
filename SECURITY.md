# Security Policy

`xchain-regtest-miner` is a development utility that auto-mines mempool transactions for regtest environments. **It is strictly a development and testing tool and must never be pointed at mainnet or any value-bearing network.** There are no real funds at risk in its intended deployment, but we still accept and act on security reports.

If you've found a security issue, please **do not open a public issue or pull request**. Use the private channels below.

---

## How to report

### Preferred: GitHub Private Vulnerability Reporting

Open a draft advisory at:

<https://github.com/XChain-platform/xchain-regtest-miner/security/advisories/new>

This is the fastest path. The advisory is private until we publish it.

### Alternative: Email

Email **security@dankest.llc** with:

- A description of the issue and the threat it poses.
- Reproduction steps or a proof-of-concept (a config, API call, or payload that triggers the bug).
- The affected version (see `CHANGELOG.md` and the version badge in `README.md`).
- Any patches or mitigations you'd like considered.

For sensitive reports, encrypt the email body to our PGP key. The fingerprint will be published alongside the first signed release artifact; until then, the email channel is acceptable for first contact and we will coordinate an encrypted exchange before you share proof-of-concept details.

We do not currently offer a paid bug bounty. We do offer public credit in release notes and the advisory itself, unless you prefer to remain anonymous.

---

## Response timeline

| Stage | Target |
|---|---|
| Initial acknowledgement | within 72 hours |
| Triage + severity assignment | within 7 days |
| Fix or mitigation in master | within 30 days for high/critical, 90 days for lower severities |
| Coordinated public disclosure | up to 90 days from initial report, or sooner if a fix has shipped and operators are protected |

If we cannot meet a timeline, we will tell you why and propose a new one. We will not silently let a report age.

---

## Scope

### In scope

- Any path by which the miner could be configured or induced to act against mainnet or a value-bearing testnet rather than a local regtest chain.
- The JSON-RPC API surface (`npm run api`): injection or abuse of the six RPC methods (`ping`, `send_funds`, `fill_mempool`, `continue_mining`, `set_mining_time`, `set_default_mining_time`).
- Leaked credentials in config or error output (the miner handles RPC credentials; a disclosure path is in scope).
- Denial-of-service against the miner process via crafted API calls, mempool payloads, or timer manipulation that would exhaust resources or crash the service.

### Out of scope

- Behavior on the chains the miner mines (this is regtest-only tooling; the chains themselves are out of scope).
- The operator's local stack security (host hardening, coin-node RPC exposure, firewall config).
- Vulnerabilities inside the coin node (`bitcoind` / `litecoind` / `dogecoind`); report those to their respective projects.
- Findings in other XChain services that happen to share a regtest environment with this miner; report those against their own repositories.

If you are unsure, send the report anyway and we will tell you whether it falls in scope.

---

## What we ask

- Give us a reasonable window to fix before disclosing publicly. The 90-day ceiling is firm; earlier is fine once a fix has shipped and operators are protected.
- Test against `regtest` only. This service is not designed for testnet or mainnet use.
- Do not run automated scanners against shared XChain infrastructure in a way that would impact availability for other operators.
- Do not access data, or attempt to access data, beyond what is needed to demonstrate the issue.

---

## What we will do

- Confirm receipt within the SLA above.
- Keep you informed as triage and remediation proceed.
- Credit you in the advisory and `CHANGELOG.md` entry, on request.
- Coordinate a CVE assignment when the severity warrants it.
- Publish a post-fix advisory describing the issue, the fix, and the affected version range.

---

## Versions covered

We ship security fixes against the latest release on `master`. Older releases are unsupported. The current version is recorded in `CHANGELOG.md` and the badge in `README.md`.

---

Last reviewed: 2026-06-16.
