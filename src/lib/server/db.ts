import 'server-only'
import { Pool } from 'pg'

let pool: Pool | null | undefined

/** Shared Postgres pool, or null when DATABASE_URL is not configured. */
export function getDb(): Pool | null {
  if (pool !== undefined) return pool
  const url = process.env.DATABASE_URL
  pool = url ? new Pool({ connectionString: url, max: 5 }) : null
  return pool
}
