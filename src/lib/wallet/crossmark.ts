import type { UnsignedTx } from '@/lib/xrpl/tx'
import { type SubmitResult, UserRejected, type WalletAdapter } from './types'

type CrossmarkSdk = (typeof import('@crossmarkio/sdk'))['default']
let sdk: CrossmarkSdk | null = null

async function getSdk(): Promise<CrossmarkSdk> {
  if (sdk) return sdk
  const mod = await import('@crossmarkio/sdk')
  sdk = mod.default
  return sdk
}

export const crossmark: WalletAdapter = {
  id: 'crossmark',
  name: 'Crossmark',

  async isAvailable() {
    if (typeof window === 'undefined') return false
    const s = await getSdk()
    // The extension injects itself shortly after page load.
    return !!(s.sync.isInstalled() || (await s.async.detect(1500)))
  },

  async restore() {
    const s = await getSdk()
    if (!s.sync.isInstalled()) return null
    return s.sync.getAddress() ?? null
  },

  async connect() {
    const s = await getSdk()
    const res = await s.async.signInAndWait()
    const addr = res?.response?.data?.address
    if (!addr) throw new UserRejected()
    return addr
  },

  async disconnect() {
    // Crossmark has no programmatic sign-out; forgetting the address locally is enough.
  },

  async signAndSubmit(tx: UnsignedTx): Promise<SubmitResult> {
    const s = await getSdk()
    const res = await s.async.signAndSubmitAndWait(tx as any)
    const data = res?.response?.data
    if (!data || data.meta?.isRejected) throw new UserRejected()
    const result: any = (data.resp as any)?.result
    const hash: string | undefined = result?.hash ?? result?.tx_json?.hash
    if (!hash) throw new Error('Crossmark returned no transaction hash')
    return { hash, engineResult: result?.meta?.TransactionResult ?? result?.engine_result }
  },
}
