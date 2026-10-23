import BigNumber from 'bignumber.js'
import type { Amount, Currency } from 'xrpl'

BigNumber.config({ EXPONENTIAL_AT: [-40, 40], DECIMAL_PLACES: 40 })

export { BigNumber }

export type XrpAsset = { currency: 'XRP' }
export type IssuedAsset = { currency: string; issuer: string }
export type Asset = XrpAsset | IssuedAsset

export const XRP: XrpAsset = { currency: 'XRP' }

export const isXrp = (a: Asset): a is XrpAsset => a.currency === 'XRP' && !('issuer' in a && a.issuer)

/** Stable string id: "XRP" or "CURRENCY.rIssuer" (currency in its raw ledger form). */
export function assetId(a: Asset): string {
  return isXrp(a) ? 'XRP' : `${a.currency}.${(a as IssuedAsset).issuer}`
}

export function parseAssetId(id: string): Asset {
  const s = decodeURIComponent(id).trim()
  if (s.toUpperCase() === 'XRP') return XRP
  const dot = s.lastIndexOf('.')
  if (dot <= 0) throw new Error(`Invalid asset id: ${id}`)
  return { currency: normalizeCurrency(s.slice(0, dot)), issuer: s.slice(dot + 1) }
}

export const sameAsset = (a: Asset, b: Asset) => assetId(a) === assetId(b)

/**
 * Currency codes on XRPL are either 3-char ISO-like codes or 160-bit hex.
 * Codes longer than 3 chars typed by a user are converted to 40-char hex.
 */
export function normalizeCurrency(code: string): string {
  if (code === 'XRP') return 'XRP'
  if (/^[0-9A-Fa-f]{40}$/.test(code)) return code.toUpperCase()
  if (code.length === 3) return code
  if (code.length > 20) throw new Error('Currency code too long (max 20 chars)')
  const hex = Array.from(new TextEncoder().encode(code))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
  return hex.padEnd(40, '0')
}

/** Human-readable currency code (decodes 40-char hex). */
export function currencyLabel(code: string): string {
  if (!/^[0-9A-F]{40}$/i.test(code)) return code
  // LP tokens start with 0x03 — show a generic label.
  if (code.startsWith('03')) return 'LP'
  const bytes = code.match(/.{2}/g)!.map((h) => parseInt(h, 16)).filter((b) => b !== 0)
  try {
    const s = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))
    return /^[\x20-\x7E -￿]+$/.test(s) ? s : code.slice(0, 8)
  } catch {
    return code.slice(0, 8)
  }
}

export const assetLabel = (a: Asset) => (isXrp(a) ? 'XRP' : currencyLabel(a.currency))

export const shortAddr = (addr: string) => `${addr.slice(0, 5)}…${addr.slice(-4)}`

/** xrpl.js `Currency` shape (used by amm_info, book_offers, AMM txs). */
export function toCurrency(a: Asset): Currency {
  return isXrp(a) ? { currency: 'XRP' } : { currency: a.currency, issuer: (a as IssuedAsset).issuer }
}

export function fromCurrency(c: Currency | { currency: string; issuer?: string }): Asset {
  if (!('currency' in c)) throw new Error('MPT assets are not supported yet')
  return c.currency === 'XRP' || !('issuer' in c) || !c.issuer ? XRP : { currency: c.currency, issuer: c.issuer }
}

/**
 * IOU values: max 15 significant digits. Round DOWN so we never ask for more
 * than the user has or promise more than a quote supports.
 */
export function formatIouValue(v: BigNumber.Value): string {
  const bn = new BigNumber(v)
  if (bn.isZero()) return '0'
  return bn.precision(15, BigNumber.ROUND_DOWN).toFixed()
}

/** Convert a human amount (XRP or token units) into an xrpl Amount. */
export function toAmount(a: Asset, value: BigNumber.Value, round: 'down' | 'up' = 'down'): Amount {
  const bn = new BigNumber(value)
  if (isXrp(a)) {
    const drops = bn.shiftedBy(6).integerValue(round === 'down' ? BigNumber.ROUND_DOWN : BigNumber.ROUND_UP)
    return drops.toFixed(0)
  }
  const issued = a as IssuedAsset
  const val =
    round === 'down' ? formatIouValue(bn) : bn.precision(15, BigNumber.ROUND_UP).toFixed()
  return { currency: issued.currency, issuer: issued.issuer, value: val }
}

/** Convert an xrpl Amount into { asset, value } in human units. */
export function fromAmount(amt: Amount | { currency: string; issuer?: string; value: string }): {
  asset: Asset
  value: BigNumber
} {
  if (typeof amt === 'string') return { asset: XRP, value: new BigNumber(amt).shiftedBy(-6) }
  if ('mpt_issuance_id' in amt) throw new Error('MPT amounts are not supported yet')
  return { asset: fromCurrency(amt as { currency: string; issuer?: string }), value: new BigNumber(amt.value) }
}

/** Display formatting with sensible precision for small meme-token prices. */
export function fmt(v: BigNumber.Value, maxSig = 6): string {
  const bn = new BigNumber(v)
  if (!bn.isFinite()) return '—'
  if (bn.isZero()) return '0'
  const abs = bn.abs()
  if (abs.gte(1e9)) return bn.div(1e9).toFormat(2) + 'B'
  if (abs.gte(1e6)) return bn.div(1e6).toFormat(2) + 'M'
  if (abs.gte(1000)) return bn.toFormat(2)
  if (abs.gte(1)) return bn.toFormat(4).replace(/\.?0+$/, '')
  return bn.precision(maxSig, BigNumber.ROUND_DOWN).toFixed()
}
