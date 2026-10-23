/**
 * xdex indexer — follows validated ledgers and records AMM pool activity.
 *
 *   DATABASE_URL=postgres://... npm run db:init
 *   DATABASE_URL=postgres://... npm run indexer
 *
 * Strategy: for every validated ledger (live or backfill), fetch it with
 * expanded transactions, extract AMM reserve changes from metadata and write
 * them in one DB transaction together with the ledger cursor. Idempotent:
 * re-processing a ledger is a no-op thanks to UNIQUE (tx_hash, pool).
 */
import { Client } from 'xrpl'
import { Pool as PgPool, type PoolClient } from 'pg'
import BigNumber from 'bignumber.js'
import { type KnownPool, canonicalPair } from './extract'
import { type LedgerTx, applyLedger, setState } from './store'

BigNumber.config({ EXPONENTIAL_AT: [-40, 40] })

const NETWORK = process.env.NEXT_PUBLIC_XRPL_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
const WS =
  process.env.INDEXER_WS ??
  (NETWORK === 'mainnet' ? 'wss://xrplcluster.com' : 'wss://s.altnet.rippletest.net:51233')
/** If we fall further behind than this, skip ahead and resync instead of backfilling. */
const MAX_BACKFILL = Number(process.env.INDEXER_MAX_BACKFILL ?? 20_000)
const RIPPLE_EPOCH = 946_684_800

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const db = new PgPool({ connectionString: process.env.DATABASE_URL, max: 4 })
const client = new Client(WS, { connectionTimeout: 15_000 })
const pools = new Map<string, KnownPool>()
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a)

const assetIdOf = (a: any) => (typeof a === 'string' || a.currency === 'XRP' ? 'XRP' : `${a.currency}.${a.issuer}`)
const valueOf = (a: any) => (typeof a === 'string' ? new BigNumber(a).shiftedBy(-6) : new BigNumber(a.value))

async function getState(key: string): Promise<string | null> {
  const r = await db.query('SELECT value FROM indexer_state WHERE key = $1', [key])
  return r.rows[0]?.value ?? null
}


/** Refresh one pool from amm_info (authoritative) and upsert it. */
async function syncPool(account: string, q: PoolClient | PgPool = db, ledger?: number): Promise<KnownPool | null> {
  let amm: any
  try {
    const r: any = await client.request({ command: 'amm_info', amm_account: account, ledger_index: ledger ?? 'validated' } as any)
    amm = r.result.amm
  } catch (e: any) {
    if (e?.data?.error === 'actNotFound') return null
    throw e
  }
  const id1 = assetIdOf(amm.amount)
  const id2 = assetIdOf(amm.amount2)
  const [a1, a2] = canonicalPair(id1, id2)
  const flipped = a1 !== id1
  const r1 = valueOf(flipped ? amm.amount2 : amm.amount)
  const r2 = valueOf(flipped ? amm.amount : amm.amount2)
  await q.query(
    `INSERT INTO pools (account, asset1, asset2, reserve1, reserve2, lp_supply, trading_fee, synced_ledger, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
     ON CONFLICT (account) DO UPDATE SET reserve1 = EXCLUDED.reserve1, reserve2 = EXCLUDED.reserve2,
       lp_supply = EXCLUDED.lp_supply, trading_fee = EXCLUDED.trading_fee, synced_ledger = EXCLUDED.synced_ledger,
       deleted = false, updated_at = now()`,
    [account, a1, a2, r1.toFixed(), r2.toFixed(), amm.lp_token.value, amm.trading_fee ?? 0, ledger ?? null],
  )
  const p = { account, asset1: a1, asset2: a2 }
  pools.set(account, p)
  return p
}

/** First run: discover every AMM on the ledger and load its reserves. */
async function bootstrap() {
  const existing = await db.query('SELECT account, asset1, asset2 FROM pools WHERE NOT deleted')
  for (const r of existing.rows) pools.set(r.account, r)
  if (pools.size > 0) {
    log(`Loaded ${pools.size} known pools`)
    return
  }
  log('Bootstrapping pool list from ledger_data…')
  const accounts: string[] = []
  let marker: unknown
  do {
    const r: any = await client.request({
      command: 'ledger_data',
      type: 'amm',
      limit: 400,
      ledger_index: 'validated',
      ...(marker ? { marker } : {}),
    } as any)
    for (const s of r.result.state) accounts.push(s.Account)
    marker = r.result.marker
  } while (marker)
  log(`Found ${accounts.length} AMMs, loading reserves…`)
  for (let i = 0; i < accounts.length; i += 6) {
    await Promise.all(accounts.slice(i, i + 6).map((a) => syncPool(a).catch((e) => log('sync failed', a, e?.message))))
    if (i % 600 === 0 && i) log(`  ${i}/${accounts.length}`)
  }
  log('Bootstrap complete')
}

async function processLedger(seq: number) {
  const r: any = await client.request({
    command: 'ledger',
    ledger_index: seq,
    transactions: true,
    expand: true,
  } as any)
  const ledger = r.result.ledger
  const ts = ledger.close_time_iso
    ? new Date(ledger.close_time_iso)
    : new Date((Number(ledger.close_time) + RIPPLE_EPOCH) * 1000)

  const txs: LedgerTx[] = (ledger.transactions ?? []).map((t: any) => {
    // API v2: { tx_json, meta, hash }; v1: flat tx with metaData
    const tx = t.tx_json ?? t.tx ?? t
    const meta = t.meta ?? t.metaData
    return { tx, meta, hash: t.hash ?? tx.hash }
  })
  const conn = await db.connect()
  let written = 0
  try {
    written = await applyLedger(conn, seq, ts, txs, pools, (acct, c, l) => syncPool(acct, c, l))
  } finally {
    conn.release()
  }
  if (written) log(`ledger ${seq}: ${written} pool events`)
}

let latestValidated = 0
let running = false

async function catchUp() {
  if (running) return
  running = true
  try {
    let last = Number((await getState('last_ledger')) ?? 0)
    if (!last || latestValidated - last > MAX_BACKFILL) {
      if (last) log(`Behind by ${latestValidated - last} ledgers (> ${MAX_BACKFILL}); skipping ahead and resyncing pools`)
      for (const acct of pools.keys()) await syncPool(acct).catch(() => null)
      last = latestValidated - 1
      await setState(db, 'last_ledger', String(last))
    }
    while (last < latestValidated) {
      await processLedger(last + 1)
      last++
    }
  } finally {
    running = false
  }
}

async function main() {
  log(`Indexer starting on ${NETWORK} via ${WS}`)
  await client.connect()
  await bootstrap()

  const info = await client.request({ command: 'server_info' })
  latestValidated = info.result.info.validated_ledger?.seq ?? 0

  client.on('ledgerClosed', (l: any) => {
    latestValidated = Math.max(latestValidated, l.ledger_index)
    catchUp().catch((e) => log('catch-up error', e?.message ?? e))
  })
  client.on('disconnected', async (code: number) => {
    log(`Disconnected (${code}), reconnecting in 3s…`)
    await new Promise((r) => setTimeout(r, 3000))
    try {
      await client.connect()
      await client.request({ command: 'subscribe', streams: ['ledger'] })
      log('Reconnected')
    } catch (e: any) {
      log('Reconnect failed', e?.message)
    }
  })

  await client.request({ command: 'subscribe', streams: ['ledger'] })
  await catchUp()
  log('Following ledgers')
}

process.on('SIGINT', async () => {
  log('Shutting down')
  await client.disconnect().catch(() => {})
  await db.end()
  process.exit(0)
})

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
