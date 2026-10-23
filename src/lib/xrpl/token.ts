import { convertHexToString, type Client } from 'xrpl'
import { BLACKHOLE_ADDRESSES } from '@/config'
import { BigNumber, type IssuedAsset } from './assets'

// AccountRoot flags (https://xrpl.org/docs/references/protocol/ledger-data/ledger-entry-types/accountroot)
const lsfRequireAuth = 0x00040000
const lsfDisableMaster = 0x00100000
const lsfNoFreeze = 0x00200000
const lsfGlobalFreeze = 0x00400000
const lsfDefaultRipple = 0x00800000
const lsfAllowTrustLineClawback = 0x80000000

export interface TokenInfo {
  asset: IssuedAsset
  issuerExists: boolean
  domain?: string
  /** Supply outstanding (sum of obligations to holders). */
  supply: BigNumber
  /** Holders with a positive balance (capped at `holdersCapped` when truncated). */
  holders: number
  holdersCapped: boolean
  /** Transfer fee, as a percent. */
  transferFeePct: number
  flags: {
    blackholed: boolean
    masterDisabled: boolean
    regularKey?: string
    hasSignerList: boolean
    requireAuth: boolean
    noFreeze: boolean
    globalFreeze: boolean
    defaultRipple: boolean
    clawbackEnabled: boolean
  }
}

/** Safety-relevant facts about a token's issuer, for the token page. */
export async function getTokenInfo(c: Client, asset: IssuedAsset, maxHolderPages = 5): Promise<TokenInfo> {
  let acct: any
  let signerLists: any[] = []
  try {
    const r: any = await c.request({
      command: 'account_info',
      account: asset.issuer,
      ledger_index: 'validated',
      signer_lists: true,
    })
    acct = r.result.account_data
    signerLists = r.result.signer_lists ?? acct.signer_lists ?? []
  } catch (e: any) {
    if (e?.data?.error === 'actNotFound') {
      return {
        asset,
        issuerExists: false,
        supply: new BigNumber(0),
        holders: 0,
        holdersCapped: false,
        transferFeePct: 0,
        flags: {
          blackholed: false,
          masterDisabled: false,
          hasSignerList: false,
          requireAuth: false,
          noFreeze: false,
          globalFreeze: false,
          defaultRipple: false,
          clawbackEnabled: false,
        },
      }
    }
    throw e
  }

  const f = acct.Flags >>> 0
  const masterDisabled = (f & lsfDisableMaster) !== 0
  const regularKey: string | undefined = acct.RegularKey
  const hasSignerList = signerLists.length > 0
  const blackholed =
    masterDisabled && !hasSignerList && (!regularKey || BLACKHOLE_ADDRESSES.has(regularKey))

  // Supply: gateway_balances returns obligations per currency.
  let supply = new BigNumber(0)
  try {
    const gb: any = await c.request({ command: 'gateway_balances', account: asset.issuer, ledger_index: 'validated' })
    const ob = gb.result.obligations?.[asset.currency]
    if (ob) supply = new BigNumber(ob)
  } catch {}

  // Holders: count trust lines on the issuer with a non-zero balance in this currency.
  let holders = 0
  let marker: unknown
  let pages = 0
  do {
    const r: any = await c.request({
      command: 'account_lines',
      account: asset.issuer,
      ledger_index: 'validated',
      limit: 400,
      ...(marker ? { marker } : {}),
    })
    for (const l of r.result.lines) {
      // From the issuer's perspective holder balances are negative.
      if (l.currency === asset.currency && new BigNumber(l.balance).lt(0)) holders++
    }
    marker = r.result.marker
    pages++
  } while (marker && pages < maxHolderPages)

  const transferRate = acct.TransferRate ? Number(acct.TransferRate) : 0
  const transferFeePct = transferRate > 0 ? (transferRate - 1_000_000_000) / 10_000_000 : 0

  let domain: string | undefined
  if (acct.Domain) {
    try {
      domain = convertHexToString(acct.Domain)
    } catch {}
  }

  return {
    asset,
    issuerExists: true,
    domain,
    supply,
    holders,
    holdersCapped: !!marker,
    transferFeePct,
    flags: {
      blackholed,
      masterDisabled,
      regularKey,
      hasSignerList,
      requireAuth: (f & lsfRequireAuth) !== 0,
      noFreeze: (f & lsfNoFreeze) !== 0,
      globalFreeze: (f & lsfGlobalFreeze) !== 0,
      defaultRipple: (f & lsfDefaultRipple) !== 0,
      clawbackEnabled: (f & lsfAllowTrustLineClawback) !== 0,
    },
  }
}
