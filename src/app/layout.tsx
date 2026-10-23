import type { Metadata, Viewport } from 'next'
import { Header } from '@/components/Header'
import { BRAND_NAME, THEME } from '@/config'
import { WalletProvider } from '@/lib/wallet/context'
import './globals.css'

export const metadata: Metadata = {
  title: `${BRAND_NAME} — swap on the XRP Ledger`,
  description: 'Swap tokens and provide liquidity on native XRPL AMM pools.',
}

export const viewport: Viewport = { themeColor: THEME === 'cbl' ? '#0c1222' : '#1a1d24' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme={THEME}>
      <body>
        <WalletProvider>
          <div className="shell">
            <Header />
            <main>{children}</main>
          </div>
        </WalletProvider>
      </body>
    </html>
  )
}
