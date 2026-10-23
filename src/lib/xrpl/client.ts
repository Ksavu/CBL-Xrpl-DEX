import { Client } from 'xrpl'
import { WS_ENDPOINTS } from '@/config'

/**
 * One shared xrpl.js client per runtime (browser tab or server process),
 * with failover across configured endpoints.
 */
let client: Client | null = null
let connecting: Promise<Client> | null = null
let endpointIdx = 0

export async function getClient(endpoints: string[] = WS_ENDPOINTS): Promise<Client> {
  if (client?.isConnected()) return client
  if (connecting) return connecting

  connecting = (async () => {
    let lastErr: unknown
    for (let i = 0; i < endpoints.length; i++) {
      const url = endpoints[(endpointIdx + i) % endpoints.length]
      const c = new Client(url, { connectionTimeout: 10_000 })
      try {
        await c.connect()
        endpointIdx = (endpointIdx + i) % endpoints.length
        c.on('disconnected', () => {
          if (client === c) client = null
        })
        client = c
        return c
      } catch (e) {
        lastErr = e
        try {
          await c.disconnect()
        } catch {}
      }
    }
    throw new Error(`Could not connect to XRPL: ${(lastErr as Error)?.message ?? lastErr}`)
  })()

  try {
    return await connecting
  } finally {
    connecting = null
  }
}

/** Server reserve settings (in XRP). */
export async function getReserves(c: Client): Promise<{ base: number; owner: number }> {
  const r = await c.request({ command: 'server_info' })
  const v = r.result.info.validated_ledger
  return { base: v?.reserve_base_xrp ?? 1, owner: v?.reserve_inc_xrp ?? 0.2 }
}

/**
 * Wait for a submitted tx to be validated. Resolves with the final result code
 * (e.g. "tesSUCCESS") or throws if it expired without validating.
 */
export async function waitForValidation(
  hash: string,
  { timeoutMs = 60_000, pollMs = 1_500 } = {},
): Promise<{ result: string; ledger: number }> {
  const c = await getClient()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await c.request({ command: 'tx', transaction: hash })
      const res = r.result as any
      if (res.validated) {
        const meta = res.meta ?? res.metaData
        return { result: meta?.TransactionResult ?? 'unknown', ledger: res.ledger_index }
      }
    } catch (e: any) {
      // txnNotFound is normal right after submission
      if (e?.data?.error !== 'txnNotFound') throw e
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new Error('Timed out waiting for validation')
}

/** Results of the inner transactions of a validated Batch (empty if none were applied). */
export async function innerBatchResults(account: string, batchHash: string, ledger: number): Promise<string[]> {
  const c = await getClient()
  const r: any = await c.request({
    command: 'account_tx',
    account,
    ledger_index_min: ledger,
    ledger_index_max: ledger,
    limit: 50,
  })
  return (r.result.transactions ?? [])
    .filter((t: any) => (t.meta ?? t.metaData)?.ParentBatchID === batchHash)
    .map((t: any) => (t.meta ?? t.metaData).TransactionResult as string)
}
