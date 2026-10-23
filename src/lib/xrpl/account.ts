import type { Client } from 'xrpl'
import { BigNumber, type Asset, type IssuedAsset, isXrp } from './assets'
import { getReserves } from './client'

export interface TrustLine {
  currency: string
  issuer: string
  balance: BigNumber
  limit: BigNumber
  noRipple: boolean
  frozen: boolean
}

export interface AccountState {
  address: string
  exists: boolean
  xrpBalance: BigNumber
  /** XRP not locked by base + owner reserves. */
  xrpSpendable: BigNumber
  ownerCount: number
  lines: TrustLine[]
  reserves: { base: number; owner: number }
}

export async function getAccountState(c: Client, address: string): Promise<AccountState> {
  const reserves = await getReserves(c)
  let info: any
  try {
    info = (await c.request({ command: 'account_info', account: address, ledger_index: 'validated' })).result.account_data
  } catch (e: any) {
    if (e?.data?.error === 'actNotFound') {
      return {
        address,
        exists: false,
        xrpBalance: new BigNumber(0),
        xrpSpendable: new BigNumber(0),
        ownerCount: 0,
        lines: [],
        reserves,
      }
    }
    throw e
  }

  const lines = await getTrustLines(c, address)
  const xrpBalance = new BigNumber(info.Balance).shiftedBy(-6)
  const locked = new BigNumber(reserves.base).plus(new BigNumber(reserves.owner).times(info.OwnerCount))
  return {
    address,
    exists: true,
    xrpBalance,
    xrpSpendable: BigNumber.max(0, xrpBalance.minus(locked)),
    ownerCount: info.OwnerCount,
    lines,
    reserves,
  }
}

export async function getTrustLines(c: Client, address: string, maxPages = 10): Promise<TrustLine[]> {
  const out: TrustLine[] = []
  let marker: unknown
  for (let page = 0; page < maxPages; page++) {
    const r: any = await c.request({
      command: 'account_lines',
      account: address,
      ledger_index: 'validated',
      limit: 400,
      ...(marker ? { marker } : {}),
    })
    for (const l of r.result.lines) {
      out.push({
        currency: l.currency,
        issuer: l.account,
        balance: new BigNumber(l.balance),
        limit: new BigNumber(l.limit),
        noRipple: !!l.no_ripple,
        frozen: !!l.freeze_peer,
      })
    }
    marker = r.result.marker
    if (!marker) break
  }
  return out
}

export function findLine(state: AccountState | null, asset: Asset): TrustLine | undefined {
  if (!state || isXrp(asset)) return undefined
  const a = asset as IssuedAsset
  return state.lines.find((l) => l.currency === a.currency && l.issuer === a.issuer)
}

/** Balance a user can spend for an asset (XRP: minus reserves). */
export function spendable(state: AccountState | null, asset: Asset): BigNumber {
  if (!state) return new BigNumber(0)
  if (isXrp(asset)) return state.xrpSpendable
  return findLine(state, asset)?.balance ?? new BigNumber(0)
}

/** Whether the user must create a trust line before receiving this asset. */
export function needsTrustLine(state: AccountState | null, asset: Asset): boolean {
  if (!state || isXrp(asset)) return false
  // The issuer itself never needs a line to its own token.
  if ((asset as IssuedAsset).issuer === state.address) return false
  const line = findLine(state, asset)
  return !line || line.limit.lte(0)
}
