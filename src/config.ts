export type NetworkName = 'mainnet' | 'testnet'

export const NETWORK: NetworkName =
  process.env.NEXT_PUBLIC_XRPL_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'

const DEFAULT_WS: Record<NetworkName, string[]> = {
  mainnet: ['wss://xrplcluster.com', 'wss://s1.ripple.com', 'wss://s2.ripple.com'],
  testnet: ['wss://s.altnet.rippletest.net:51233'],
}

export const WS_ENDPOINTS: string[] = process.env.NEXT_PUBLIC_XRPL_WS
  ? process.env.NEXT_PUBLIC_XRPL_WS.split(',').map((s) => s.trim()).filter(Boolean)
  : DEFAULT_WS[NETWORK]

export const EXPLORER: Record<NetworkName, string> = {
  mainnet: 'https://livenet.xrpl.org',
  testnet: 'https://testnet.xrpl.org',
}

export const explorerTx = (hash: string) => `${EXPLORER[NETWORK]}/transactions/${hash}`
export const explorerAccount = (addr: string) => `${EXPLORER[NETWORK]}/accounts/${addr}`

export const XAMAN_API_KEY = process.env.NEXT_PUBLIC_XAMAN_API_KEY ?? ''

export const FEATURED_PAIRS: [string, string][] = (process.env.NEXT_PUBLIC_FEATURED_PAIRS ?? '')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => p.split('|') as [string, string])
  .filter((p) => p.length === 2)

/** Default slippage tolerance in percent. */
export const DEFAULT_SLIPPAGE = 1

/** Branding (e.g. when deployed as CBL Swap). */
export const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'xdex'
/** Path or URL of a square logo, e.g. /brand/cbl.png (put the file in /public/brand). */
export const BRAND_LOGO = process.env.NEXT_PUBLIC_BRAND_LOGO ?? ''
/** 'default' | 'cbl' — colour theme. */
export const THEME = process.env.NEXT_PUBLIC_THEME === 'cbl' ? 'cbl' : 'default'
/** Sites allowed to embed this app in an iframe (space-separated origins). */
export const FRAME_ANCESTORS =
  process.env.FRAME_ANCESTORS ?? 'https://cryptobarlounge.space https://*.cryptobarlounge.space https://cbl-crypto-hub.vercel.app'

/**
 * Swap fee, always collected in XRP so the fee wallet never needs trust lines.
 * - FEE_ACCOUNT: classic address that receives fees (empty = fees off)
 * - FEE_BPS: basis points (50 = 0.5%)
 * - FEE_MODE: 'batch' = swap + fee in one atomic Batch tx (one signature),
 *             falls back to 'separate' if the wallet/network rejects Batch;
 *             'separate' = swap, then a second fee payment; 'off'
 */
export const FEE_ACCOUNT = process.env.NEXT_PUBLIC_FEE_ACCOUNT ?? ''
export const FEE_BPS = Math.min(Math.max(Number(process.env.NEXT_PUBLIC_FEE_BPS ?? 50), 0), 500)
export const FEE_MODE: 'batch' | 'separate' | 'off' =
  !FEE_ACCOUNT || FEE_BPS === 0
    ? 'off'
    : process.env.NEXT_PUBLIC_FEE_MODE === 'separate'
      ? 'separate'
      : process.env.NEXT_PUBLIC_FEE_MODE === 'off'
        ? 'off'
        : 'batch'

/** Trust line limit set when a user enables a token. */
export const DEFAULT_TRUST_LIMIT = '1000000000000000'

/**
 * Known blackhole addresses. An issuer with the master key disabled and its
 * regular key set to one of these (and no signer list) can never issue more.
 */
export const BLACKHOLE_ADDRESSES = new Set([
  'rrrrrrrrrrrrrrrrrrrrrhoLvTp', // ACCOUNT_ZERO
  'rrrrrrrrrrrrrrrrrrrrBZbvji', // ACCOUNT_ONE
  'rrrrrrrrrrrrrrrrrNAMEtxvNvQ', // name reservation blackhole
  'rrrrrrrrrrrrrrrrrrrn5RM1rHd', // NaN address
])
