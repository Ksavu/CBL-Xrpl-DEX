import type { UnsignedTx } from '@/lib/xrpl/tx'

export type WalletId = 'xaman' | 'crossmark' | 'gem'

/** UI hooks a wallet can use while waiting for the user (e.g. Xaman QR modal). */
export interface SignHooks {
  showQr?: (req: { qrPng: string; deeplink: string; label: string }) => void
  hideQr?: () => void
}

export interface SubmitResult {
  hash: string
  /** Engine result reported by the wallet at submit time (not final until validated). */
  engineResult?: string
}

export interface WalletAdapter {
  id: WalletId
  name: string
  /** True if the wallet can be used in this browser right now. */
  isAvailable(): Promise<boolean>
  /** Restore a previous session silently, if any. */
  restore(): Promise<string | null>
  connect(hooks?: SignHooks): Promise<string>
  disconnect(): Promise<void>
  /** Sign and submit. Throws `UserRejected` if the user declines. */
  signAndSubmit(tx: UnsignedTx, hooks?: SignHooks): Promise<SubmitResult>
}

export class UserRejected extends Error {
  constructor() {
    super('Rejected in wallet')
    this.name = 'UserRejected'
  }
}
