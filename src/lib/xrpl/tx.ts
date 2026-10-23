import {
  AMMDepositFlags,
  AMMWithdrawFlags,
  OfferCreateFlags,
  TrustSetFlags,
  type AMMCreate,
  type AMMDeposit,
  type AMMWithdraw,
  type OfferCreate,
  type SubmittableTransaction,
  type TrustSet,
} from 'xrpl'
import { DEFAULT_TRUST_LIMIT } from '@/config'
import { BigNumber, type Asset, type IssuedAsset, toAmount, toCurrency } from './assets'

/**
 * Unsigned transactions. Wallets (Xaman / Crossmark / GemWallet) autofill
 * Fee, Sequence and LastLedgerSequence before signing.
 */
export type UnsignedTx = SubmittableTransaction

/** Optional on-chain tag so swaps from this frontend can be attributed / indexed. */
export const SOURCE_TAG = 0x58444558 // "XDEX" — change to your own registered tag

/**
 * Exact-input swap via OfferCreate.
 *
 * - TakerGets = what the user gives (amountIn)
 * - TakerPays = the minimum the user accepts (minOut)
 * - tfSell: sell the full TakerGets even if it yields more than TakerPays
 * - tfFillOrKill: either the whole amountIn is sold at ≥ the min rate, or nothing happens
 *
 * Offer crossing consumes AMM pools and order-book offers together and
 * auto-bridges token→token through XRP.
 */
export function buildSwap(account: string, from: Asset, to: Asset, amountIn: BigNumber, minOut: BigNumber): OfferCreate {
  return {
    TransactionType: 'OfferCreate',
    Account: account,
    TakerGets: toAmount(from, amountIn, 'down'),
    TakerPays: toAmount(to, minOut, 'down'),
    Flags: OfferCreateFlags.tfSell | OfferCreateFlags.tfFillOrKill,
    SourceTag: SOURCE_TAG,
  }
}

/** Enable a token: create a trust line (rippling disabled, as wallets should). */
export function buildTrustSet(account: string, asset: IssuedAsset, limit = DEFAULT_TRUST_LIMIT): TrustSet {
  return {
    TransactionType: 'TrustSet',
    Account: account,
    LimitAmount: { currency: asset.currency, issuer: asset.issuer, value: limit },
    Flags: TrustSetFlags.tfSetNoRipple,
  }
}

/** Proportional deposit with max amounts on both sides. */
export function buildDepositTwo(account: string, a1: Asset, max1: BigNumber, a2: Asset, max2: BigNumber): AMMDeposit {
  return {
    TransactionType: 'AMMDeposit',
    Account: account,
    Asset: toCurrency(a1),
    Asset2: toCurrency(a2),
    Amount: toAmount(a1, max1, 'down'),
    Amount2: toAmount(a2, max2, 'down'),
    Flags: AMMDepositFlags.tfTwoAsset,
  }
}

/** Single-sided deposit (incurs the trading fee on the implicit swap half). */
export function buildDepositSingle(account: string, a1: Asset, a2: Asset, deposit: Asset, amount: BigNumber): AMMDeposit {
  return {
    TransactionType: 'AMMDeposit',
    Account: account,
    Asset: toCurrency(a1),
    Asset2: toCurrency(a2),
    Amount: toAmount(deposit, amount, 'down'),
    Flags: AMMDepositFlags.tfSingleAsset,
  }
}

/** Burn a specific amount of LP tokens for both assets, pro-rata. */
export function buildWithdrawLp(
  account: string,
  a1: Asset,
  a2: Asset,
  lpToken: { currency: string; issuer: string },
  lpIn: BigNumber,
): AMMWithdraw {
  return {
    TransactionType: 'AMMWithdraw',
    Account: account,
    Asset: toCurrency(a1),
    Asset2: toCurrency(a2),
    LPTokenIn: toAmount(lpToken, lpIn, 'down') as { currency: string; issuer: string; value: string },
    Flags: AMMWithdrawFlags.tfLPToken,
  }
}

export function buildWithdrawAll(account: string, a1: Asset, a2: Asset): AMMWithdraw {
  return {
    TransactionType: 'AMMWithdraw',
    Account: account,
    Asset: toCurrency(a1),
    Asset2: toCurrency(a2),
    Flags: AMMWithdrawFlags.tfWithdrawAll,
  }
}

/**
 * Create a new pool. tradingFeePct: 0–1 (%). The AMMCreate fee equals one
 * owner reserve increment; wallets that autofill handle this.
 */
export function buildAmmCreate(account: string, a1: Asset, amt1: BigNumber, a2: Asset, amt2: BigNumber, tradingFeePct: number): AMMCreate {
  const fee = Math.round(Math.min(Math.max(tradingFeePct, 0), 1) * 1000)
  return {
    TransactionType: 'AMMCreate',
    Account: account,
    Amount: toAmount(a1, amt1, 'down'),
    Amount2: toAmount(a2, amt2, 'down'),
    TradingFee: fee,
  }
}
