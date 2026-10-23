'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AssetIcon } from '@/components/AssetIcon'
import { CreatePool } from '@/components/CreatePool'
import { usePools } from '@/lib/hooks'
import { assetLabel, fmt, parseAssetId, shortAddr } from '@/lib/xrpl/assets'

export default function PoolsPage() {
  const { data, error, loading } = usePools()
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const router = useRouter()

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (data?.pools ?? [])
      .map((p) => ({ ...p, a1: parseAssetId(p.asset1), a2: parseAssetId(p.asset2) }))
      .filter((p) => !s || `${assetLabel(p.a1)} ${assetLabel(p.a2)} ${p.asset1} ${p.asset2}`.toLowerCase().includes(s))
  }, [data, q])

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <h1>Pools</h1>
        <div className="row">
          <input className="search" style={{ width: 240 }} placeholder="Filter by token" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" onClick={() => setCreating(true)}>
            Create pool
          </button>
        </div>
      </div>

      {data?.source === 'ledger' && (
        <div className="notice info">
          Showing a sample of on-ledger pools. Run the indexer to rank every pool by liquidity and show 24h volume.
        </div>
      )}

      <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
        {loading && <p className="empty">Loading pools…</p>}
        {error && <p className="empty error">Couldn&apos;t load pools: {error}</p>}
        {data && rows.length === 0 && <p className="empty">No pools match “{q}”.</p>}
        {rows.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Pool</th>
                <th className="num">Price</th>
                <th className="num">Liquidity</th>
                <th className="num hide-sm">24h volume</th>
                <th className="num hide-sm">24h</th>
                <th className="num hide-sm">Fee</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr
                  key={p.account}
                  onClick={() => router.push(`/pool/${encodeURIComponent(p.asset1)}/${encodeURIComponent(p.asset2)}`)}
                >
                  <td>
                    <div className="pair">
                      <AssetIcon asset={p.a1} />
                      <AssetIcon asset={p.a2} />
                      <span>
                        {assetLabel(p.a2)} / {assetLabel(p.a1)}
                        {'issuer' in p.a2 && <span className="addr"> {shortAddr(p.a2.issuer)}</span>}
                      </span>
                    </div>
                  </td>
                  <td className="num">
                    {fmt(p.price, 6)} {assetLabel(p.a1)}
                  </td>
                  <td className="num">{p.tvlXrp ? `${fmt(p.tvlXrp)} XRP` : `${fmt(p.reserve1)} / ${fmt(p.reserve2)}`}</td>
                  <td className="num hide-sm">{p.volume24h1 ? `${fmt(p.volume24h1)} ${assetLabel(p.a1)}` : '—'}</td>
                  <td className={`num hide-sm ${p.change24h == null ? '' : p.change24h >= 0 ? 'up' : 'down'}`}>
                    {p.change24h == null ? '—' : `${p.change24h >= 0 ? '+' : ''}${p.change24h.toFixed(1)}%`}
                  </td>
                  <td className="num hide-sm">{(p.tradingFee / 1000).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && <CreatePool onClose={() => setCreating(false)} />}
    </div>
  )
}
