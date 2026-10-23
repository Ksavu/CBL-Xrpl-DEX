-- xdex indexer schema
-- Orientation: asset1 is XRP whenever one side is XRP (matches the frontend).
-- Asset ids: 'XRP' or 'CURRENCY.rIssuer'.

CREATE TABLE IF NOT EXISTS pools (
  account        text PRIMARY KEY,           -- AMM account (LP token issuer)
  asset1         text NOT NULL,
  asset2         text NOT NULL,
  reserve1       numeric NOT NULL DEFAULT 0,
  reserve2       numeric NOT NULL DEFAULT 0,
  lp_supply      numeric NOT NULL DEFAULT 0,
  trading_fee    integer NOT NULL DEFAULT 0, -- 1/100,000 units
  created_ledger bigint,
  deleted        boolean NOT NULL DEFAULT false,
  synced_ledger  bigint,                     -- last full amm_info resync
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset1, asset2)
);

CREATE INDEX IF NOT EXISTS pools_asset2_idx ON pools (asset2);

-- One row per pool-affecting transaction.
-- delta1/delta2 are changes to the POOL's reserves (+ = pool received).
-- price = reserve1 / reserve2 after the tx (asset1 per asset2, e.g. XRP per token).
CREATE TABLE IF NOT EXISTS trades (
  id           bigserial PRIMARY KEY,
  pool         text NOT NULL REFERENCES pools(account),
  ledger_index bigint NOT NULL,
  tx_hash      text NOT NULL,
  ts           timestamptz NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('swap', 'deposit', 'withdraw')),
  account      text,
  delta1       numeric NOT NULL,
  delta2       numeric NOT NULL,
  reserve1     numeric NOT NULL,
  reserve2     numeric NOT NULL,
  price        numeric,
  UNIQUE (tx_hash, pool)
);

CREATE INDEX IF NOT EXISTS trades_pool_ts_idx ON trades (pool, ts DESC);
CREATE INDEX IF NOT EXISTS trades_ts_idx ON trades (ts DESC);

CREATE TABLE IF NOT EXISTS indexer_state (
  key   text PRIMARY KEY,
  value text NOT NULL
);
