import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const db = new Pool({ connectionString: url })
const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
db.query(sql)
  .then(() => console.log('Schema applied'))
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.end())
