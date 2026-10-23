import { type Asset, assetId, assetLabel, isXrp } from '@/lib/xrpl/assets'

const PALETTE = ['#9aa7ff', '#3ddc97', '#f5b94a', '#ff9fb8', '#7fd1e6', '#c6a2ff', '#ffd27a', '#8ee3c3']

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function AssetIcon({ asset, size }: { asset: Asset; size?: number }) {
  const label = assetLabel(asset)
  const style: React.CSSProperties = isXrp(asset)
    ? { background: '#e8eaf0', color: '#1a1d24' }
    : { background: PALETTE[hash(assetId(asset)) % PALETTE.length] }
  if (size) Object.assign(style, { width: size, height: size, fontSize: Math.round(size * 0.36) })
  return (
    <span className="asset-icon" style={style} aria-hidden>
      {label.slice(0, isXrp(asset) ? 3 : 2).toUpperCase()}
    </span>
  )
}
