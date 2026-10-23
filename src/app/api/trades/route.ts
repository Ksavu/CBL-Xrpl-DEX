import { NextResponse, type NextRequest } from 'next/server'
import { isValidClassicAddress } from 'xrpl'
import { getTrades } from '@/lib/server/pools'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const pool = req.nextUrl.searchParams.get('pool') ?? ''
  if (!isValidClassicAddress(pool)) return NextResponse.json({ error: 'Invalid pool' }, { status: 400 })
  const trades = await getTrades(pool)
  if (trades === null) return NextResponse.json({ indexer: false, trades: [] })
  return NextResponse.json({ indexer: true, trades })
}
