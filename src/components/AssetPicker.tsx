'use client'

import { useEffect, useMemo, useState } from 'react'
import { isValidClassicAddress } from 'xrpl'
import { usePools } from '@/lib/hooks'
import { useWallet } from '@/lib/wallet/context'
import {
  type Asset,
  XRP,
  assetId,
  assetLabel,
  fmt,
  normalizeCurrency,
  parseAssetId,
  sameAsset,
  shortAddr,
} from '@/lib/xrpl/assets'
import { getClient } from '@/lib/xrpl/client'
import { AssetIcon } from './AssetIcon'

interface Row {
  asset: Asset
  balance?: string
}

export function AssetPicker({
  onPick,
  onClose,
  exclude,
}: {
  onPick: (a: Asset) => void
  onClose: () => void
  exclude?: Asset | null
}) {
  const { state } = useWallet()
  const { data } = usePools()
  const [q, setQ] = useState('')
  const [issuerRows, setIssuerRows] = useState<Row[] | null>(null)
  const [issuerErr, setIssuerErr] = useState<string | null>(null)

  const base: Row[] = useMemo(() => {
    const seen = new Set<string>()
    const out: Row[] = []
    const push = (r: Row) => {
      const id = assetId(r.asset)
      if (seen.has(id)) return
      seen.add(id)
      out.push(r)
    }
    push({ asset: XRP, balance: state ? fmt(state.xrpSpendable) : undefined })
    // Tokens the user already holds come first.
    for (const l of state?.lines ?? []) {
      if (l.currency.startsWith('03')) continue // LP tokens
      push({ asset: { currency: l.currency, issuer: l.issuer }, balance: fmt(l.balance) })
    }
    for (const p of data?.pools ?? []) {
      for (const id of [p.asset1, p.asset2]) {
        try {
          push({ asset: parseAssetId(id) })
        } catch {}
      }
    }
    return out
  }, [state, data])

  // Paste an issuer address → list the currencies it issues.
  useEffect(() => {
    const s = q.trim()
    setIssuerRows(null)
    setIssuerErr(null)
    if (!isValidClassicAddress(s)) return
    let alive = true
    ;(async () => {
      try {
        const c = await getClient()
        const r: any = await c.request({ command: 'gateway_balances', account: s, ledger_index: 'validated' })
        const cur = Object.keys(r.result.obligations ?? {})
        if (alive) setIssuerRows(cur.map((currency) => ({ asset: { currency, issuer: s } })))
        if (alive && cur.length === 0) setIssuerErr('This account has not issued any tokens.')
      } catch (e: any) {
        if (alive) setIssuerErr(e?.data?.error === 'actNotFound' ? 'Account not found.' : 'Could not look up issuer.')
      }
    })()
    return () => {
      alive = false
    }
  }, [q])

  const rows = useMemo(() => {
    if (issuerRows) return issuerRows
    const s = q.trim().toLowerCase()
    // "CODE.rIssuer" pasted directly
    if (s.includes('.') && s.length > 25) {
      try {
        const a = parseAssetId(q.trim())
        return [{ asset: a }]
      } catch {}
    }
    if (!s) return base
    return base.filter((r) => {
      const label = assetLabel(r.asset).toLowerCase()
      const issuer = 'issuer' in r.asset ? r.asset.issuer.toLowerCase() : ''
      return label.includes(s) || issuer.startsWith(s) || (r.asset.currency === normalizeCurrency(q.trim()) && s.length > 2)
    })
  }, [q, base, issuerRows])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Select token">
        <div className="modal-head">
          <h3>Select token</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <input
          className="search"
          autoFocus
          placeholder="Search name, or paste issuer address"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {issuerErr && <p className="muted small" style={{ marginTop: 10 }}>{issuerErr}</p>}
        <div className="asset-list">
          {rows.map((r) => {
            const disabled = !!exclude && sameAsset(exclude, r.asset)
            return (
              <button
                key={assetId(r.asset)}
                className="asset-row"
                disabled={disabled}
                style={disabled ? { opacity: 0.4 } : undefined}
                onClick={() => {
                  onPick(r.asset)
                  onClose()
                }}
              >
                <AssetIcon asset={r.asset} />
                <span>
                  <span className="sym">{assetLabel(r.asset)}</span>
                  {'issuer' in r.asset && <span className="addr"> {shortAddr(r.asset.issuer)}</span>}
                </span>
                <span className="muted small">{r.balance ?? ''}</span>
              </button>
            )
          })}
          {rows.length === 0 && !issuerErr && (
            <p className="muted small" style={{ padding: '16px 8px' }}>
              No match. Paste the token&apos;s issuer address to find it.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
