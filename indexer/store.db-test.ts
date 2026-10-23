/**
 * Integration test against a real Postgres (DATABASE_URL must point to a disposable DB).
 *   DATABASE_URL=postgres://... npm run test:db
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import type { KnownPool } from './extract'
import { applyLedger } from './store'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL required')
const db = new Pool({ connectionString: url })
after(() => db.end())

const AMM = 'rAMMaccountXXXXXXXXXXXXXXXXXXXXXX'
const ISSUER = 'rIssuerXXXXXXXXXXXXXXXXXXXXXXXXX'
const CUR = '4D454D4500000000000000000000000000000000'
const TOKEN = `${CUR}.${ISSUER}`

function swapMeta(xrpBefore: number, xrpAfter: number, tokBefore: number, tokAfter: number) {
  return {
    TransactionResult: 'tesSUCCESS',
    TransactionIndex: 0,
    AffectedNodes: [
      {
        ModifiedNode: {
          LedgerEntryType: 'AccountRoot',
          FinalFields: { Account: AMM, Balance: String(xrpAfter * 1e6) },
          PreviousFields: { Balance: String(xrpBefore * 1e6) },
        },
      },
      {
        ModifiedNode: {
          LedgerEntryType: 'RippleState',
          FinalFields: {
            Balance: { currency: CUR, issuer: 'rrrrrrrrrrrrrrrrrrrrBZbvji', value: String(tokAfter) },
            HighLimit: { currency: CUR, issuer: ISSUER, value: '0' },
            LowLimit: { currency: CUR, issuer: AMM, value: '0' },
          },
          PreviousFields: { Balance: { currency: CUR, issuer: 'rrrrrrrrrrrrrrrrrrrrBZbvji', value: String(tokBefore) } },
        },
      },
    ],
  }
}

test('applyLedger writes trades, updates reserves, is idempotent; candle SQL works', async () => {
  await db.query('DROP TABLE IF EXISTS trades, pools, indexer_state')
  await db.query(readFileSync(join(__dirname, 'schema.sql'), 'utf8'))
  await db.query(`INSERT INTO pools (account, asset1, asset2, reserve1, reserve2) VALUES ($1, 'XRP', $2, 1000, 100000)`, [AMM, TOKEN])
  const pools = new Map<string, KnownPool>([[AMM, { account: AMM, asset1: 'XRP', asset2: TOKEN }]])
  const noSync = async () => null

  const t0 = new Date(Date.now() - 30 * 60_000)
  const conn = await db.connect()
  try {
    // buy: pool +10 XRP, -990 tokens
    let n = await applyLedger(conn, 100, t0, [{ tx: { TransactionType: 'OfferCreate', Account: 'rBuyer' }, meta: swapMeta(1000, 1010, 100000, 99010), hash: 'H1' }], pools, noSync)
    assert.equal(n, 1)
    // replay same ledger → no duplicates
    n = await applyLedger(conn, 100, t0, [{ tx: { TransactionType: 'OfferCreate', Account: 'rBuyer' }, meta: swapMeta(1000, 1010, 100000, 99010), hash: 'H1' }], pools, noSync)
    assert.equal(n, 0)
    // sell 20 minutes later: pool -5 XRP, +500 tokens
    n = await applyLedger(conn, 101, new Date(t0.getTime() + 20 * 60_000), [{ tx: { TransactionType: 'Payment', Account: 'rSeller' }, meta: swapMeta(1010, 1005, 99010, 99510), hash: 'H2' }], pools, noSync)
    assert.equal(n, 1)
  } finally {
    conn.release()
  }

  const p = (await db.query('SELECT reserve1::text, reserve2::text FROM pools WHERE account = $1', [AMM])).rows[0]
  assert.equal(p.reserve1, '1005')
  assert.equal(p.reserve2, '99510')
  const state = (await db.query(`SELECT value FROM indexer_state WHERE key = 'last_ledger'`)).rows[0]
  assert.equal(state.value, '101')

  const trades = (await db.query('SELECT tx_hash, delta1::float, delta2::float, price::float FROM trades ORDER BY ts')).rows
  assert.equal(trades.length, 2)
  assert.equal(trades[0].delta1, 10)
  assert.ok(Math.abs(trades[0].price - 1010 / 99010) < 1e-12)

  // Same candle query the API uses
  const candles = (
    await db.query(
      `SELECT extract(epoch FROM date_bin('15 minutes'::interval, ts, timestamp '2000-01-01'))::bigint AS t,
              (array_agg(price ORDER BY ts ASC, id ASC))[1] AS open, MAX(price) AS high, MIN(price) AS low,
              (array_agg(price ORDER BY ts DESC, id DESC))[1] AS close,
              COALESCE(SUM(ABS(delta1)) FILTER (WHERE kind = 'swap'), 0) AS vol
         FROM trades WHERE pool = $1 AND price IS NOT NULL GROUP BY 1 ORDER BY 1`,
      [AMM],
    )
  ).rows
  assert.ok(candles.length >= 1 && candles.length <= 3)
  const totalVol = candles.reduce((s, c) => s + Number(c.vol), 0)
  assert.equal(totalVol, 15)
})
