'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePool } from '@/lib/hooks'
import { useWallet } from '@/lib/wallet/context'
import { spendable } from '@/lib/xrpl/account'
import { type Asset, BigNumber, XRP, assetId, assetLabel, fmt, isXrp } from '@/lib/xrpl/assets'
import { buildAmmCreate } from '@/lib/xrpl/tx'
import { AssetIcon } from './AssetIcon'
import { AssetPicker } from './AssetPicker'

export function CreatePool({ onClose }: { onClose: () => void }) {
  const { account, state, sendTx, openWalletModal } = useWallet()
  const router = useRouter()
  const [a1, setA1] = useState<Asset>(XRP)
  const [a2, setA2] = useState<Asset | null>(null)
  const [amt1, setAmt1] = useState('')
  const [amt2, setAmt2] = useState('')
  const [fee, setFee] = useState(0.5)
  const [picker, setPicker] = useState<1 | 2 | null>(null)
  const [busy, setBusy] = useState(false)
  const { pool: existing } = usePool(a1, a2)

  const v1 = new BigNumber(amt1 || 0)
  const v2 = new BigNumber(amt2 || 0)
  const ownerReserve = state?.reserves.owner ?? 0.2
  // AMMCreate burns one owner reserve as its fee, on top of the XRP deposited.
  const xrpNeeded = (isXrp(a1) ? v1 : new BigNumber(0)).plus(isXrp(a2 as Asset) ? v2 : 0).plus(ownerReserve)
  const short1 = account && v1.gt(spendable(state, a1).minus(isXrp(a1) ? ownerReserve : 0))
  const short2 = account && a2 && v2.gt(spendable(state, a2).minus(isXrp(a2) ? ownerReserve : 0))

  const create = async () => {
    if (!account || !a2) return
    setBusy(true)
    try {
      const ok = await sendTx(buildAmmCreate(account, a1, v1, a2, v2, fee), `Create ${assetLabel(a2)}/${assetLabel(a1)} pool`)
      if (ok) router.push(`/pool/${encodeURIComponent(assetId(a1))}/${encodeURIComponent(assetId(a2))}`)
    } finally {
      setBusy(false)
    }
  }

  let cta: { label: string; onClick?: () => void; disabled?: boolean }
  if (!account) cta = { label: 'Connect wallet', onClick: openWalletModal }
  else if (!a2) cta = { label: 'Select second token', onClick: () => setPicker(2) }
  else if (existing) cta = { label: 'Pool already exists', onClick: () => router.push(`/pool/${encodeURIComponent(assetId(a1))}/${encodeURIComponent(assetId(a2))}`) }
  else if (!v1.gt(0) || !v2.gt(0)) cta = { label: 'Enter both amounts', disabled: true }
  else if (short1 || short2) cta = { label: 'Insufficient balance', disabled: true }
  else cta = { label: busy ? 'Creating…' : 'Create pool', onClick: create, disabled: busy }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Create pool">
        <div className="modal-head">
          <h3>Create pool</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="stack">
          {([1, 2] as const).map((n) => {
            const asset = n === 1 ? a1 : a2
            const val = n === 1 ? amt1 : amt2
            const set = n === 1 ? setAmt1 : setAmt2
            return (
              <div className="field" key={n}>
                <div className="field-top">
                  <span>Deposit</span>
                  {asset && account && <span>Balance {fmt(spendable(state, asset))}</span>}
                </div>
                <div className="field-mid">
                  <input
                    className="amount-input"
                    inputMode="decimal"
                    placeholder="0"
                    value={val}
                    onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && set(e.target.value)}
                  />
                  <button className={`asset-btn${asset ? '' : ' empty'}`} onClick={() => setPicker(n)}>
                    {asset ? (
                      <>
                        <AssetIcon asset={asset} /> {assetLabel(asset)} ▾
                      </>
                    ) : (
                      'Select token'
                    )}
                  </button>
                </div>
              </div>
            )
          })}

          {a2 && v1.gt(0) && v2.gt(0) && (
            <p className="small muted">
              Starting price: 1 {assetLabel(a2)} = {fmt(v1.div(v2), 8)} {assetLabel(a1)}
            </p>
          )}

          <div className="row between">
            <span className="muted small">Trading fee</span>
            <div className="settings">
              {[0.1, 0.3, 0.5, 1].map((f) => (
                <button key={f} className={`chip${fee === f ? ' on' : ''}`} onClick={() => setFee(f)}>
                  {f}%
                </button>
              ))}
            </div>
          </div>

          <div className="notice">
            Creating a pool costs {ownerReserve} XRP (burned as the transaction fee) and sets the starting price. Arbitrageurs will
            trade against a mispriced pool immediately. You need about {fmt(xrpNeeded)} XRP in total.
          </div>

          <button className="btn block" onClick={cta.onClick} disabled={cta.disabled}>
            {cta.label}
          </button>
        </div>

        {picker && (
          <AssetPicker
            exclude={picker === 1 ? a2 : a1}
            onClose={() => setPicker(null)}
            onPick={(a) => (picker === 1 ? setA1(a) : setA2(a))}
          />
        )}
      </div>
    </div>
  )
}
