'use client'

import { useEffect, useRef, useState } from 'react'

const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d'] as const

/** Candles of the pool price (asset1 per asset2) from the indexer. */
export function PriceChart({ poolAccount, quoteLabel }: { poolAccount: string; quoteLabel: string }) {
  const el = useRef<HTMLDivElement>(null)
  const [tf, setTf] = useState<(typeof TIMEFRAMES)[number]>('15m')
  const [status, setStatus] = useState<'loading' | 'ready' | 'no-indexer' | 'empty' | 'error'>('loading')

  useEffect(() => {
    let disposed = false
    let chart: any
    setStatus('loading')
    ;(async () => {
      try {
        const r = await fetch(`/api/candles?pool=${poolAccount}&tf=${tf}`)
        const j = await r.json()
        if (disposed) return
        if (!j.indexer) return setStatus('no-indexer')
        if (!j.candles.length) return setStatus('empty')
        setStatus('ready')
        const { createChart, CandlestickSeries, HistogramSeries, ColorType } = await import('lightweight-charts')
        if (disposed || !el.current) return
        const css = getComputedStyle(document.documentElement)
        const v = (n: string) => css.getPropertyValue(n).trim()
        chart = createChart(el.current, {
          autoSize: true,
          layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: v('--muted'), fontFamily: v('--font') },
          grid: { vertLines: { color: 'transparent' }, horzLines: { color: v('--line') } },
          rightPriceScale: { borderVisible: false },
          timeScale: { borderVisible: false, timeVisible: true },
          localization: { priceFormatter: (p: number) => (p >= 1 ? p.toFixed(4) : p.toPrecision(4)) },
        })
        const candles = chart.addSeries(CandlestickSeries, {
          upColor: v('--up'),
          downColor: v('--down'),
          borderVisible: false,
          wickUpColor: v('--up'),
          wickDownColor: v('--down'),
          title: quoteLabel,
        })
        candles.setData(j.candles.map((c: any) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })))
        const vol = chart.addSeries(HistogramSeries, { priceScaleId: '', priceFormat: { type: 'volume' }, color: v('--surface-2') })
        vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
        vol.setData(j.candles.map((c: any) => ({ time: c.time, value: c.volume })))
        chart.timeScale().fitContent()
      } catch (e) {
        console.error(e)
        if (!disposed) setStatus('error')
      }
    })()
    return () => {
      disposed = true
      chart?.remove()
    }
  }, [poolAccount, tf, quoteLabel])

  return (
    <div>
      <div className="settings" style={{ marginBottom: 12 }}>
        {TIMEFRAMES.map((t) => (
          <button key={t} className={`chip${tf === t ? ' on' : ''}`} onClick={() => setTf(t)}>
            {t}
          </button>
        ))}
      </div>
      {status === 'ready' || status === 'loading' ? (
        <div ref={el} className="chart" />
      ) : (
        <div className="chart-empty">
          {status === 'no-indexer' && 'Charts need the indexer. Set DATABASE_URL and run npm run indexer.'}
          {status === 'empty' && 'No trades recorded for this pool yet.'}
          {status === 'error' && 'Chart failed to load.'}
        </div>
      )}
    </div>
  )
}
