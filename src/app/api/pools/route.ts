import { NextResponse } from 'next/server'
import { listPools } from '@/lib/server/pools'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const data = await listPools()
    return NextResponse.json(data, { headers: { 'Cache-Control': 's-maxage=15, stale-while-revalidate=60' } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to load pools' }, { status: 502 })
  }
}
