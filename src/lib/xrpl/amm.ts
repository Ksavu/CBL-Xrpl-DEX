import type { Client } from 'xrpl'
import { BigNumber, type Asset, assetId, fromAmount, sameAsset, toCurrency } from './assets'

export interface Pool {
  /** AMM account address (also the LP token issuer). */
  account: string
  asset1: Asset
  asset2: Asset
  reserve1: BigNumber
  reserve2: BigNumber
  /** Trading fee in units of 1/100,000 (1000 = 1%). */
  tradingFee: number
  lpToken: { currency: string; issuer: string; supply: BigNumber }
  /** Present if the account was frozen/authorized etc. — surfaced for UI warnings. */
  asset1Frozen?: boolean
  asset2Frozen?: boolean
}

export const poolId = (p: Pick<Pool, 'asset1' | 'asset2'>) => `${assetId(p.asset1)}|${assetId(p.asset2)}`

export const feePercent = (tradingFee: number) => tradingFee / 1000

/** Fetch a pool by asset pair. Returns null if no AMM exists for the pair. */
export async function getPool(c: Client, a: Asset, b: Asset): Promise<Pool | null> {
  try {
    const r = await c.request({
      command: 'amm_info',
      asset: toCurrency(a),
      asset2: toCurrency(b),
      ledger_index: 'validated',
    })
    return parseAmmInfo(r.result.amm)
  } catch (e: any) {
    if (e?.data?.error === 'actNotFound') return null
    throw e
  }
}

export async function getPoolByAccount(c: Client, ammAccount: string): Promise<Pool | null> {
  try {
    const r = await c.request({ command: 'amm_info', amm_account: ammAccount, ledger_index: 'validated' })
    return parseAmmInfo(r.result.amm)
  } catch (e: any) {
    if (e?.data?.error === 'actNotFound') return null
    throw e
  }
}

export function parseAmmInfo(amm: any): Pool {
  const a1 = fromAmount(amm.amount)
  const a2 = fromAmount(amm.amount2)
  return {
    account: amm.account,
    asset1: a1.asset,
    asset2: a2.asset,
    reserve1: a1.value,
    reserve2: a2.value,
    tradingFee: amm.trading_fee ?? 0,
    lpToken: {
      currency: amm.lp_token.currency,
      issuer: amm.lp_token.issuer,
      supply: new BigNumber(amm.lp_token.value),
    },
    asset1Frozen: !!amm.asset_frozen,
    asset2Frozen: !!amm.asset2_frozen,
  }
}

/** Canonical orientation shared with the indexer: XRP is always asset1 when present. */
export function canonical(p: Pool): Pool {
  if (p.asset1.currency !== 'XRP' && p.asset2.currency === 'XRP') {
    return {
      ...p,
      asset1: p.asset2,
      asset2: p.asset1,
      reserve1: p.reserve2,
      reserve2: p.reserve1,
      asset1Frozen: p.asset2Frozen,
      asset2Frozen: p.asset1Frozen,
    }
  }
  return p
}

/** Reserves oriented as (in, out) for a given input asset. */
export function orient(pool: Pool, inAsset: Asset): { rin: BigNumber; rout: BigNumber; out: Asset } {
  if (sameAsset(pool.asset1, inAsset)) return { rin: pool.reserve1, rout: pool.reserve2, out: pool.asset2 }
  if (sameAsset(pool.asset2, inAsset)) return { rin: pool.reserve2, rout: pool.reserve1, out: pool.asset1 }
  throw new Error('Asset not in pool')
}

/**
 * XLS-30 swap-in formula (weights 0.5/0.5 → constant product):
 *   out = Rout * (1 - Rin / (Rin + in * (1 - fee)))
 * The trading fee is charged on the input side.
 */
export function swapOut(pool: Pool, inAsset: Asset, amountIn: BigNumber.Value): BigNumber {
  const { rin, rout } = orient(pool, inAsset)
  const fee = new BigNumber(pool.tradingFee).div(100_000)
  const inAfterFee = new BigNumber(amountIn).times(new BigNumber(1).minus(fee))
  if (inAfterFee.lte(0)) return new BigNumber(0)
  return rout.times(inAfterFee).div(rin.plus(inAfterFee)).decimalPlaces(15, BigNumber.ROUND_DOWN)
}

/** Inverse: input needed to receive exactly `amountOut`. */
export function swapIn(pool: Pool, inAsset: Asset, amountOut: BigNumber.Value): BigNumber {
  const { rin, rout } = orient(pool, inAsset)
  const out = new BigNumber(amountOut)
  if (out.gte(rout)) return new BigNumber(Infinity)
  const fee = new BigNumber(pool.tradingFee).div(100_000)
  return rin.times(out).div(rout.minus(out)).div(new BigNumber(1).minus(fee)).decimalPlaces(15, BigNumber.ROUND_UP)
}

/** Spot price: units of `quote` per 1 unit of `base`. */
export function spotPrice(pool: Pool, base: Asset): BigNumber {
  const { rin, rout } = orient(pool, base)
  return rout.div(rin)
}

/** Proportional two-asset deposit: given an amount of one asset, the other side needed. */
export function pairedDeposit(pool: Pool, asset: Asset, amount: BigNumber.Value): BigNumber {
  const { rin, rout } = orient(pool, asset)
  return new BigNumber(amount).times(rout).div(rin)
}

/** LP tokens minted for a proportional two-asset deposit (limited by the tighter side). */
export function lpForTwoAssetDeposit(pool: Pool, amt1: BigNumber.Value, amt2: BigNumber.Value): BigNumber {
  const f1 = new BigNumber(amt1).div(pool.reserve1)
  const f2 = new BigNumber(amt2).div(pool.reserve2)
  return pool.lpToken.supply.times(BigNumber.min(f1, f2))
}

/** Assets returned for burning `lpIn` LP tokens. */
export function withdrawForLp(pool: Pool, lpIn: BigNumber.Value): { amt1: BigNumber; amt2: BigNumber } {
  const share = new BigNumber(lpIn).div(pool.lpToken.supply)
  return { amt1: pool.reserve1.times(share), amt2: pool.reserve2.times(share) }
}

/** XRP-side TVL when one asset is XRP (counts both sides at spot). */
export function tvlInXrp(pool: Pool): BigNumber | null {
  if (pool.asset1.currency === 'XRP') return pool.reserve1.times(2)
  if (pool.asset2.currency === 'XRP') return pool.reserve2.times(2)
  return null
}
