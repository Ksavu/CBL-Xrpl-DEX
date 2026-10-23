'use client'

import { useState } from 'react'
import { useWallet } from '@/lib/wallet/context'
import { findLine, spendable } from '@/lib/xrpl/account'
import { type Pool, lpForTwoAssetDeposit, pairedDeposit, withdrawForLp } from '@/lib/xrpl/amm'
import { BigNumber, assetLabel, fmt, isXrp } from '@/lib/xrpl/assets'
import { buildDepositTwo, buildWithdrawAll, buildWithdrawLp } from '@/lib/xrpl/tx'
import { AssetIcon } from './AssetIcon'

const DEPOSIT_SLACK = 1.005 // allow 0.5% movement on the paired side

export function LiquidityPanel({ pool }: { pool: Pool }) {
  const { account, state, sendTx, openWalletModal } = useWallet()
  const [tab, setTab] = useState<'add' | 'remove'>('add')
  const [amt1, setAmt1] = useState('')
  const [pct, setPct] = useState(50)
  const [busy, setBusy] = useState(false)

  const lpLine = findLine(state, { currency: pool.lpToken.currency, issuer: pool.account })
  const lpBalance = lpLine?.balance ?? new BigNumber(0)
  const share = pool.lpToken.supply.gt(0) ? lpBalance.div(pool.lpToken.supply) : new BigNumber(0)
  const position = withdrawForLp(pool, lpBalance)

  const v1 = new BigNumber(amt1 || 0)
  const v2 = v1.gt(0) ? pairedDeposit(pool, pool.asset1, v1) : new BigNumber(0)
  const lpOut = v1.gt(0) ? lpForTwoAssetDeposit(pool, v1, v2) : new BigNumber(0)
  const ownerReserve = state?.reserves.owner ?? 0.2
  // First deposit creates an LP trust line → one more owner reserve.
  const reserveNeed = lpLine ? 0 : ownerReserve
  const bal1 = spendable(state, pool.asset1).minus(isXrp(pool.asset1) ? reserveNeed : 0)
  const bal2 = spendable(state, pool.asset2).minus(isXrp(pool.asset2) ? reserveNeed : 0)
  const short = v1.gt(bal1) || v2.times(DEPOSIT_SLACK).gt(bal2)

  const lpIn = lpBalance.times(pct).div(100)
  const out = withdrawForLp(pool, lpIn)

  const label = `${assetLabel(pool.asset2)}/${assetLabel(pool.asset1)}`

  const add = async () => {
    if (!account) return
    setBusy(true)
    try {
      const ok = await sendTx(
        buildDepositTwo(account, pool.asset1, v1, pool.asset2, BigNumber.min(v2.times(DEPOSIT_SLACK), bal2)),
        `Add liquidity ${label}`,
      )
      if (ok) setAmt1('')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!account) return
    setBusy(true)
    try {
      const tx =
        pct === 100
          ? buildWithdrawAll(account, pool.asset1, pool.asset2)
          : buildWithdrawLp(account, pool.asset1, pool.asset2, pool.lpToken, lpIn)
      await sendTx(tx, `Remove liquidity ${label}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel">
      <div className="tabs" role="tablist">
        <button className={tab === 'add' ? 'on' : ''} onClick={() => setTab('add')} role="tab" aria-selected={tab === 'add'}>
          Add
        </button>
        <button className={tab === 'remove' ? 'on' : ''} onClick={() => setTab('remove')} role="tab" aria-selected={tab === 'remove'}>
          Remove
        </button>
      </div>

      {lpBalance.gt(0) && (
        <div className="quote-box" style={{ marginTop: 0 }}>
          <div className="row">
            <span className="muted">Your share</span>
            <span>{share.times(100).toFixed(4)}%</span>
          </div>
          <div className="row">
            <span className="muted">Your position</span>
            <span>
              {fmt(position.amt1)} {assetLabel(pool.asset1)} + {fmt(position.amt2)} {assetLabel(pool.asset2)}
            </span>
          </div>
        </div>
      )}

      {tab === 'add' ? (
        <div className="stack">
          <div className="field">
            <div className="field-top">
              <span>Deposit</span>
              {account && <span>Balance {fmt(spendable(state, pool.asset1))}</span>}
            </div>
            <div className="field-mid">
              <input
                className="amount-input"
                inputMode="decimal"
                placeholder="0"
                aria-label={`${assetLabel(pool.asset1)} amount`}
                value={amt1}
                onChange={(e) => /^\d*\.?\d*$/.test(e.target.value) && setAmt1(e.target.value)}
              />
              <span className="asset-btn" style={{ cursor: 'default' }}>
                <AssetIcon asset={pool.asset1} /> {assetLabel(pool.asset1)}
              </span>
            </div>
          </div>
          <div className="field">
            <div className="field-top">
              <span>Paired automatically</span>
              {account && <span>Balance {fmt(spendable(state, pool.asset2))}</span>}
            </div>
            <div className="field-mid">
              <input className="amount-input" readOnly value={v2.gt(0) ? fmt(v2, 8) : ''} placeholder="0" aria-label={`${assetLabel(pool.asset2)} amount`} />
              <span className="asset-btn" style={{ cursor: 'default' }}>
                <AssetIcon asset={pool.asset2} /> {assetLabel(pool.asset2)}
              </span>
            </div>
          </div>
          {lpOut.gt(0) && (
            <p className="small muted">
              You&apos;ll own {lpOut.div(pool.lpToken.supply.plus(lpOut)).times(100).toFixed(4)}% of the pool.
              {!lpLine && ` First deposit locks ${ownerReserve} XRP reserve for the LP token.`}
            </p>
          )}
          {!account ? (
            <button className="btn block" onClick={openWalletModal}>Connect wallet</button>
          ) : (
            <button className="btn block" onClick={add} disabled={busy || !v1.gt(0) || short}>
              {short ? 'Insufficient balance' : busy ? 'Adding…' : 'Add liquidity'}
            </button>
          )}
        </div>
      ) : (
        <div className="stack">
          {lpBalance.lte(0) ? (
            <p className="empty" style={{ padding: 24 }}>You have no liquidity in this pool.</p>
          ) : (
            <>
              <div className="row between">
                <span className="muted">Amount</span>
                <strong>{pct}%</strong>
              </div>
              <input type="range" className="range" min={1} max={100} value={pct} onChange={(e) => setPct(+e.target.value)} aria-label="Percent to remove" />
              <div className="pct-row">
                {[25, 50, 75, 100].map((p) => (
                  <button key={p} className={`chip${pct === p ? ' on' : ''}`} onClick={() => setPct(p)}>
                    {p === 100 ? 'All' : `${p}%`}
                  </button>
                ))}
              </div>
              <div className="quote-box">
                <div className="row">
                  <span className="muted">You receive</span>
                  <span>
                    {fmt(out.amt1)} {assetLabel(pool.asset1)}
                  </span>
                </div>
                <div className="row">
                  <span />
                  <span>
                    {fmt(out.amt2)} {assetLabel(pool.asset2)}
                  </span>
                </div>
              </div>
              <button className="btn block" onClick={remove} disabled={busy}>
                {busy ? 'Removing…' : 'Remove liquidity'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
