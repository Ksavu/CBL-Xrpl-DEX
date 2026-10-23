import type { Xumm } from 'xumm'
import { XAMAN_API_KEY } from '@/config'
import type { UnsignedTx } from '@/lib/xrpl/tx'
import { type SignHooks, type SubmitResult, UserRejected, type WalletAdapter } from './types'

/**
 * Xaman via the official browser SDK (OAuth2 PKCE — API key only, no secret).
 * - Desktop: sign requests show a QR the user scans with Xaman.
 * - Mobile web: the deeplink opens Xaman directly.
 * - Inside Xaman (xApp): the native sign sheet opens.
 */
let sdk: Xumm | null = null

async function getSdk(): Promise<Xumm> {
  if (!XAMAN_API_KEY) throw new Error('Xaman is not configured (NEXT_PUBLIC_XAMAN_API_KEY missing)')
  if (sdk) return sdk
  const { Xumm } = await import('xumm')
  sdk = new Xumm(XAMAN_API_KEY)
  return sdk
}

const isMobile = () => typeof navigator !== 'undefined' && /iPhone|iPad|Android/i.test(navigator.userAgent)

export const xaman: WalletAdapter = {
  id: 'xaman',
  name: 'Xaman',

  async isAvailable() {
    return !!XAMAN_API_KEY
  },

  async restore() {
    if (!XAMAN_API_KEY) return null
    const x = await getSdk()
    // Resolves once a stored session (or xApp context) has been checked.
    await Promise.race([x.environment.ready, new Promise((r) => setTimeout(r, 4000))])
    return (await x.user.account) ?? null
  },

  async connect() {
    const x = await getSdk()
    if (x.runtime.xapp) {
      const acct = await x.user.account
      if (acct) return acct
    }
    const res = await x.authorize()
    if (res instanceof Error) throw res
    const acct = res?.me?.account ?? (await x.user.account)
    if (!acct) throw new UserRejected()
    return acct
  },

  async disconnect() {
    if (sdk) await sdk.logout()
  },

  async signAndSubmit(tx: UnsignedTx, hooks?: SignHooks): Promise<SubmitResult> {
    const x = await getSdk()
    if (!x.payload) throw new Error('Xaman session not ready — reconnect')

    const sub = await x.payload.createAndSubscribe(
      { txjson: tx as any, options: { submit: true, expire: 5 } },
      (event) => {
        if ('signed' in event.data) return event.data
      },
    )
    const created = sub.created

    if (x.runtime.xapp && x.xapp) {
      x.xapp.openSignRequest({ uuid: created.uuid })
    } else if (isMobile()) {
      window.location.href = created.next.always
    } else {
      hooks?.showQr?.({ qrPng: created.refs.qr_png, deeplink: created.next.always, label: tx.TransactionType })
    }

    try {
      const outcome = (await sub.resolved) as { signed: boolean } | undefined
      if (!outcome?.signed) throw new UserRejected()
      const p = await x.payload.get(created.uuid)
      const hash = p?.response?.txid
      if (!hash) throw new Error('Signed, but Xaman returned no tx hash')
      return { hash, engineResult: p?.response?.dispatched_result ?? undefined }
    } finally {
      hooks?.hideQr?.()
    }
  },
}
