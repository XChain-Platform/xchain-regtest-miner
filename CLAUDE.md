# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Run the API server:**
```
npm run api
```
This executes `node ./src/api.js` and starts both the miner loop and the JSON-RPC HTTP server.

**Build and run with Docker:**
```
docker build -t xchain-regtest-miner .
docker run --env-file .env xchain-regtest-miner
```

There are no tests or linter configured in this project.

## Architecture

The service has three files in `src/`:

**`api.js`** — Entry point. Reads environment variables, instantiates `XChainRegtestMiner`, calls `miner.start()`, then starts an Express HTTP server exposing a JSON-RPC router. All API methods delegate directly to the miner instance.

**`XChainRegtestMiner.js`** — Core logic. On `start()`, it prepares a wallet (creating one if needed, mining 101 initial blocks if balance is zero), then enters an infinite loop polling the mempool every second. When transactions appear, it waits up to `MAX_TIME_TO_MINE_TXS` (30s) and resets a shorter `ADDED_TIME_TO_MINE_TXS` (5s) timer on each new tx before calling `generateBlocks(1)`. The `keepMining` flag pauses auto-mining (used by `fill_mempool`). `fillMempool` uses bitcoinjs-lib/bip32/bip39 to construct and broadcast raw transactions directly, bypassing the node wallet.

**`BlockchainConnector.js`** — Thin RPC client. Wraps Bitcoin node JSON-RPC calls via axios (60s timeout, keepAlive). All methods post to `http://<NODE_URL>:<NODE_PORT>` with HTTP Basic auth.

## Environment Variables

Required in `.env` (see Dockerfile for context):

| Variable | Description |
|---|---|
| `NETWORK` | Bitcoin network name (e.g. `regtest`) |
| `NODE_URL` | Hostname/IP of the Bitcoin node |
| `NODE_PORT` | RPC port of the Bitcoin node |
| `NODE_USER` | RPC username |
| `NODE_PASSWORD` | RPC password |
| `REGTEST_MINER_API_PORT` | Port this service's HTTP server listens on |

## JSON-RPC API

All requests are JSON-RPC 2.0 POSTs to the root path. Methods:

- `ping` — Health check, returns `{status:"success"}`
- `send_funds({address, amount})` — Sends funds via the node wallet's `sendtoaddress`
- `fill_mempool({tx_quantity})` — Pauses auto-mining and broadcasts `tx_quantity` raw transactions into the mempool using locally constructed PSBTs
- `continue_mining({})` — Resumes auto-mining after `fill_mempool`
- `set_mining_time({max_time, tx_added_time})` — Overrides timing constants (integers, milliseconds)
- `set_default_mining_time()` — Resets to defaults (30000ms / 5000ms)
