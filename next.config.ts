import type { NextConfig } from 'next'

// Sites allowed to embed the DEX in an iframe (keep in sync with src/config.ts).
const frameAncestors =
  process.env.FRAME_ANCESTORS ??
  'https://cryptobarlounge.space https://*.cryptobarlounge.space https://cbl-crypto-hub.vercel.app'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // pg is only used server-side (API routes); keep it out of the client bundle.
  serverExternalPackages: ['pg'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Content-Security-Policy', value: `frame-ancestors 'self' ${frameAncestors}` }],
      },
    ]
  },
}

export default nextConfig
