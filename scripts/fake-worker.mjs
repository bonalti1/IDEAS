// Pretend office computer for demos and dashboard work: heartbeats like the
// real worker and "builds" jobs in a few seconds without Revit.
// usage: node scripts/fake-worker.mjs [api]
const API = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '')
const id = 'office-demo'
const post = (p, body) => fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const now = () => new Date().toISOString()
let smokeAt = now()
async function heartbeat(current = null) {
  const r = await post('/api/workers/heartbeat', {
    id, name: 'Office Revit (demo)', host: 'OFFICE-PC', revit: '2024', pyrevit: '4.8.16', template: 'STB Residential.rte', families: 212, disk: '412 GB free', version: '0.1.0', current,
    checks: [
      { id: 'revit-exe', name: 'Revit 2024 installed', ok: true, detail: 'C:\\Program Files\\Autodesk\\Revit 2024\\Revit.exe', at: now() },
      { id: 'pyrevit', name: 'pyRevit CLI', ok: true, detail: 'v4.8.16', at: now() },
      { id: 'template', name: 'Office template', ok: true, detail: 'STB Residential.rte', at: now() },
      { id: 'families', name: 'Family library', ok: true, detail: '212 families', at: now() },
      { id: 'disk', name: 'Disk space', ok: true, detail: '412 GB free', at: now() },
      { id: 'revit-smoke', name: 'Revit responds', ok: true, detail: `launched in 14s at ${smokeAt.slice(11, 19)}`, at: now() },
    ],
  })
  const body = await r.json()
  for (const c of body.commands || []) {
    console.log('command', c)
    if (c === 'smoke') smokeAt = now()
  }
}
async function loop() {
  await heartbeat()
  const r = await post('/api/jobs/claim', { worker: id })
  if (r.status === 200) {
    const job = await r.json()
    console.log('building', job.id, job.client)
    await heartbeat(job.id)
    const steps = [['walls', '116 walls placed', 20], ['doors', '20 doors, 14 windows', 40], ['rooms', '26 rooms, slab', 55], ['roof', '14 roof masses', 70], ['sheets', '9 sheets, 2 schedules', 85], ['export', 'PDF and IFC written', 95]]
    for (const [step, message, pct] of steps) {
      await post(`/api/jobs/${job.id}/progress`, { step, message, pct })
      await new Promise((res) => setTimeout(res, 700))
    }
    const design = await (await fetch(API + job.designUrl)).json()
    const report = { ok: true, counts: { walls: design.walls?.length, doors: design.doors?.length, windows: design.windows?.length, rooms: design.rooms?.length }, warnings: ['type "Sliding-Barn : 30" x 96"" not in template, using Single-Flush'] }
    await fetch(API + `/api/jobs/${job.id}/files/report.json`, { method: 'PUT', body: JSON.stringify(report, null, 2) })
    await fetch(API + `/api/jobs/${job.id}/files/model.rvt`, { method: 'PUT', body: 'demo' })
    await post(`/api/jobs/${job.id}/complete`, { outputs: [{ name: 'model.rvt', url: `/files/${job.designId}/model.rvt` }, { name: 'report.json', url: `/files/${job.designId}/report.json` }], warnings: report.warnings, log: 'DH_PROGRESS 100 done ok' })
    console.log('done', job.id)
    await heartbeat()
  }
}
console.log('demo worker →', API)
setInterval(() => loop().catch((e) => console.log('err', e.message)), 4000)
loop()
