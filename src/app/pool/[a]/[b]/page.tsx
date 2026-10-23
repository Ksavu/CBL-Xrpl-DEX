'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AssetIcon } from '@/components/AssetIcon'
import { LiquidityPanel } from '@/components/LiquidityPanel'
import { PriceChart } from '@/components/PriceChart'
import { TradesTable } from '@/components/TradesTable'
import { explorerAccount } from '@/config'
import { usePool } from '@/lib/hooks'
import { canonical, tvlInXrp } from '@/lib/xrpl/amm'
import { type Asset, assetId, assetLabel, fmt, isXrp, parseAssetId, shortAddr } from '@/lib/xrpl/assets'

export default function PoolPage() {
  const params = useParams<{ a: string; b: string }>()
  const assets = useMemo((): [Asset, Asset] | null => {
    try {
      return [parseAssetId(params.a), parseAssetId(params.b)]
    } catch {
      return null
    }
  }, [params.a, params.b])

  const { pool: raw, loading, error } = usePool(assets?.[0] ?? null, assets?.[1] ?? null)
  const pool = raw ? canonical(raw) : raw

  if (!assets) return <p className="empty">That pool link is invalid.</p>
  if (loading) return <p className="empty">Loading pool…</p>
  if (error) return <p className="empty error">Couldn&apos;t load pool: {error}</p>
  if (!pool)
    return (
      <div className="empty">
        <p>No pool exists for {assetLabel(assets[0])} / {assetLabel(assets[1])}.</p>
        <p style={{ marginTop: 12 }}>
          <Link href="/pools">Create it from the Pools page</Link>
        </p>
      </div>
    )

  const tvl = tvlInXrp(pool)
  const price = pool.reserve1.div(pool.reserve2)
  const token = isXrp(pool.asset1) ? pool.asset2 : null

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head">
        <div className="pair">
          <AssetIcon asset={pool.asset1} size={40} />
          <AssetIcon asset={pool.asset2} size={40} />
        </div>
        <div>
          <h1>
            {assetLabel(pool.asset2)} / {assetLabel(pool.asset1)}
          </h1>
          <p className="muted small">
            AMM <a href={explorerAccount(pool.account)} target="_blank" rel="noreferrer">{shortAddr(pool.account)}</a>
            {token && (
              <>
                {' · '}
                <Link href={`/token/${encodeURIComponent(assetId(token))}`}>Token details</Link>
              </>
            )}
          </p>
        </div>
      </div>

      {(pool.asset1Frozen || pool.asset2Frozen) && (
        <div className="notice danger">One of this pool&apos;s assets is frozen by its issuer. Trading and deposits are blocked.</div>
      )}

      <div className="two-col">
        <div className="stack" style={{ gap: 20 }}>
          <div className="panel">
            <div className="stats" style={{ marginBottom: 20 }}>
              <Stat label="Price" value={`${fmt(price, 6)} ${assetLabel(pool.asset1)}`} />
              <Stat label="Liquidity" value={tvl ? `${fmt(tvl)} XRP` : '—'} />
              <Stat label={`${assetLabel(pool.asset1)} reserve`} value={fmt(pool.reserve1)} />
              <Stat label={`${assetLabel(pool.asset2)} reserve`} value={fmt(pool.reserve2)} />
              <Stat label="Trading fee" value={`${(pool.tradingFee / 1000).toFixed(2)}%`} />
            </div>
            <PriceChart poolAccount={pool.account} quoteLabel={`${assetLabel(pool.asset1)} per ${assetLabel(pool.asset2)}`} />
          </div>
          <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
            <h3 style={{ padding: '16px 20px 4px' }}>Activity</h3>
            <TradesTable poolAccount={pool.account} asset1={pool.asset1} asset2={pool.asset2} />
          </div>
        </div>
        <LiquidityPanel pool={pool} />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  )
}
