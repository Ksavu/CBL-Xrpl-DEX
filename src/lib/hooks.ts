'use client'

import { useEffect, useRef, useState } from 'react'
import type { PoolSummary } from '@/lib/server/pools'
import { type Pool, getPool } from '@/lib/xrpl/amm'
import type { Asset } from '@/lib/xrpl/assets'
import { getClient } from '@/lib/xrpl/client'

export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

let poolsCache: { at: number; data: { source: string; pools: PoolSummary[] } } | null = null

export function usePools() {
  const [data, setData] = useState(poolsCache?.data ?? null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (poolsCache && Date.now() - poolsCache.at < 30_000) return
    fetch('/api/pools')
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error ?? 'Failed to load pools')
        poolsCache = { at: Date.now(), data: j }
        setData(j)
      })
      .catch((e) => setError(e.message))
  }, [])
  return { data, error, loading: !data && !error }
}

/** Live pool state for a pair, refreshed every few ledgers. */
export function usePool(a: Asset | null, b: Asset | null, refreshMs = 8_000) {
  const [pool, setPool] = useState<Pool | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const key = a && b ? JSON.stringify([a, b]) : ''
  const tick = useRef(0)

  useEffect(() => {
    if (!a || !b) {
      setPool(undefined)
      return
    }
    let alive = true
    const load = async () => {
      const my = ++tick.current
      try {
        const c = await getClient()
        const p = await getPool(c, a, b)
        if (alive && my === tick.current) {
          setPool(p)
          setError(null)
        }
      } catch (e: any) {
        if (alive) setError(e?.message ?? 'Failed to load pool')
      }
    }
    setPool(undefined)
    load()
    const t = setInterval(load, refreshMs)
    return () => {
      alive = false
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshMs])

  return { pool, error, loading: pool === undefined && !error }
}
