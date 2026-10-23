'use client'

import { useEffect, useState } from 'react'
import { explorerTx } from '@/config'
import type { TradeRow } from '@/lib/server/pools'
import { type Asset, BigNumber, assetLabel, fmt, shortAddr } from '@/lib/xrpl/assets'

/** Recent pool activity from the indexer. delta1/delta2 are from the pool's side. */
export function TradesTable({ poolAccount, asset1, asset2 }: { poolAccount: string; asset1: Asset; asset2: Asset }) {
  const [rows, setRows] = useState<TradeRow[] | null>(null)
  const [indexer, setIndexer] = useState(true)

  useEffect(() => {
    let alive = true
    const load = () =>
      fetch(`/api/trades?pool=${poolAccount}`)
        .then((r) => r.json())
        .then((j) => {
          if (!alive) return
          setIndexer(j.indexer)
          setRows(j.trades ?? [])
        })
        .catch(() => alive && setRows([]))
    load()
    const t = setInterval(load, 10_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [poolAccount])

  if (!indexer) return null
  if (!rows) return <p className="empty">Loading activity…</p>
  if (!rows.length) return <p className="empty">No activity recorded yet.</p>

  return (
    <table className="table trades">
      <thead>
        <tr>
          <th>Type</th>
          <th className="num">{assetLabel(asset1)}</th>
          <th className="num">{assetLabel(asset2)}</th>
          <th className="num hide-sm">Account</th>
          <th className="num">Time</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => {
          const d2 = new BigNumber(t.delta2)
          // Pool gained asset2 → user sold asset2 (sold the token).
          const kind = t.kind === 'swap' ? (d2.gt(0) ? 'Sell' : 'Buy') : t.kind === 'deposit' ? 'Add' : 'Remove'
          const cls = kind === 'Buy' ? 'up' : kind === 'Sell' ? 'down' : 'muted'
          return (
            <tr key={t.hash + t.kind} onClick={() => window.open(explorerTx(t.hash), '_blank')}>
              <td className={cls}>{kind}</td>
              <td className="num">{fmt(new BigNumber(t.delta1).abs())}</td>
              <td className="num">{fmt(d2.abs())}</td>
              <td className="num hide-sm addr">{t.account ? shortAddr(t.account) : '—'}</td>
              <td className="num muted">{timeAgo(t.ts)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.floor(s)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
