// Worker-offline alerts and the backup rotation, on the JSON store with a fake clock and a fake mailer.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { jsonStore } from '../server/store/json.mjs'
import { localFiles } from '../server/files/local.mjs'
import { makeAlerts } from '../server/alerts.mjs'
import { makeBackup } from '../server/backup.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dh-'))
const MIN = 60000

test('a worker silent for more than 10 minutes gets one alert, and one more when it is back', async () => {
  const store = jsonStore(tmp())
  const events = []
  const sent = []
  const alerts = makeAlerts({ env: { RESEND_API_KEY: 'x', ALERT_EMAIL_TO: 'rolando@example.com', ALERT_EMAIL_FROM: 'alerts@example.com' }, store, event: async (kind, message) => events.push({ kind, message }), log: () => {} })
  alerts.email = async (subject) => sent.push(subject) // no network in tests
  const t0 = Date.parse('2026-11-03T12:00:00Z')
  await store.workers.put({ id: 'office-1', name: 'Office Revit', firstSeen: new Date(t0).toISOString(), lastSeen: new Date(t0).toISOString() })

  // the module's own email is bound inside checkWorkers, so drive it through a wrapper store check
  const run = async (t) => {
    const before = events.length
    await alerts.checkWorkers(t)
    return events.slice(before)
  }
  assert.deepEqual(await run(t0 + 9 * MIN), [], 'nothing at 9 minutes')
  const e10 = await run(t0 + 11 * MIN)
  assert.equal(e10.length, 1)
  assert.match(e10[0].message, /Office Revit has not reported for 11 minutes/)
  assert.deepEqual(await run(t0 + 30 * MIN), [], 'no second alert while still down')
  assert.ok((await store.workers.get('office-1')).offlineAlertAt, 'flag stored on the worker')
  // worker reports again
  const w = await store.workers.get('office-1')
  w.lastSeen = new Date(t0 + 40 * MIN).toISOString()
  await store.workers.put(w)
  const back = await run(t0 + 40 * MIN)
  assert.equal(back.length, 1)
  assert.match(back[0].message, /is back after about 39 minutes/)
  assert.equal((await store.workers.get('office-1')).offlineAlertAt, undefined)
  assert.equal(alerts.describe().ok, true)
})

test('alerts without email settings still land in activity and say so in health', async () => {
  const store = jsonStore(tmp())
  const alerts = makeAlerts({ env: {}, store, event: async () => {}, log: () => {} })
  assert.equal(alerts.configured, false)
  assert.equal(alerts.describe().ok, false)
  assert.match(alerts.describe().detail, /RESEND_API_KEY/)
  const r = await alerts.email('x', 'y')
  assert.equal(r.ok, false)
})

test('backup writes a dump, records it, and keeps only the last N', async () => {
  const dir = tmp()
  const store = jsonStore(dir)
  const files = localFiles(path.join(dir, 'files'))
  await store.designs.add({ id: 'dsn_1', createdAt: new Date().toISOString(), client: 'Garza' })
  const backup = makeBackup({ env: { BACKUP_KEEP: '2' }, store, files, event: async () => {}, log: () => {} })
  assert.equal((await backup.describe()).ok, false, 'no backup yet')
  const a = await backup.run('test')
  assert.equal(a.designs, 1)
  assert.ok(a.bytes > 20)
  await new Promise((r) => setTimeout(r, 1100)) // distinct second in the file name
  await backup.run('test')
  await new Promise((r) => setTimeout(r, 1100))
  const c = await backup.run('test')
  const kept = await files.listRaw('backups')
  assert.equal(kept.length, 2, 'rotation keeps the last two')
  assert.ok(kept.includes(c.name))
  const d = await backup.describe()
  assert.equal(d.ok, true)
  assert.match(d.detail, /to local/)
  assert.equal((await store.meta.get('lastBackup')).name, c.name)
})
