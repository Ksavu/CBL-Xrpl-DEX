import type { UnsignedTx } from '@/lib/xrpl/tx'
import { type SubmitResult, UserRejected, type WalletAdapter } from './types'

const api = () => import('@gemwallet/api')

export const gem: WalletAdapter = {
  id: 'gem',
  name: 'GemWallet',

  async isAvailable() {
    if (typeof window === 'undefined') return false
    try {
      const { isInstalled } = await api()
      const r = await isInstalled()
      return !!r.result?.isInstalled
    } catch {
      return false
    }
  },

  async restore() {
    // GemWallet prompts on getAddress; don't call it silently on page load.
    return null
  },

  async connect() {
    const { getAddress } = await api()
    const r = await getAddress()
    if (r.type === 'reject' || !r.result?.address) throw new UserRejected()
    return r.result.address
  },

  async disconnect() {},

  async signAndSubmit(tx: UnsignedTx): Promise<SubmitResult> {
    const { submitTransaction } = await api()
    const r = await submitTransaction({ transaction: tx as any })
    if (r.type === 'reject' || !r.result?.hash) throw new UserRejected()
    return { hash: r.result.hash }
  },
}
