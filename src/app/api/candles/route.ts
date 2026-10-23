import { NextResponse, type NextRequest } from 'next/server'
import { isValidClassicAddress } from 'xrpl'
import { getCandles } from '@/lib/server/pools'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const pool = req.nextUrl.searchParams.get('pool') ?? ''
  const tf = req.nextUrl.searchParams.get('tf') ?? '15m'
  if (!isValidClassicAddress(pool)) return NextResponse.json({ error: 'Invalid pool' }, { status: 400 })
  const candles = await getCandles(pool, tf)
  if (candles === null) return NextResponse.json({ indexer: false, candles: [] })
  return NextResponse.json({ indexer: true, candles })
}
