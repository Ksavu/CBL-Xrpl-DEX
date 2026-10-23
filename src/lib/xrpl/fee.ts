import { BatchFlags, GlobalFlags, type Batch, type OfferCreate, type Payment } from 'xrpl'
import { FEE_ACCOUNT, FEE_BPS, FEE_MODE } from '@/config'
import { spotPrice } from './amm'
import { BigNumber, type Asset, XRP, isXrp, sameAsset, toAmount } from './assets'
import type { Quote } from './quote'

/** Minimum fee worth collecting (avoid dust payments). */
const MIN_FEE_XRP = new BigNumber('0.000010')

export const feesEnabled = () => FEE_MODE !== 'off'

/**
 * Fee for a swap, always in XRP:
 * - XRP → token: % of the XRP paid (deducted from the input before swapping)
 * - token → XRP: % of the guaranteed minimum XRP received
 * - token → token: % of the input's XRP value at the first pool's spot price
 */
export function feeForSwap(from: Asset, to: Asset, grossIn: BigNumber, quote: Quote | null): BigNumber {
  if (!feesEnabled() || grossIn.lte(0)) return new BigNumber(0)
  const rate = new BigNumber(FEE_BPS).div(10_000)
  let fee: BigNumber
  if (isXrp(from)) fee = grossIn.times(rate)
  else if (isXrp(to)) fee = quote ? quote.minOut.times(rate) : new BigNumber(0)
  else {
    const firstHop = quote?.route.find((p) => sameAsset(p.asset1, XRP) || sameAsset(p.asset2, XRP))
    fee = firstHop && quote?.route[0] === firstHop ? grossIn.times(spotPrice(firstHop, from)).times(rate) : new BigNumber(0)
  }
  fee = fee.decimalPlaces(6, BigNumber.ROUND_DOWN)
  return fee.lt(MIN_FEE_XRP) ? new BigNumber(0) : fee
}

/** Amount actually swapped (XRP input pays the fee out of the entered amount). */
export const netSwapIn = (from: Asset, grossIn: BigNumber, fee: BigNumber) =>
  isXrp(from) ? BigNumber.max(0, grossIn.minus(fee)) : grossIn

export function buildFeePayment(account: string, feeXrp: BigNumber): Payment {
  return {
    TransactionType: 'Payment',
    Account: account,
    Destination: FEE_ACCOUNT,
    Amount: toAmount(XRP, feeXrp) as string,
  }
}

/**
 * Atomic swap + fee: an XLS-56 Batch with tfAllOrNothing. If the swap fails
 * (e.g. slippage → tecKILLED) the fee is not charged either.
 * Inner txs carry tfInnerBatchTxn, zero fee and no signature; the outer tx
 * pays the fee and is the only thing the user signs.
 */
export function buildSwapWithFeeBatch(account: string, swap: OfferCreate, feeXrp: BigNumber): Batch {
  const inner = (tx: OfferCreate | Payment) => ({
    RawTransaction: {
      ...tx,
      Account: account,
      Flags: ((tx.Flags as number | undefined) ?? 0) | GlobalFlags.tfInnerBatchTxn,
      Fee: '0',
      SigningPubKey: '',
    },
  })
  return {
    TransactionType: 'Batch',
    Account: account,
    Flags: BatchFlags.tfAllOrNothing,
    RawTransactions: [inner(swap), inner(buildFeePayment(account, feeXrp))],
  } as Batch
}

// Remember per browser if Batch was rejected, so we go straight to the fallback.
const KEY = 'xdex.batchUnsupported'
export const batchUnsupported = () => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
export const markBatchUnsupported = () => {
  try {
    localStorage.setItem(KEY, '1')
  } catch {}
}

/** Errors meaning "Batch isn't available here" (amendment off or wallet can't sign it). */
export const isBatchUnsupportedError = (code?: string, message?: string) =>
  code === 'temDISABLED' ||
  code === 'temINVALID_FLAG' ||
  code === 'temMALFORMED' ||
  /batch|unsupported|unknown transaction|not supported|invalid transaction type/i.test(message ?? '')
