// Import server/data/db.json (the old file store) or a backup (backups/db-*.json.gz) into Postgres.
// usage: DATABASE_URL=postgres://... node scripts/migrate-json-to-pg.mjs [server/data/db.json | backup.json.gz]
// Safe to run twice: rows are upserted by id. The interpret log is appended, so import it once.
import fs from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { postgresStore } from '../server/store/postgres.mjs'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required')
  process.exit(2)
}
const src = process.argv[2] || 'server/data/db.json'
let dump
if (src.endsWith('.gz')) dump = JSON.parse(gunzipSync(fs.readFileSync(src)).toString())
else {
  dump = JSON.parse(fs.readFileSync(src, 'utf8'))
  const logPath = path.join(path.dirname(src), 'interpret-log.jsonl')
  if (!dump.interpretLog && fs.existsSync(logPath)) dump.interpretLog = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
}
const store = postgresStore(url)
await store.init()
const n = await store.load(dump)
console.log(`imported ${n} rows from ${src}: ${dump.designs?.length || 0} designs, ${dump.jobs?.length || 0} jobs, ${dump.workers?.length || 0} workers, ${dump.events?.length || 0} events, ${dump.interpretLog?.length || 0} interpret log lines`)
console.log('files: copy server/data/files/<design>/* into the Supabase bucket with the same paths (Supabase Studio, Storage, upload folder) if the designs should keep their design.json and outputs')
await store.close()
