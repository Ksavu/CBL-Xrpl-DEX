'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { explorerTx } from '@/config'
import { getClient, innerBatchResults, waitForValidation } from '@/lib/xrpl/client'
import { type AccountState, getAccountState } from '@/lib/xrpl/account'
import type { UnsignedTx } from '@/lib/xrpl/tx'
import { crossmark } from './crossmark'
import { gem } from './gem'
import { xaman } from './xaman'
import { type SignHooks, UserRejected, type WalletAdapter, type WalletId } from './types'

export const ADAPTERS: Record<WalletId, WalletAdapter> = { xaman, crossmark, gem }
const STORAGE_KEY = 'xdex.wallet'

export type TxStatus = 'signing' | 'submitted' | 'success' | 'failed'
export interface TxToast {
  id: number
  label: string
  status: TxStatus
  hash?: string
  message?: string
}

interface WalletCtx {
  account: string | null
  walletId: WalletId | null
  state: AccountState | null
  refresh: () => Promise<void>
  connect: (id: WalletId) => Promise<void>
  disconnect: () => Promise<void>
  /** Sign, submit and wait for validation. Returns true on tesSUCCESS. */
  sendTx: (tx: UnsignedTx, label: string) => Promise<boolean>
  /** Same as sendTx, but returns the result code / error for callers that branch on it. */
  sendTxResult: (tx: UnsignedTx, label: string, opts?: TxOpts) => Promise<TxResult>
  openWalletModal: () => void
  toasts: TxToast[]
  dismissToast: (id: number) => void
}

export interface TxOpts {
  /** Suppress the failure toast when this returns true (caller will retry another way). */
  silentIf?: (code?: string, message?: string) => boolean
}

export interface TxResult {
  ok: boolean
  code?: string
  message?: string
  rejected?: boolean
  hash?: string
  ledger?: number
}

const Ctx = createContext<WalletCtx | null>(null)

export function useWallet() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useWallet must be used inside <WalletProvider>')
  return c
}

const safeStorage = {
  get: () => {
    try {
      return localStorage.getItem(STORAGE_KEY) as WalletId | null
    } catch {
      return null
    }
  },
  set: (v: string | null) => {
    try {
      v ? localStorage.setItem(STORAGE_KEY, v) : localStorage.removeItem(STORAGE_KEY)
    } catch {}
  },
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null)
  const [walletId, setWalletId] = useState<WalletId | null>(null)
  const [state, setState] = useState<AccountState | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [qr, setQr] = useState<{ qrPng: string; deeplink: string; label: string } | null>(null)
  const [toasts, setToasts] = useState<TxToast[]>([])
  const [available, setAvailable] = useState<Partial<Record<WalletId, boolean>>>({})
  const toastId = useRef(0)

  const hooks: SignHooks = useMemo(() => ({ showQr: setQr, hideQr: () => setQr(null) }), [])

  const refresh = useCallback(async () => {
    if (!account) return setState(null)
    try {
      const c = await getClient()
      setState(await getAccountState(c, account))
    } catch (e) {
      console.error('account refresh failed', e)
    }
  }, [account])

  useEffect(() => {
    refresh()
    if (!account) return
    const t = setInterval(refresh, 15_000)
    return () => clearInterval(t)
  }, [account, refresh])

  // Restore last wallet session on load.
  useEffect(() => {
    const saved = safeStorage.get()
    if (!saved || !ADAPTERS[saved]) return
    ADAPTERS[saved]
      .restore()
      .then((addr) => {
        if (addr) {
          setAccount(addr)
          setWalletId(saved)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!modalOpen) return
    for (const a of Object.values(ADAPTERS)) {
      a.isAvailable()
        .then((ok) => setAvailable((s) => ({ ...s, [a.id]: ok })))
        .catch(() => setAvailable((s) => ({ ...s, [a.id]: false })))
    }
  }, [modalOpen])

  const connect = useCallback(
    async (id: WalletId) => {
      const addr = await ADAPTERS[id].connect(hooks)
      setAccount(addr)
      setWalletId(id)
      safeStorage.set(id)
      setModalOpen(false)
    },
    [hooks],
  )

  const disconnect = useCallback(async () => {
    if (walletId) await ADAPTERS[walletId].disconnect().catch(() => {})
    setAccount(null)
    setWalletId(null)
    setState(null)
    safeStorage.set(null)
  }, [walletId])

  const upsertToast = (t: TxToast) =>
    setToasts((all) => [...all.filter((x) => x.id !== t.id), t].slice(-4))

  const sendTxResult = useCallback(
    async (tx: UnsignedTx, label: string, opts?: TxOpts): Promise<TxResult> => {
      if (!account || !walletId) {
        setModalOpen(true)
        return { ok: false, message: 'No wallet connected' }
      }
      const id = ++toastId.current
      upsertToast({ id, label, status: 'signing' })
      try {
        let prepared = { ...tx, Account: account } as UnsignedTx
        // Batch inner txs need sequences relative to the outer tx; fill them here
        // since not every wallet's autofill understands Batch yet.
        if (prepared.TransactionType === 'Batch') {
          const c = await getClient()
          prepared = (await c.autofill(prepared)) as UnsignedTx
        }
        const { hash, engineResult } = await ADAPTERS[walletId].signAndSubmit(prepared, hooks)
        // tem/tef/tel results never make it into a ledger — fail fast instead of polling.
        if (engineResult && /^(tem|tef|tel)/.test(engineResult)) {
          if (opts?.silentIf?.(engineResult)) setToasts((all) => all.filter((t) => t.id !== id))
          else upsertToast({ id, label, status: 'failed', hash, message: explainResult(engineResult) })
          return { ok: false, code: engineResult }
        }
        upsertToast({ id, label, status: 'submitted', hash })
        const { result: outer, ledger } = await waitForValidation(hash)
        let result = outer
        // A validated Batch only means the wrapper was processed; under
        // all-or-nothing the inner txs may have been rolled back.
        if (outer === 'tesSUCCESS' && prepared.TransactionType === 'Batch') {
          const inner = await innerBatchResults(account, hash, ledger)
          const expected = (prepared as any).RawTransactions?.length ?? 0
          if (inner.length < expected || inner.some((r) => r !== 'tesSUCCESS')) result = 'tecBATCH_FAILURE'
        }
        const ok = result === 'tesSUCCESS'
        upsertToast({ id, label, status: ok ? 'success' : 'failed', hash, message: ok ? undefined : explainResult(result) })
        refresh()
        return { ok, code: result, hash, ledger }
      } catch (e: any) {
        const rejected = e instanceof UserRejected
        const message = rejected ? 'Rejected in wallet' : (e?.message ?? String(e))
        if (!rejected && opts?.silentIf?.(undefined, message)) setToasts((all) => all.filter((t) => t.id !== id))
        else upsertToast({ id, label, status: 'failed', message })
        return { ok: false, message, rejected }
      }
    },
    [account, walletId, hooks, refresh],
  )

  const sendTx = useCallback(
    async (tx: UnsignedTx, label: string) => (await sendTxResult(tx, label)).ok,
    [sendTxResult],
  )

  const value: WalletCtx = {
    account,
    walletId,
    state,
    refresh,
    connect,
    disconnect,
    sendTx,
    sendTxResult,
    openWalletModal: () => setModalOpen(true),
    toasts,
    dismissToast: (id) => setToasts((all) => all.filter((t) => t.id !== id)),
  }

  return (
    <Ctx.Provider value={value}>
      {children}
      {modalOpen && (
        <WalletModal available={available} onClose={() => setModalOpen(false)} onPick={connect} />
      )}
      {qr && <QrModal {...qr} onClose={() => setQr(null)} />}
      <Toasts toasts={toasts} onDismiss={value.dismissToast} />
    </Ctx.Provider>
  )
}

/** Plain-language messages for common failure codes. */
export function explainResult(code: string): string {
  const map: Record<string, string> = {
    tecKILLED: 'Price moved beyond your slippage — nothing was traded. Try again or raise slippage.',
    tecUNFUNDED_OFFER: 'Insufficient balance for this swap.',
    tecINSUF_RESERVE_OFFER: 'Not enough XRP to cover the reserve.',
    tecNO_LINE_INSUF_RESERVE: 'Not enough XRP reserve to hold a new token (each trust line locks 0.2 XRP).',
    tecPATH_DRY: 'Not enough liquidity on this route.',
    tecNO_AUTH: 'This token requires issuer authorization.',
    tecFROZEN: 'This token is frozen by its issuer.',
    tecAMM_BALANCE: 'This would leave the pool with too little liquidity.',
    tecAMM_FAILED: 'The pool rejected this deposit/withdrawal (price moved or limits hit).',
    tecDUPLICATE: 'A pool for this pair already exists.',
    temDISABLED: 'This feature is not enabled on the network yet.',
    tecBATCH_FAILURE: 'Swap failed — nothing was traded and no service fee was charged. Try again or raise slippage.',
  }
  return map[code] ?? `Transaction failed: ${code}`
}

function WalletModal({
  available,
  onClose,
  onPick,
}: {
  available: Partial<Record<WalletId, boolean>>
  onClose: () => void
  onPick: (id: WalletId) => Promise<void>
}) {
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<WalletId | null>(null)
  const pick = async (id: WalletId) => {
    setErr(null)
    setBusy(id)
    try {
      await onPick(id)
    } catch (e: any) {
      setErr(e instanceof UserRejected ? 'Connection cancelled' : (e?.message ?? 'Failed to connect'))
    } finally {
      setBusy(null)
    }
  }
  const hint: Record<WalletId, string> = {
    xaman: 'Scan with the Xaman app',
    crossmark: 'Browser extension',
    gem: 'Browser extension',
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Connect wallet">
        <div className="modal-head">
          <h3>Connect wallet</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="wallet-list">
          {Object.values(ADAPTERS).map((a) => {
            const ok = available[a.id]
            return (
              <button key={a.id} className="wallet-row" disabled={ok === false || !!busy} onClick={() => pick(a.id)}>
                <span className={`wallet-dot w-${a.id}`} />
                <span className="wallet-name">{a.name}</span>
                <span className="muted small">
                  {busy === a.id ? 'Connecting…' : ok === false ? 'Not detected' : hint[a.id]}
                </span>
              </button>
            )
          })}
        </div>
        {err && <p className="error small">{err}</p>}
      </div>
    </div>
  )
}

function QrModal({ qrPng, deeplink, label, onClose }: { qrPng: string; deeplink: string; label: string; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal qr" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Sign in Xaman</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </div>
        <p className="muted small">Scan to sign this {label}.</p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrPng} alt="Xaman sign request QR" width={240} height={240} />
        <a className="btn ghost" href={deeplink} target="_blank" rel="noreferrer">
          Open Xaman
        </a>
      </div>
    </div>
  )
}

function Toasts({ toasts, onDismiss }: { toasts: TxToast[]; onDismiss: (id: number) => void }) {
  const text: Record<TxStatus, string> = {
    signing: 'Waiting for signature…',
    submitted: 'Submitted, confirming…',
    success: 'Confirmed',
    failed: 'Failed',
  }
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast t-${t.status}`}>
          <div className="toast-body">
            <strong>{t.label}</strong>
            <span>{t.message ?? text[t.status]}</span>
            {t.hash && (
              <a href={explorerTx(t.hash)} target="_blank" rel="noreferrer" className="small">
                View transaction ↗
              </a>
            )}
          </div>
          {(t.status === 'success' || t.status === 'failed') && (
            <button className="icon-btn" onClick={() => onDismiss(t.id)} aria-label="Dismiss">×</button>
          )}
        </div>
      ))}
    </div>
  )
}
