'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { DEFAULT_SLIPPAGE, FEE_BPS, FEE_MODE } from '@/config'
import { useDebounced } from '@/lib/hooks'
import { useWallet } from '@/lib/wallet/context'
import { needsTrustLine, spendable } from '@/lib/xrpl/account'
import { type Asset, BigNumber, XRP, assetId, assetLabel, fmt, isXrp } from '@/lib/xrpl/assets'
import { getClient } from '@/lib/xrpl/client'
import { type Quote, quoteExactIn } from '@/lib/xrpl/quote'
import { buildSwap, buildTrustSet } from '@/lib/xrpl/tx'
import {
  batchUnsupported,
  buildFeePayment,
  buildSwapWithFeeBatch,
  feeForSwap,
  isBatchUnsupportedError,
  markBatchUnsupported,
  netSwapIn,
} from '@/lib/xrpl/fee'
import { AssetIcon } from './AssetIcon'
import { AssetPicker } from './AssetPicker'

const FEE_BUFFER_XRP = 0.01
const HIGH_IMPACT = 0.05
const BLOCK_IMPACT = 0.15

export function SwapCard({ initialFrom = XRP, initialTo = null }: { initialFrom?: Asset; initialTo?: Asset | null }) {
  const { account, state, sendTx, sendTxResult, openWalletModal } = useWallet()
  const [from, setFrom] = useState<Asset>(initialFrom)
  const [to, setTo] = useState<Asset | null>(initialTo)
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE)
  const [showSettings, setShowSettings] = useState(false)
  const [picker, setPicker] = useState<'from' | 'to' | null>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [noRoute, setNoRoute] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmImpact, setConfirmImpact] = useState(false)

  const debounced = useDebounced(amount)

  const refreshQuote = useCallback(async () => {
    const amt = new BigNumber(debounced)
    if (!to || !amt.isFinite() || amt.lte(0)) {
      setQuote(null)
      setNoRoute(false)
      return
    }
    setQuoting(true)
    try {
      const c = await getClient()
      const net = netSwapIn(from, amt, feeForSwap(from, to, amt, null))
      const q = await quoteExactIn(c, from, to, net, slippage)
      setQuote(q)
      setNoRoute(!q)
    } catch (e) {
      console.error(e)
      setQuote(null)
    } finally {
      setQuoting(false)
    }
  }, [debounced, from, to, slippage])

  useEffect(() => {
    refreshQuote()
    const t = setInterval(refreshQuote, 8_000)
    return () => clearInterval(t)
  }, [refreshQuote])

  useEffect(() => setConfirmImpact(false), [from, to, debounced])

  const amt = new BigNumber(amount || 0)
  const balanceFrom = spendable(state, from)
  const balanceTo = to ? spendable(state, to) : null
  const mustTrust = !!to && needsTrustLine(state, to)
  const ownerReserve = state?.reserves.owner ?? 0.2

  const maxSpend = isXrp(from)
    ? BigNumber.max(0, balanceFrom.minus(FEE_BUFFER_XRP).minus(mustTrust ? ownerReserve : 0))
    : balanceFrom
  const insufficient = !!account && amt.gt(maxSpend)
  const reserveShort = !!state && mustTrust && state.xrpSpendable.lt(ownerReserve + FEE_BUFFER_XRP)
  const impact = quote?.priceImpact ?? new BigNumber(0)
  const fee = to ? feeForSwap(from, to, amt, quote) : new BigNumber(0)

  const flip = () => {
    if (!to) return
    setFrom(to)
    setTo(from)
    setAmount(quote ? quote.amountOut.decimalPlaces(6, BigNumber.ROUND_DOWN).toFixed() : '')
  }

  const doTrust = async () => {
    if (!account || !to || isXrp(to)) return
    setBusy(true)
    try {
      await sendTx(buildTrustSet(account, to as { currency: string; issuer: string }), `Enable ${assetLabel(to)}`)
    } finally {
      setBusy(false)
    }
  }

  const doSwap = async () => {
    if (!account || !to || !quote) return
    if (impact.gt(HIGH_IMPACT) && !confirmImpact) {
      setConfirmImpact(true)
      return
    }
    setBusy(true)
    try {
      // Re-quote right before signing so the minimum reflects the current ledger.
      const c = await getClient()
      const net = netSwapIn(from, amt, feeForSwap(from, to, amt, null))
      const fresh = (await quoteExactIn(c, from, to, net, slippage)) ?? quote
      let feeXrp = feeForSwap(from, to, amt, fresh)
      // token → token pays the fee from existing XRP; skip it rather than block the trade.
      if (!isXrp(from) && !isXrp(to) && feeXrp.gt(spendable(state, XRP).minus(FEE_BUFFER_XRP))) feeXrp = new BigNumber(0)

      const swap = buildSwap(account, from, to, fresh.amountIn, fresh.minOut)
      const label = `Swap ${fmt(amt)} ${assetLabel(from)} → ${assetLabel(to)}`

      if (feeXrp.gt(0) && FEE_MODE === 'batch' && !batchUnsupported()) {
        const r = await sendTxResult(buildSwapWithFeeBatch(account, swap, feeXrp), label, { silentIf: isBatchUnsupportedError })
        if (r.ok) return setAmount('')
        // Rejected by the user, or a real failure (e.g. slippage) that was rolled back with nothing charged.
        if (r.rejected || !isBatchUnsupportedError(r.code, r.message)) return
        markBatchUnsupported()
      }

      const ok = await sendTx(swap, label)
      if (!ok) return
      setAmount('')
      if (feeXrp.gt(0)) await sendTx(buildFeePayment(account, feeXrp), 'Service fee')
    } finally {
      setBusy(false)
    }
  }

  let cta: { label: string; onClick?: () => void; disabled?: boolean; danger?: boolean }
  if (!account) cta = { label: 'Connect wallet', onClick: openWalletModal }
  else if (state && !state.exists) cta = { label: 'Account not activated', disabled: true }
  else if (!to) cta = { label: 'Select a token', onClick: () => setPicker('to') }
  else if (!amt.gt(0)) cta = { label: 'Enter an amount', disabled: true }
  else if (insufficient) cta = { label: `Not enough ${assetLabel(from)}`, disabled: true }
  else if (mustTrust) cta = { label: busy ? 'Enabling…' : `Enable ${assetLabel(to)}`, onClick: doTrust, disabled: busy || reserveShort }
  else if (quoting && !quote) cta = { label: 'Finding best price…', disabled: true }
  else if (noRoute) cta = { label: 'No pool for this pair', disabled: true }
  else if (impact.gt(BLOCK_IMPACT) && !confirmImpact) cta = { label: 'Price impact too high', onClick: () => setConfirmImpact(true), danger: true }
  else if (impact.gt(HIGH_IMPACT) && !confirmImpact) cta = { label: 'Review price impact', onClick: doSwap, danger: true }
  else cta = { label: busy ? 'Swapping…' : confirmImpact ? 'Swap anyway' : 'Swap', onClick: doSwap, disabled: busy || !quote, danger: confirmImpact }

  return (
    <div className="panel swap">
      <div className="panel-head">
        <h2>Swap</h2>
        <button className="chip" onClick={() => setShowSettings((s) => !s)} aria-expanded={showSettings}>
          Slippage {slippage}%
        </button>
      </div>

      {showSettings && (
        <div className="settings" style={{ marginBottom: 12 }}>
          <span className="muted small">Max slippage</span>
          {[0.5, 1, 3].map((s) => (
            <button key={s} className={`chip${slippage === s ? ' on' : ''}`} onClick={() => setSlippage(s)}>
              {s}%
            </button>
          ))}
          <input
            className="chip-input"
            inputMode="decimal"
            placeholder="Custom"
            aria-label="Custom slippage percent"
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (v > 0 && v <= 50) setSlippage(v)
            }}
          />
        </div>
      )}

      <div className="field">
        <div className="field-top">
          <span>You pay</span>
          {account && (
            <span>
              {fmt(balanceFrom)}
              <button className="max-btn" onClick={() => setAmount(maxSpend.decimalPlaces(6, BigNumber.ROUND_DOWN).toFixed())}>
                Max
              </button>
            </span>
          )}
        </div>
        <div className="field-mid">
          <input
            className="amount-input"
            inputMode="decimal"
            placeholder="0"
            aria-label="Amount to pay"
            value={amount}
            onChange={(e) => {
              const v = e.target.value.replace(',', '.')
              if (/^\d*\.?\d*$/.test(v)) setAmount(v)
            }}
          />
          <AssetButton asset={from} onClick={() => setPicker('from')} />
        </div>
      </div>

      <button className="flip" onClick={flip} aria-label="Switch tokens" disabled={!to}>
        ↓
      </button>

      <div className="field">
        <div className="field-top">
          <span>You receive</span>
          {account && balanceTo && <span>{fmt(balanceTo)}</span>}
        </div>
        <div className="field-mid">
          <input
            className="amount-input"
            readOnly
            placeholder="0"
            aria-label="Estimated amount received"
            value={quote ? fmt(quote.amountOut, 8) : ''}
          />
          <AssetButton asset={to} onClick={() => setPicker('to')} />
        </div>
      </div>

      {quote && to && (
        <div className="quote-box">
          <div className="row">
            <span className="muted">Rate</span>
            <span>
              1 {assetLabel(from)} = {fmt(quote.rate, 8)} {assetLabel(to)}
            </span>
          </div>
          <div className="row">
            <span className="muted">Price impact</span>
            <span className={impact.gt(HIGH_IMPACT) ? 'down' : impact.gt(0.01) ? 'warn' : ''}>
              {impact.times(100).toFixed(2)}%
            </span>
          </div>
          <div className="row">
            <span className="muted">Minimum received</span>
            <span>
              {fmt(quote.minOut, 8)} {assetLabel(to)}
            </span>
          </div>
          {fee.gt(0) && (
            <div className="row">
              <span className="muted">Service fee ({(FEE_BPS / 100).toFixed(2)}%)</span>
              <span>{fmt(fee)} XRP</span>
            </div>
          )}
          <div className="row">
            <span className="muted">Route</span>
            <span>
              {quote.route.length === 1 ? 'Direct pool' : `Via XRP`} · {quote.feePercent.toFixed(2)}% pool fee
            </span>
          </div>
        </div>
      )}

      {mustTrust && to && (
        <div className={`notice ${reserveShort ? 'danger' : 'info'}`}>
          {reserveShort
            ? `You need at least ${ownerReserve} XRP free to hold ${assetLabel(to)}. Each token you hold locks ${ownerReserve} XRP as reserve.`
            : `First time holding ${assetLabel(to)}: enable it once (locks ${ownerReserve} XRP reserve, refundable when you remove it).`}
        </div>
      )}
      {to && !isXrp(to) && (
        <p className="small" style={{ margin: '0 2px 12px' }}>
          <Link href={`/token/${encodeURIComponent(assetId(to))}`}>Check {assetLabel(to)} before buying</Link>
        </p>
      )}
      {confirmImpact && (
        <div className="notice danger">
          This trade moves the price by {impact.times(100).toFixed(1)}%. You will get noticeably less than the market rate.
        </div>
      )}

      <button className={`btn block${cta.danger ? ' danger' : ''}`} onClick={cta.onClick} disabled={cta.disabled}>
        {cta.label}
      </button>

      {picker && (
        <AssetPicker
          exclude={picker === 'from' ? to : from}
          onClose={() => setPicker(null)}
          onPick={(a) => (picker === 'from' ? setFrom(a) : setTo(a))}
        />
      )}
    </div>
  )
}

function AssetButton({ asset, onClick }: { asset: Asset | null; onClick: () => void }) {
  if (!asset)
    return (
      <button className="asset-btn empty" onClick={onClick}>
        Select token
      </button>
    )
  return (
    <button className="asset-btn" onClick={onClick}>
      <AssetIcon asset={asset} />
      {assetLabel(asset)} ▾
    </button>
  )
}
