'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BRAND_LOGO, BRAND_NAME } from '@/config'
import { useWallet } from '@/lib/wallet/context'
import { shortAddr } from '@/lib/xrpl/assets'
import { LedgerTicker } from './LedgerTicker'

export function Header() {
  const path = usePathname()
  const { account, openWalletModal, disconnect } = useWallet()
  // Inside an iframe (e.g. embedded on cryptobarlounge.space) the host site
  // already has its own nav and logo, so show a compact bar.
  const [embedded, setEmbedded] = useState(false)
  useEffect(() => {
    try {
      setEmbedded(window.self !== window.top)
    } catch {
      setEmbedded(true)
    }
  }, [])

  const nav = [
    { href: '/', label: 'Swap', active: path === '/' },
    { href: '/pools', label: 'Pools', active: path.startsWith('/pool') },
  ]
  return (
    <header className={`header${embedded ? ' embedded' : ''}`}>
      {!embedded && (
        <Link href="/" className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {BRAND_LOGO && <img src={BRAND_LOGO} alt="" width={28} height={28} />}
          <span>{BRAND_NAME}</span>
        </Link>
      )}
      <nav className="nav">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} className={n.active ? 'active' : ''}>
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="header-right">
        <LedgerTicker />
        {account ? (
          <button className="btn ghost sm" onClick={disconnect} title="Disconnect">
            {shortAddr(account)}
          </button>
        ) : (
          <button className="btn sm" onClick={openWalletModal}>
            Connect
          </button>
        )}
      </div>
    </header>
  )
}
