// Pretend office computer for demos and dashboard work: heartbeats like the
// real worker and completes jobs in a few seconds WITHOUT building anything.
// Every output it posts is labelled demo; it never uploads a model.
// usage: node scripts/fake-worker.mjs [api]
const API = (process.argv[2] || 'http://localhost:8787').replace(/\/$/, '')
const id = 'office-demo'
const KEY = process.env.DRAFTHOUSE_WORKER_KEY || ''
const H = KEY ? { 'x-api-key': KEY } : {}
const post = (p, body) => fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json', ...H }, body: JSON.stringify(body) })
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
    // a demo: it reads the design and reports what the real worker would place; it builds no model
    const design = await (await fetch(API + job.designUrl, { headers: H })).json()
    const counts = { walls: design.walls?.length || 0, doors: design.doors?.length || 0, windows: design.windows?.length || 0, rooms: design.rooms?.length || 0, roofMasses: design.roof?.masses?.length || 0 }
    const steps = [['read', `demo: design.json read, ${counts.rooms} rooms`, 30], ['count', `demo: ${counts.walls} walls, ${counts.doors} doors, ${counts.windows} windows to place`, 60], ['report', 'demo: no Revit here, nothing was built', 90]]
    for (const [step, message, pct] of steps) {
      await post(`/api/jobs/${job.id}/progress`, { step, message, pct })
      await new Promise((res) => setTimeout(res, 700))
    }
    const report = { ok: true, demo: true, note: 'Demo worker: no Revit model was built. The counts are what the office worker would place.', counts, warnings: ['demo worker: no model.rvt, no sheets, no schedules'] }
    await fetch(API + `/api/jobs/${job.id}/files/demo-report.json`, { method: 'PUT', headers: H, body: JSON.stringify(report, null, 2) })
    await post(`/api/jobs/${job.id}/complete`, { outputs: [{ name: 'demo-report.json (no model)', url: `/files/${job.designId}/demo-report.json` }], warnings: report.warnings, log: 'DH_PROGRESS 100 demo done (no model built)' })
    console.log('done', job.id)
    await heartbeat()
  }
}
console.log('demo worker →', API)
setInterval(() => loop().catch((e) => console.log('err', e.message)), 4000)
loop()
