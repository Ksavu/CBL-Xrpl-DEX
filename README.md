# xdex — XRPL DEX (MVP)

Swap UI and liquidity manager on top of the XRP Ledger's **native** AMM and order book. There are no smart contracts: the ledger itself matches trades. This app quotes trades, builds transactions, gets them signed in the user's wallet, and indexes pool activity for charts.

## Stack

- Next.js 16 (App Router) + TypeScript
- xrpl.js 5 — ledger reads, quotes and transaction building
- Wallets: Xaman (QR / deeplink / xApp), Crossmark, GemWallet
- Postgres + a Node indexer for trades, candles and pool rankings (optional)

## Quick start

```bash
npm install
cp .env.example .env.local      # set network + Xaman API key
npm run dev                     # http://localhost:3000
```

Xaman requires an API key from https://apps.xaman.dev. Add your site's origin (e.g. `http://localhost:3000`) to the app's redirect URIs.

### With the indexer (charts, 24h volume, every pool ranked)

```bash
export DATABASE_URL=postgres://user:pass@localhost:5432/xdex
npm run db:init       # apply indexer/schema.sql
npm run indexer       # bootstraps every AMM, then follows ledgers
```

The indexer processes each validated ledger in one DB transaction with its cursor. Restarts resume where it stopped, and replays are no-ops. If it falls more than `INDEXER_MAX_BACKFILL` ledgers behind (default 20k, about 22h), it skips ahead and resyncs reserves from `amm_info`.

Without `DATABASE_URL`, the Pools page shows featured pairs plus a sample of on-ledger AMMs, and charts show a "needs the indexer" state.

## How swaps work

A swap is an `OfferCreate` with `tfSell | tfFillOrKill`:

- `TakerGets` is the exact amount in, and `TakerPays` is the minimum out (quote minus slippage).
- Offer crossing consumes AMM pools and order-book offers together and auto-bridges token→token through XRP. Users never get less than the minimum. If the price moved too far, the tx fails with `tecKILLED` and nothing trades.
- The quote is re-fetched right before signing.

Quotes are computed client-side from AMM reserves using the XLS-30 formula (constant product, fee on input). They cover direct and via-XRP routes. Order-book depth isn't included in the quote, so actual fills can only be equal or better.

First-time buyers of a token are asked to enable it, which sends a `TrustSet` that locks the owner reserve (0.2 XRP).

## Project layout

```
src/
  config.ts                 network, endpoints, blackhole addresses
  lib/xrpl/
    assets.ts               asset ids, currency codes, amount conversion
    amm.ts                  pool reads + AMM math (swap, LP, canonical orientation)
    quote.ts                exact-in quotes, direct + via XRP
    tx.ts                   tx builders: swap, trust line, deposit, withdraw, create
    account.ts              balances, reserves, trust lines
    token.ts                issuer safety checks (blackhole, clawback, freeze, fees)
    client.ts               shared WS client with failover, validation polling
  lib/wallet/               Xaman / Crossmark / GemWallet adapters + React context
  lib/server/               API data access (Postgres or ledger fallback)
  app/                      / (swap), /pools, /pool/[a]/[b], /token/[id], /api/*
  components/               SwapCard, AssetPicker, LiquidityPanel, PriceChart, …
indexer/
  extract.ts                pure: tx metadata → pool events (unit-tested)
  store.ts                  writes a ledger atomically (integration-tested)
  index.ts                  runtime: bootstrap, follow ledgers, backfill, reconnect
scripts/testnet-smoke.ts    end-to-end run on testnet with faucet wallets
```

## CBL integration

Deploy steps, subdomain DNS, embedding and fee details: [`docs/CBL-INTEGRATION.md`](docs/CBL-INTEGRATION.md).

## Tests

```bash
npm test                    # AMM math, quotes, tx builders, metadata extraction
DATABASE_URL=... npm run test:db   # indexer writes + candle SQL on real Postgres (drops tables!)
npm run smoke               # full testnet flow: issue, create pool, buy, sell, LP in/out
```

## Before mainnet

- **Run `npm run smoke` on testnet first.** It also reports whether a swap without a trust line succeeds. If it does, the Enable step can become optional.
- Set your own `SOURCE_TAG` in `src/lib/xrpl/tx.ts` so your volume is attributable on-chain.
- **Swap fee:** set `NEXT_PUBLIC_FEE_ACCOUNT` and `NEXT_PUBLIC_FEE_BPS`. Fees are collected in XRP via an atomic Batch transaction, with an automatic fallback to a second payment. See `docs/CBL-INTEGRATION.md`.
- Point `NEXT_PUBLIC_XRPL_WS` and `INDEXER_WS` at your own or paid nodes. Public clusters rate-limit.
- MPT (XLS-33) assets are not handled yet. Pools containing them are skipped.
