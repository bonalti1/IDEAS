// Office API smoke test: design in, job claimed, progress, files, complete, dashboard overview.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-'))
const port = 8790 + Math.floor(Math.random() * 100)
const base = `http://127.0.0.1:${port}`
let proc

test('office API end to end', async (t) => {
  proc = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, ANTHROPIC_API_KEY: '', PORT: String(port), DATA_DIR: dir }, stdio: 'ignore' })
  t.after(() => proc.kill())
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(base + '/api/health')
      break
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const h0 = await (await fetch(base + '/api/health')).json()
  assert.equal(h0.ok, false, 'no worker yet means not healthy')

  const hb = await (await post('/api/workers/heartbeat', { id: 'office-1', name: 'Office Revit', revit: '2024', pyrevit: '4.8', checks: [{ id: 'revit', name: 'Revit responds', ok: true, detail: 'smoke test 12s', at: new Date().toISOString() }] })).json()
  assert.ok(hb.ok)
  const h1 = await (await fetch(base + '/api/health')).json()
  assert.equal(h1.ok, true)

  const created = await (await post('/api/designs', { design: { contract: 1, client: 'Garza', lot: { address: 'Lot 514' }, style: { name: 'Modern Farmhouse' }, livingSf: 2533 }, ifc: 'ISO-10303-21;' })).json()
  assert.equal(created.job.status, 'queued')
  const claim = await post('/api/jobs/claim', { worker: 'office-1' })
  assert.equal(claim.status, 200)
  const job = await claim.json()
  assert.equal(job.status, 'running')
  const design = await (await fetch(base + job.designUrl)).json()
  assert.equal(design.client, 'Garza')
  await post(`/api/jobs/${job.id}/progress`, { step: 'walls', message: '116 walls', pct: 40 })
  const up = await fetch(base + `/api/jobs/${job.id}/files/model.rvt`, { method: 'PUT', body: Buffer.from('rvt bytes') })
  assert.equal((await up.json()).ok, true)
  await post(`/api/jobs/${job.id}/complete`, { outputs: [{ name: 'model.rvt', url: `/files/${job.designId}/model.rvt` }], log: 'ok' })
  const done = await (await fetch(base + `/api/jobs/${job.id}`)).json()
  assert.equal(done.status, 'done')
  const file = await fetch(base + `/files/${job.designId}/model.rvt`)
  assert.equal(await file.text(), 'rvt bytes')
  const ov = await (await fetch(base + '/api/admin/overview')).json()
  assert.equal(ov.counts.done, 1)
  assert.ok(ov.events.length >= 3)
  const none = await post('/api/jobs/claim', { worker: 'office-1' })
  assert.equal(none.status, 204)
  // no ANTHROPIC_API_KEY in the test environment → 503 so the app falls back
  const interp = await post('/api/interpret', { text: 'bigger kitchen', rooms: [], program: {}, kit: {} })
  assert.equal(interp.status, 503)
})
