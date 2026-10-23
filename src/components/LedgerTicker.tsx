'use client'

import { useEffect, useState } from 'react'
import { NETWORK } from '@/config'
import { getClient } from '@/lib/xrpl/client'

interface Close {
  seq: number
  txns: number
  at: number
}

const BARS = 10

/** Live ledger-close heartbeat: one bar per validated ledger, height = tx count. */
export function LedgerTicker() {
  const [closes, setCloses] = useState<Close[]>([])
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    let alive = true
    let cleanup = () => {}
    ;(async () => {
      try {
        const c = await getClient()
        const onLedger = (l: any) => {
          if (!alive) return
          setOffline(false)
          setCloses((prev) => [...prev, { seq: l.ledger_index, txns: l.txn_count ?? 0, at: Date.now() }].slice(-BARS))
        }
        c.on('ledgerClosed', onLedger)
        await c.request({ command: 'subscribe', streams: ['ledger'] })
        cleanup = () => {
          c.off('ledgerClosed', onLedger)
          c.request({ command: 'unsubscribe', streams: ['ledger'] }).catch(() => {})
        }
      } catch {
        if (alive) setOffline(true)
      }
    })()
    return () => {
      alive = false
      cleanup()
    }
  }, [])

  const latest = closes.at(-1)
  const maxTx = Math.max(1, ...closes.map((c) => c.txns))
  const bars: (Close | null)[] = [...Array(Math.max(0, BARS - closes.length)).fill(null), ...closes]

  return (
    <div
      className={`ticker${offline ? ' offline' : ''}`}
      title={latest ? `Ledger ${latest.seq} · ${latest.txns} transactions` : 'Connecting to XRPL'}
    >
      <div className="ticker-bars" aria-hidden>
        {bars.map((b, i) => (
          <span
            key={b ? b.seq : `e${i}`}
            className={b && i === bars.length - 1 ? 'fresh' : ''}
            style={{ height: b ? `${4 + Math.round((b.txns / maxTx) * 12)}px` : '4px' }}
          />
        ))}
      </div>
      <span className="ticker-label">{NETWORK === 'mainnet' ? 'Ledger' : 'Testnet'}</span>
      <span className="ticker-seq">{offline ? 'offline' : latest ? latest.seq.toLocaleString() : '…'}</span>
    </div>
  )
}
