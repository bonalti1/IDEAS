// Nightly database backup: a gzip JSON dump of every table, kept in the file store under
// backups/ (Supabase Storage in production, DATA_DIR/files/backups locally). Keeps the last
// BACKUP_KEEP (default 30). Runs at BACKUP_HOUR_UTC (default 08:00 UTC, 2 am Texas) and on demand.
// Restore with: node scripts/migrate-json-to-pg.mjs <backup.json.gz>
import { gzipSync } from 'node:zlib'

export function makeBackup({ env = process.env, store, files, event, log = console.log }) {
  const HOUR = +(env.BACKUP_HOUR_UTC ?? 8)
  const KEEP = +(env.BACKUP_KEEP || 30)
  const enabled = env.BACKUP_DISABLED !== '1'

  async function run(reason = 'scheduled') {
    const t0 = Date.now()
    const dump = await store.dump()
    const buf = gzipSync(Buffer.from(JSON.stringify(dump)))
    const name = `backups/db-${dump.at.replace(/[:]/g, '-').slice(0, 19)}.json.gz`
    await files.putRaw(name, buf, 'application/gzip')
    const all = await files.listRaw('backups')
    for (const old of all.slice(0, Math.max(0, all.length - KEEP))) await files.deleteRaw(old)
    const rec = { at: dump.at, name, bytes: buf.length, ms: Date.now() - t0, designs: dump.designs.length, jobs: dump.jobs.length, where: files.kind, reason }
    await store.meta.set('lastBackup', rec)
    await event('backup', `database backed up to ${files.kind} (${(buf.length / 1024).toFixed(0)} KB, ${dump.designs.length} designs, ${dump.jobs.length} jobs)`)
    return rec
  }

  let timer = null
  function schedule() {
    if (!enabled) return
    const now = new Date()
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), HOUR, 0, 0))
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1)
    timer = setTimeout(async () => {
      try {
        await run()
      } catch (e) {
        log(`backup failed: ${e.message}`)
        await event('error', `backup failed: ${e.message}`)
      }
      schedule()
    }, next - now)
    timer.unref?.()
  }

  return {
    run,
    start: schedule,
    stop() {
      clearTimeout(timer)
    },
    async describe() {
      const last = await store.meta.get('lastBackup')
      if (!enabled) return { ok: false, detail: 'disabled (BACKUP_DISABLED=1)' }
      const ageH = last ? (Date.now() - Date.parse(last.at)) / 3600000 : null
      return { ok: !!last && ageH < 26, detail: last ? `last ${last.at.slice(0, 16)} UTC, ${(last.bytes / 1024).toFixed(0)} KB to ${last.where}; nightly at ${String(HOUR).padStart(2, '0')}:00 UTC` : `none yet; nightly at ${String(HOUR).padStart(2, '0')}:00 UTC` }
    },
  }
}
