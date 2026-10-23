'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AssetIcon } from '@/components/AssetIcon'
import { PriceChart } from '@/components/PriceChart'
import { SwapCard } from '@/components/SwapCard'
import { TradesTable } from '@/components/TradesTable'
import { explorerAccount } from '@/config'
import { usePool } from '@/lib/hooks'
import { canonical, tvlInXrp } from '@/lib/xrpl/amm'
import { type IssuedAsset, XRP, assetId, assetLabel, fmt, isXrp, parseAssetId, shortAddr } from '@/lib/xrpl/assets'
import { getClient } from '@/lib/xrpl/client'
import { type TokenInfo, getTokenInfo } from '@/lib/xrpl/token'

export default function TokenPage() {
  const params = useParams<{ id: string }>()
  const asset = useMemo(() => {
    try {
      const a = parseAssetId(params.id)
      return isXrp(a) ? null : (a as IssuedAsset)
    } catch {
      return null
    }
  }, [params.id])

  const [info, setInfo] = useState<TokenInfo | null>(null)
  const [infoErr, setInfoErr] = useState<string | null>(null)
  const { pool: raw } = usePool(asset ? XRP : null, asset)
  const pool = raw ? canonical(raw) : raw

  useEffect(() => {
    if (!asset) return
    let alive = true
    getClient()
      .then((c) => getTokenInfo(c, asset))
      .then((i) => alive && setInfo(i))
      .catch((e) => alive && setInfoErr(e?.message ?? 'Failed to load token'))
    return () => {
      alive = false
    }
  }, [asset])

  if (!asset) return <p className="empty">That token link is invalid.</p>

  const price = pool ? pool.reserve1.div(pool.reserve2) : null
  const mcap = price && info ? price.times(info.supply) : null
  const tvl = pool ? tvlInXrp(pool) : null
  const label = assetLabel(asset)

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head">
        <AssetIcon asset={asset} />
        <div>
          <h1>{label}</h1>
          <p className="muted small">
            Issuer <a href={explorerAccount(asset.issuer)} target="_blank" rel="noreferrer">{shortAddr(asset.issuer)}</a>
            {info?.domain && <> · {info.domain}</>}
          </p>
        </div>
        {price && (
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div className="price-big">{fmt(price, 6)} XRP</div>
            {pool && (
              <Link className="small" href={`/pool/XRP/${encodeURIComponent(assetId(asset))}`}>
                View pool
              </Link>
            )}
          </div>
        )}
      </div>

      <div className="two-col">
        <div className="stack" style={{ gap: 20 }}>
          <div className="panel">
            <div className="stats" style={{ marginBottom: 20 }}>
              <Stat label="Market cap" value={mcap ? `${fmt(mcap)} XRP` : '—'} />
              <Stat label="Liquidity" value={tvl ? `${fmt(tvl)} XRP` : pool === null ? 'No XRP pool' : '—'} />
              <Stat label="Supply" value={info ? fmt(info.supply) : '—'} />
              <Stat label="Holders" value={info ? `${info.holders.toLocaleString()}${info.holdersCapped ? '+' : ''}` : '—'} />
            </div>
            {pool ? (
              <PriceChart poolAccount={pool.account} quoteLabel={`XRP per ${label}`} />
            ) : (
              <div className="chart-empty">{pool === null ? `No XRP/${label} pool yet.` : 'Loading…'}</div>
            )}
          </div>

          {pool && (
            <div className="panel" style={{ padding: 0, overflowX: 'auto' }}>
              <h3 style={{ padding: '16px 20px 4px' }}>Trades</h3>
              <TradesTable poolAccount={pool.account} asset1={pool.asset1} asset2={pool.asset2} />
            </div>
          )}
        </div>

        <div className="stack" style={{ gap: 20 }}>
          <SwapCard initialFrom={XRP} initialTo={asset} />
          <div className="panel">
            <h3 style={{ marginBottom: 14 }}>Issuer checks</h3>
            {infoErr && <p className="error small">{infoErr}</p>}
            {!info && !infoErr && <p className="muted small">Checking issuer…</p>}
            {info && <IssuerChecks info={info} />}
          </div>
        </div>
      </div>
    </div>
  )
}

function IssuerChecks({ info }: { info: TokenInfo }) {
  if (!info.issuerExists) return <p className="error small">Issuer account does not exist.</p>
  const f = info.flags
  const checks: { level: 'ok' | 'bad' | 'meh'; text: string }[] = [
    f.blackholed
      ? { level: 'ok', text: 'Issuer is blackholed — supply is fixed forever.' }
      : f.masterDisabled
        ? { level: 'meh', text: `Master key disabled, but ${f.hasSignerList ? 'a signer list' : 'a regular key'} can still issue more.` }
        : { level: 'bad', text: 'Issuer keys are active — more tokens can be minted at any time.' },
    f.clawbackEnabled
      ? { level: 'bad', text: 'Clawback enabled — the issuer can take tokens back from holders.' }
      : { level: 'ok', text: 'No clawback.' },
    f.globalFreeze
      ? { level: 'bad', text: 'Globally frozen — this token cannot be traded right now.' }
      : f.noFreeze
        ? { level: 'ok', text: 'Issuer gave up the ability to freeze.' }
        : { level: 'meh', text: 'Issuer can still freeze trust lines.' },
    info.transferFeePct > 0
      ? { level: info.transferFeePct > 2 ? 'bad' : 'meh', text: `Transfer fee of ${info.transferFeePct.toFixed(2)}% on every transfer.` }
      : { level: 'ok', text: 'No transfer fee.' },
  ]
  if (f.requireAuth) checks.push({ level: 'bad', text: 'Requires issuer authorization to hold.' })
  if (!f.defaultRipple) checks.push({ level: 'meh', text: 'Default Ripple is off — holders may be unable to trade it on the DEX.' })

  return (
    <div className="checks">
      {checks.map((c) => (
        <div key={c.text} className={`check ${c.level}`}>
          <span className="mark" aria-hidden>{c.level === 'ok' ? '✓' : c.level === 'bad' ? '!' : '–'}</span>
          <span>{c.text}</span>
        </div>
      ))}
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
