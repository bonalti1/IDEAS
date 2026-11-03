// Run one database backup now, with the same settings as the server (DATABASE_URL, SUPABASE_*, DATA_DIR).
// usage: node scripts/backup-db.mjs        (Render: a cron service or a one-off job can run this too)
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openStore } from '../server/store/index.mjs'
import { openFiles } from '../server/files/index.mjs'
import { makeBackup } from '../server/backup.mjs'

const DATA = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server', 'data')
const store = openStore({ dataDir: DATA })
const files = openFiles({ dataDir: DATA })
await store.init()
await files.init()
const rec = await makeBackup({ store, files, event: async () => {} }).run('manual')
console.log(`backed up ${rec.designs} designs, ${rec.jobs} jobs to ${rec.where}: ${rec.name} (${(rec.bytes / 1024).toFixed(0)} KB, ${rec.ms} ms)`)
await store.close()
