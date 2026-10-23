import type { Client } from 'xrpl'
import { BigNumber, type Asset, XRP, isXrp, sameAsset } from './assets'
import { type Pool, getPool, spotPrice, swapOut } from './amm'

export interface Quote {
  from: Asset
  to: Asset
  amountIn: BigNumber
  amountOut: BigNumber
  /** amountOut reduced by slippage tolerance — used as the on-chain minimum. */
  minOut: BigNumber
  /** Price impact vs. spot, as a fraction (0.01 = 1%). */
  priceImpact: BigNumber
  /** Effective rate: units of `to` per unit of `from`. */
  rate: BigNumber
  /** Pools used, in order. Direct = 1 hop, via XRP = 2 hops. */
  route: Pool[]
  /** Sum of AMM trading fees along the route, as a percent. */
  feePercent: number
}

/**
 * Quote an exact-input swap against native AMM pools.
 *
 * Execution uses OfferCreate (Sell + FillOrKill), which crosses both the AMM
 * and the order book and auto-bridges through XRP, so the realised output can
 * only be equal or better than an AMM-only quote at the same ledger state.
 */
export async function quoteExactIn(
  c: Client,
  from: Asset,
  to: Asset,
  amountIn: BigNumber.Value,
  slippagePct: number,
): Promise<Quote | null> {
  if (sameAsset(from, to)) return null
  const amt = new BigNumber(amountIn)
  if (!amt.isFinite() || amt.lte(0)) return null

  const candidates: Pool[][] = []

  const direct = await getPool(c, from, to)
  if (direct) candidates.push([direct])

  // Token → token: also try bridging through XRP.
  if (!isXrp(from) && !isXrp(to)) {
    const [p1, p2] = await Promise.all([getPool(c, from, XRP), getPool(c, XRP, to)])
    if (p1 && p2) candidates.push([p1, p2])
  }

  let best: Quote | null = null
  for (const route of candidates) {
    const q = simulateRoute(route, from, to, amt, slippagePct)
    if (q && (!best || q.amountOut.gt(best.amountOut))) best = q
  }
  return best
}

export function simulateRoute(
  route: Pool[],
  from: Asset,
  to: Asset,
  amountIn: BigNumber,
  slippagePct: number,
): Quote | null {
  let cur = from
  let amt = amountIn
  let spot = new BigNumber(1)
  let fee = 0

  for (const pool of route) {
    const next = sameAsset(pool.asset1, cur) ? pool.asset2 : pool.asset1
    spot = spot.times(spotPrice(pool, cur))
    amt = swapOut(pool, cur, amt)
    fee += pool.tradingFee / 1000
    cur = next
  }
  if (!sameAsset(cur, to) || amt.lte(0)) return null

  const rate = amt.div(amountIn)
  const priceImpact = BigNumber.max(0, new BigNumber(1).minus(rate.div(spot)))
  const minOut = amt.times(1 - slippagePct / 100).decimalPlaces(15, BigNumber.ROUND_DOWN)

  return { from, to, amountIn, amountOut: amt, minOut, priceImpact, rate, route, feePercent: fee }
}
