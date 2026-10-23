import BigNumber from 'bignumber.js'
import type { PoolClient } from 'pg'
import { type KnownPool, extract } from './extract'

export interface LedgerTx {
  tx: any
  meta: any
  hash: string
}

export async function setState(q: { query: PoolClient['query'] }, key: string, value: string) {
  await q.query(
    'INSERT INTO indexer_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, value],
  )
}

/**
 * Apply one validated ledger's transactions in a single DB transaction and
 * advance the cursor. Idempotent via UNIQUE (tx_hash, pool).
 * Returns the number of pool events written.
 */
export async function applyLedger(
  conn: PoolClient,
  seq: number,
  ts: Date,
  txs: LedgerTx[],
  pools: Map<string, KnownPool>,
  syncUnknown: (account: string, conn: PoolClient, seq: number) => Promise<unknown>,
): Promise<number> {
  let written = 0
  const sorted = [...txs].sort((a, b) => (a.meta?.TransactionIndex ?? 0) - (b.meta?.TransactionIndex ?? 0))
  await conn.query('BEGIN')
  try {
    for (const { tx, meta, hash } of sorted) {
      if (!meta || typeof meta !== 'object') continue
      const ex = extract(tx, meta, pools)

      for (const c of ex.created) {
        await conn.query(
          `INSERT INTO pools (account, asset1, asset2, lp_supply, trading_fee, created_ledger)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (account) DO UPDATE SET deleted = false, created_ledger = EXCLUDED.created_ledger`,
          [c.account, c.asset1, c.asset2, c.lpSupply, c.tradingFee, seq],
        )
        pools.set(c.account, { account: c.account, asset1: c.asset1, asset2: c.asset2 })
      }
      for (const acct of ex.unknown) await syncUnknown(acct, conn, seq).catch(() => null)

      for (const e of ex.events) {
        const cur = await conn.query('SELECT reserve1, reserve2 FROM pools WHERE account = $1 FOR UPDATE', [e.pool])
        if (!cur.rows[0]) continue
        const r1 = e.final1 ?? new BigNumber(cur.rows[0].reserve1).plus(e.delta1)
        const r2 = e.final2 ?? new BigNumber(cur.rows[0].reserve2).plus(e.delta2)
        const price = r2.gt(0) ? r1.div(r2).toFixed(30) : null
        const ins = await conn.query(
          `INSERT INTO trades (pool, ledger_index, tx_hash, ts, kind, account, delta1, delta2, reserve1, reserve2, price)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (tx_hash, pool) DO NOTHING`,
          [e.pool, seq, hash, ts, e.kind, e.account, e.delta1.toFixed(), e.delta2.toFixed(), r1.toFixed(), r2.toFixed(), price],
        )
        if (ins.rowCount) {
          written++
          await conn.query(
            `UPDATE pools SET reserve1 = $2, reserve2 = $3,
               lp_supply = COALESCE($4, lp_supply), trading_fee = COALESCE($5, trading_fee), updated_at = now()
             WHERE account = $1`,
            [e.pool, r1.toFixed(), r2.toFixed(), e.lpSupply, e.tradingFee],
          )
        }
      }

      for (const acct of ex.deleted) {
        await conn.query('UPDATE pools SET deleted = true, reserve1 = 0, reserve2 = 0, updated_at = now() WHERE account = $1', [acct])
        pools.delete(acct)
      }
    }
    await setState(conn, 'last_ledger', String(seq))
    await conn.query('COMMIT')
  } catch (e) {
    await conn.query('ROLLBACK').catch(() => {})
    throw e
  }
  return written
}
