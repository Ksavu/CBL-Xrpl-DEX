import 'server-only'
import { FEATURED_PAIRS } from '@/config'
import { type Pool, getPool, getPoolByAccount, tvlInXrp } from '@/lib/xrpl/amm'
import { BigNumber, assetId, isXrp, parseAssetId } from '@/lib/xrpl/assets'
import { getClient } from '@/lib/xrpl/client'
import { getDb } from './db'

/** JSON-safe pool row for the pools list and token selector. */
export interface PoolSummary {
  account: string
  asset1: string
  asset2: string
  reserve1: string
  reserve2: string
  tradingFee: number
  /** XRP-denominated TVL when one side is XRP. */
  tvlXrp: string | null
  /** Price of asset2 in units of asset1. */
  price: string
  volume24h1: string | null
  change24h: number | null
}

/** Canonical orientation: XRP first if present, otherwise as stored. */
function summarize(p: Pool): PoolSummary {
  const flip = !isXrp(p.asset1) && isXrp(p.asset2)
  const [a1, a2, r1, r2] = flip
    ? [p.asset2, p.asset1, p.reserve2, p.reserve1]
    : [p.asset1, p.asset2, p.reserve1, p.reserve2]
  return {
    account: p.account,
    asset1: assetId(a1),
    asset2: assetId(a2),
    reserve1: r1.toFixed(),
    reserve2: r2.toFixed(),
    tradingFee: p.tradingFee,
    tvlXrp: tvlInXrp(p)?.toFixed(6) ?? null,
    price: r2.gt(0) ? r1.div(r2).toFixed() : '0',
    volume24h1: null,
    change24h: null,
  }
}

let cache: { at: number; rows: PoolSummary[] } | null = null
const CACHE_MS = 5 * 60_000
const FALLBACK_SCAN = 120

export async function listPools(): Promise<{ source: 'indexer' | 'ledger'; pools: PoolSummary[] }> {
  const db = getDb()
  if (db) {
    const r = await db.query(`
      SELECT p.account, p.asset1, p.asset2, p.reserve1::text, p.reserve2::text, p.trading_fee,
             CASE WHEN p.asset1 = 'XRP' THEN (p.reserve1 * 2)::text END AS tvl_xrp,
             CASE WHEN p.reserve2 > 0 THEN (p.reserve1 / p.reserve2)::text ELSE '0' END AS price,
             v.vol::text AS vol,
             CASE WHEN o.price_open > 0 AND p.reserve2 > 0
                  THEN ((p.reserve1 / p.reserve2) / o.price_open - 1) * 100 END AS change
        FROM pools p
        LEFT JOIN LATERAL (
          SELECT SUM(ABS(delta1)) AS vol FROM trades
           WHERE pool = p.account AND kind = 'swap' AND ts > now() - interval '24 hours'
        ) v ON true
        LEFT JOIN LATERAL (
          SELECT price AS price_open FROM trades
           WHERE pool = p.account AND ts > now() - interval '24 hours'
           ORDER BY ts ASC LIMIT 1
        ) o ON true
       WHERE NOT p.deleted
       ORDER BY (CASE WHEN p.asset1 = 'XRP' THEN p.reserve1 ELSE 0 END) DESC
       LIMIT 500`)
    return {
      source: 'indexer',
      pools: r.rows.map((x) => ({
        account: x.account,
        asset1: x.asset1,
        asset2: x.asset2,
        reserve1: x.reserve1,
        reserve2: x.reserve2,
        tradingFee: x.trading_fee,
        tvlXrp: x.tvl_xrp,
        price: x.price,
        volume24h1: x.vol,
        change24h: x.change == null ? null : Number(x.change),
      })),
    }
  }

  if (cache && Date.now() - cache.at < CACHE_MS) return { source: 'ledger', pools: cache.rows }

  // No indexer: featured pairs + a sample of AMMs from ledger_data.
  const c = await getClient()
  const found = new Map<string, Pool>()

  for (const [a, b] of FEATURED_PAIRS) {
    try {
      const p = await getPool(c, parseAssetId(a), parseAssetId(b))
      if (p) found.set(p.account, p)
    } catch {}
  }

  try {
    const r: any = await c.request({ command: 'ledger_data', type: 'amm', limit: FALLBACK_SCAN, ledger_index: 'validated' })
    const accounts: string[] = r.result.state.map((s: any) => s.Account).filter((a: string) => !found.has(a))
    for (let i = 0; i < accounts.length; i += 8) {
      const batch = await Promise.all(accounts.slice(i, i + 8).map((a) => getPoolByAccount(c, a).catch(() => null)))
      for (const p of batch) if (p) found.set(p.account, p)
    }
  } catch (e) {
    console.error('ledger_data scan failed', e)
  }

  const rows = [...found.values()]
    .map(summarize)
    .sort((x, y) => new BigNumber(y.tvlXrp ?? 0).comparedTo(x.tvlXrp ?? 0) ?? 0)
  cache = { at: Date.now(), rows }
  return { source: 'ledger', pools: rows }
}

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

const BUCKETS: Record<string, string> = { '5m': '5 minutes', '15m': '15 minutes', '1h': '1 hour', '4h': '4 hours', '1d': '1 day' }

/** OHLC candles of the pool price (asset1 per asset2) from indexed trades. */
export async function getCandles(poolAccount: string, tf: string): Promise<Candle[] | null> {
  const db = getDb()
  if (!db) return null
  const bucket = BUCKETS[tf] ?? BUCKETS['15m']
  const r = await db.query(
    `SELECT extract(epoch FROM date_bin($2::interval, ts, timestamp '2000-01-01'))::bigint AS t,
            (array_agg(price ORDER BY ts ASC, id ASC))[1]   AS open,
            MAX(price) AS high, MIN(price) AS low,
            (array_agg(price ORDER BY ts DESC, id DESC))[1] AS close,
            COALESCE(SUM(ABS(delta1)) FILTER (WHERE kind = 'swap'), 0) AS vol
       FROM trades
      WHERE pool = $1 AND price IS NOT NULL
      GROUP BY 1 ORDER BY 1 DESC LIMIT 500`,
    [poolAccount, bucket],
  )
  return r.rows
    .map((x) => ({
      time: Number(x.t),
      open: Number(x.open),
      high: Number(x.high),
      low: Number(x.low),
      close: Number(x.close),
      volume: Number(x.vol),
    }))
    .reverse()
}

export interface TradeRow {
  hash: string
  ts: string
  kind: 'swap' | 'deposit' | 'withdraw'
  account: string | null
  delta1: string
  delta2: string
  price: string | null
}

export async function getTrades(poolAccount: string, limit = 50): Promise<TradeRow[] | null> {
  const db = getDb()
  if (!db) return null
  const r = await db.query(
    `SELECT tx_hash AS hash, ts, kind, account, delta1::text, delta2::text, price::text
       FROM trades WHERE pool = $1 ORDER BY ts DESC, id DESC LIMIT $2`,
    [poolAccount, Math.min(limit, 200)],
  )
  return r.rows.map((x) => ({ ...x, ts: new Date(x.ts).toISOString() }))
}
