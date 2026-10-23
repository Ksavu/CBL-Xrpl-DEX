# Putting the XRPL DEX on cryptobarlounge.space

The DEX runs as its own Vercel project on a subdomain (`xrpl.cryptobarlounge.space`). The CBL site then links to it or embeds it. This keeps the XRPL code, wallets and indexer separate from the CBL repo while looking like one product.

## 1. Deploy to Vercel

1. Push this folder to a new GitHub repo, then **Vercel → Add New Project → import it**.
2. Add these environment variables (Production):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_XRPL_NETWORK` | `mainnet` |
| `NEXT_PUBLIC_XAMAN_API_KEY` | your key from apps.xaman.dev |
| `NEXT_PUBLIC_FEE_ACCOUNT` | your XRP dev wallet (r…) |
| `NEXT_PUBLIC_FEE_BPS` | `50` (0.5%) |
| `NEXT_PUBLIC_FEE_MODE` | `batch` |
| `NEXT_PUBLIC_BRAND_NAME` | `CBL Swap` |
| `NEXT_PUBLIC_BRAND_LOGO` | `/brand/cbl.png` (add the logo file to `public/brand/`) |
| `NEXT_PUBLIC_THEME` | `cbl` |
| `DATABASE_URL` | Postgres URL (optional, for charts — e.g. Supabase/Neon) |

3. Deploy.

> The fee wallet must be an activated XRPL account (holding at least 1 XRP). Fees are always paid in XRP, so it never needs trust lines.

## 2. Subdomain (DNS stays at Hostinger)

1. Vercel project → **Settings → Domains → Add** `xrpl.cryptobarlounge.space`.
2. Hostinger → **DNS Zone** for cryptobarlounge.space → add a record:
   - Type `CNAME`, Name `xrpl`, Target `cname.vercel-dns.com`, TTL default
3. Wait for Vercel to show the domain as valid. HTTPS is issued automatically.
4. In the Xaman developer console, add `https://xrpl.cryptobarlounge.space` to the app's **redirect URIs / origins**.

## 3. Add it to the CBL site

**Option A — menu link (simplest, best for mobile wallets):** add an "XRPL Swap" item to the CBL nav pointing to `https://xrpl.cryptobarlounge.space`.

**Option B — embedded inside the CBL dashboard:** add a page to the CBL app, e.g. `app/xrpl/page.tsx`:

```tsx
export default function XrplSwapPage() {
  return (
    <iframe
      src="https://xrpl.cryptobarlounge.space"
      title="CBL Swap — XRPL"
      style={{ width: '100%', minHeight: '90vh', border: 0, borderRadius: 16 }}
      allow="clipboard-write"
    />
  )
}
```

When embedded, the DEX hides its own logo and shows a compact bar automatically. Embedding is already allowed for `cryptobarlounge.space` and `cbl-crypto-hub.vercel.app` (`FRAME_ANCESTORS`).

Deep links work in both options:
- Swap a specific token: `/token/<CURRENCY>.<rIssuer>`
- Pool page: `/pool/XRP/<CURRENCY>.<rIssuer>`

The token page is a natural target for CBL's promoted XRPL projects and for the scanner bot's results.

> **Mobile + Xaman inside an iframe:** desktop QR signing works embedded. On mobile, the Xaman deeplink opens the app, and some mobile browsers block that from inside iframes. Option A avoids this. You can also link mobile users out to the subdomain.

## How the fee works

- **XRP → token:** the fee % is taken from the XRP the user enters, and the rest is swapped.
- **Token → XRP:** the fee % is taken from the guaranteed minimum XRP received.
- **Token → token:** the fee % of the input's XRP value is paid from the user's XRP balance. It's skipped if they don't have enough.
- **`batch` mode:** swap and fee go in one XLS-56 Batch transaction (all-or-nothing, one signature). If the swap fails, nothing is charged. If the wallet or network rejects Batch, the app switches to `separate` mode for that browser: the swap first, then a second fee payment.

On XRPL the fee can't be hidden. The user's wallet shows the Payment to your fee wallet when they sign. The swap card lists it as "Service fee".
