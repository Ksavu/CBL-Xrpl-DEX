/**
 * Pure extraction of AMM pool activity from validated transaction metadata.
 * No I/O — unit-testable.
 */
import BigNumber from 'bignumber.js'

export interface KnownPool {
  account: string
  asset1: string // canonical: 'XRP' first when present
  asset2: string
}

export interface PoolCreated {
  account: string
  asset1: string
  asset2: string
  tradingFee: number
  lpSupply: string
}

export interface PoolEvent {
  pool: string
  kind: 'swap' | 'deposit' | 'withdraw'
  account: string | null
  /** Change in the pool's reserve (+ = pool received). */
  delta1: BigNumber
  delta2: BigNumber
  /** Reserve after the tx when the ledger node was touched; null = unchanged. */
  final1: BigNumber | null
  final2: BigNumber | null
  lpSupply: string | null
  tradingFee: number | null
}

export interface Extracted {
  created: PoolCreated[]
  deleted: string[]
  /** AMM accounts touched that we don't know yet (joined late). */
  unknown: string[]
  events: PoolEvent[]
}

const assetIdOf = (a: { currency: string; issuer?: string }) =>
  a.currency === 'XRP' || !a.issuer ? 'XRP' : `${a.currency}.${a.issuer}`

/** Orient a pair so XRP is first; otherwise keep ledger order. */
export function canonicalPair(a: string, b: string): [string, string] {
  return b === 'XRP' && a !== 'XRP' ? [b, a] : [a, b]
}

function kindFor(txType: string): PoolEvent['kind'] {
  if (txType === 'AMMDeposit' || txType === 'AMMCreate') return 'deposit'
  if (txType === 'AMMWithdraw' || txType === 'AMMClawback' || txType === 'AMMDelete') return 'withdraw'
  return 'swap'
}

const nodeBody = (n: any) => n.CreatedNode ?? n.ModifiedNode ?? n.DeletedNode

export function extract(tx: any, meta: any, pools: Map<string, KnownPool>): Extracted {
  const out: Extracted = { created: [], deleted: [], unknown: [], events: [] }
  if (!meta || meta.TransactionResult !== 'tesSUCCESS') return out
  const nodes: any[] = meta.AffectedNodes ?? []

  // 1) AMM objects: creations, deletions, LP supply / fee updates.
  const lpInfo = new Map<string, { lp: string | null; fee: number | null }>()
  const local = new Map(pools)
  for (const n of nodes) {
    const b = nodeBody(n)
    if (b?.LedgerEntryType !== 'AMM') continue
    const f = b.NewFields ?? b.FinalFields ?? {}
    const account: string = f.Account
    if (!account) continue
    if (n.CreatedNode) {
      const [a1, a2] = canonicalPair(assetIdOf(f.Asset), assetIdOf(f.Asset2))
      const c: PoolCreated = {
        account,
        asset1: a1,
        asset2: a2,
        tradingFee: f.TradingFee ?? 0,
        lpSupply: f.LPTokenBalance?.value ?? '0',
      }
      out.created.push(c)
      local.set(account, { account, asset1: a1, asset2: a2 })
    } else if (n.DeletedNode) {
      out.deleted.push(account)
    } else {
      lpInfo.set(account, { lp: f.LPTokenBalance?.value ?? null, fee: f.TradingFee ?? null })
      if (!local.has(account) && f.Asset && f.Asset2) {
        const [a1, a2] = canonicalPair(assetIdOf(f.Asset), assetIdOf(f.Asset2))
        local.set(account, { account, asset1: a1, asset2: a2 })
      } else if (!local.has(account)) {
        out.unknown.push(account)
      }
    }
  }

  // 2) Reserve changes: AccountRoot (XRP side) and RippleState (token side).
  type Acc = { d1: BigNumber; d2: BigNumber; f1: BigNumber | null; f2: BigNumber | null; touched: boolean }
  const acc = new Map<string, Acc>()
  const get = (p: string) => {
    let a = acc.get(p)
    if (!a) acc.set(p, (a = { d1: new BigNumber(0), d2: new BigNumber(0), f1: null, f2: null, touched: false }))
    return a
  }
  const apply = (pool: KnownPool, assetId: string, prev: BigNumber, fin: BigNumber) => {
    const a = get(pool.account)
    if (pool.asset1 === assetId) {
      a.d1 = a.d1.plus(fin.minus(prev))
      a.f1 = fin
    } else if (pool.asset2 === assetId) {
      a.d2 = a.d2.plus(fin.minus(prev))
      a.f2 = fin
    } else return
    a.touched = true
  }

  for (const n of nodes) {
    const b = nodeBody(n)
    if (!b) continue
    const fin = b.FinalFields ?? b.NewFields ?? {}
    const prevF = b.PreviousFields ?? {}

    if (b.LedgerEntryType === 'AccountRoot') {
      const pool = local.get(fin.Account)
      if (!pool || pool.asset1 !== 'XRP') continue
      if (n.DeletedNode) continue
      const finalBal = new BigNumber(fin.Balance ?? 0).shiftedBy(-6)
      const prevBal = n.CreatedNode
        ? new BigNumber(0)
        : prevF.Balance !== undefined
          ? new BigNumber(prevF.Balance).shiftedBy(-6)
          : finalBal
      if (!prevBal.eq(finalBal) || n.CreatedNode) apply(pool, 'XRP', prevBal, finalBal)
    } else if (b.LedgerEntryType === 'RippleState') {
      const high = fin.HighLimit?.issuer
      const low = fin.LowLimit?.issuer
      const currency = fin.Balance?.currency ?? fin.HighLimit?.currency
      if (!high || !low || !currency) continue
      for (const [ammAcct, other, ammIsLow] of [
        [low, high, true],
        [high, low, false],
      ] as const) {
        const pool = local.get(ammAcct)
        if (!pool) continue
        const assetId = `${currency}.${other}`
        if (pool.asset1 !== assetId && pool.asset2 !== assetId) continue
        // Balance is from the low account's perspective.
        const sign = ammIsLow ? 1 : -1
        const finalBal = n.DeletedNode ? new BigNumber(0) : new BigNumber(fin.Balance?.value ?? 0).times(sign)
        const prevRaw = n.CreatedNode
          ? new BigNumber(0)
          : prevF.Balance !== undefined
            ? new BigNumber(prevF.Balance.value).times(sign)
            : finalBal
        if (!prevRaw.eq(finalBal) || n.CreatedNode) apply(pool, assetId, prevRaw, finalBal)
      }
    }
  }

  for (const [account, a] of acc) {
    if (!a.touched || (a.d1.isZero() && a.d2.isZero())) continue
    const info = lpInfo.get(account)
    const created = out.created.find((c) => c.account === account)
    out.events.push({
      pool: account,
      kind: kindFor(tx.TransactionType),
      account: tx.Account ?? null,
      delta1: a.d1,
      delta2: a.d2,
      final1: a.f1,
      final2: a.f2,
      lpSupply: created?.lpSupply ?? info?.lp ?? null,
      tradingFee: created?.tradingFee ?? info?.fee ?? null,
    })
  }
  return out
}
