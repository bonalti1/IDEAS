// Round 8: malformed request bodies answer 400 with a plain line, never a 500 and never a crash; a 503 the
// code meant for the client keeps its words; the geocode caps the address.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fixtureEnv } from './server-env.mjs'

async function startServer(t) {
  const port = 9400 + Math.floor(Math.random() * 100)
  const base = `http://127.0.0.1:${port}`
  const proc = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, ...fixtureEnv, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'wk', DRAFTHOUSE_DRAFTERS: 'maria@drafthouse.test', DRAFTHOUSE_ADMINS: 'rolando@drafthouse.test', PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-fuzz-')) }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  proc.stdout.on('data', (c) => (out += c))
  proc.stderr.on('data', (c) => (out += c))
  t.after(() => proc.kill())
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(base + '/api/health')
      return { base, log: () => out, alive: () => proc.exitCode === null }
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error('server did not start:\n' + out)
}
const login = async (base, email) => (await (await fetch(base + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name: 'X' }) })).json()).token

test('88-odd malformed bodies: every route answers under 500 (a meant 503 keeps its words), and the process stays up', async (t) => {
  const { base, log, alive } = await startServer(t)
  const user = await login(base, 'fuzz@example.com')
  const maria = await login(base, 'maria@drafthouse.test')
  const rolando = await login(base, 'rolando@drafthouse.test')
  const heads = { user: { authorization: `Bearer ${user}` }, drafter: { authorization: `Bearer ${maria}` }, admin: { authorization: `Bearer ${rolando}` }, worker: { 'x-api-key': 'wk' }, app: {} }
  const routes = [
    ['POST', '/api/auth/dev-login', 'app'],
    ['POST', '/api/projects', 'user'],
    ['PUT', '/api/projects/prj_nope', 'user'],
    ['POST', '/api/projects/prj_nope/change', 'user'],
    ['POST', '/api/projects/prj_nope/rollback', 'user'],
    ['POST', '/api/projects/prj_nope/send', 'user'],
    ['PUT', '/api/admin/cities/mcallen', 'drafter'],
    ['POST', '/api/lot/plat', 'app'],
    ['POST', '/api/projects/prj_nope/meeting-request', 'user'],
    ['POST', '/api/review/prj_nope/allowance', 'drafter'],
    ['PUT', '/api/admin/allowance', 'drafter'],
    ['POST', '/api/review/prj_nope', 'drafter'],
    ['POST', '/api/review/prj_nope/lot', 'drafter'],
    ['POST', '/api/admin/users/u1/role', 'admin'],
    ['POST', '/api/designs', 'app'],
    ['POST', '/api/jobs/claim', 'worker'],
    ['POST', '/api/jobs/j1/progress', 'worker'],
    ['POST', '/api/jobs/j1/complete', 'worker'],
    ['POST', '/api/jobs/j1/fail', 'worker'],
    ['POST', '/api/workers/heartbeat', 'worker'],
    ['POST', '/api/workers/w1/commands', 'drafter'],
    ['POST', '/api/interpret', 'app'],
    ['POST', '/api/interpret/verdict', 'app'],
  ]
  const bodies = ['{bad json', 'null', '[]', '5', '"text"', '{"rooms":[null],"text":"x"}', '{"ifc":5,"design":{"contract":1}}', '{"__proto__":{"x":1}}', '{"text":5}', '{"version":"one"}', '{"pack":null}', '{"id":7}', '{"command":[1]}']
  const results = []
  for (const [method, route, who] of routes)
    for (const body of bodies) {
      const r = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...heads[who] }, body })
      const text = await r.text()
      results.push({ method, route, body, status: r.status, text: text.slice(0, 160) })
    }
  // the geocode: a long address, and a plain answer
  // round 10, item 9: the geocode route needs a signed-in user; the app key alone is a 401
  const anon = await fetch(base + '/api/lot/geocode?address=' + encodeURIComponent('1201 Kerria Ave, McAllen, TX'), { headers: heads.app })
  assert.equal(anon.status, 401, 'the geocode route is not open to the app key alone')
  const long = await fetch(base + '/api/lot/geocode?address=' + encodeURIComponent('x'.repeat(300)), { headers: heads.user })
  results.push({ method: 'GET', route: '/api/lot/geocode', body: '300 chars', status: long.status, text: (await long.text()).slice(0, 160) })
  const faults = results.filter((r) => r.status >= 500 && !(r.status === 503 && /payments are not set up|plat reader needs the office Claude key/.test(r.text)))
  assert.deepEqual(faults, [], `office faults from client input:\n${faults.map((f) => `${f.method} ${f.route} ${f.body} → ${f.status} ${f.text}`).join('\n')}`)
  assert.ok(results.length >= 88, `${results.length} cases`)
  assert.ok(alive(), 'the server is still up')
  assert.doesNotMatch(log(), /TypeError|Cannot read properties/, 'no TypeError in the log')
  // the plain lines
  const badJson = results.find((r) => r.route === '/api/projects' && r.body === '{bad json')
  assert.equal(badJson.status, 400)
  assert.match(badJson.text, /the request body is not JSON/)
  const nul = results.find((r) => r.route === '/api/projects' && r.body === 'null')
  assert.equal(nul.status, 400)
  assert.match(nul.text, /a JSON object is required/)
  const roomsNull = results.find((r) => r.route === '/api/interpret' && r.body === '{"rooms":[null],"text":"x"}')
  assert.equal(roomsNull.status, 400)
  assert.match(roomsNull.text, /rooms must be a list of rooms/)
  // a 503 that was meant for the client keeps its words (billing routes are gone while BILLING_ENABLED is off, round 8)
  const checkout = await fetch(base + '/api/billing/checkout', { method: 'POST', headers: { 'content-type': 'application/json', ...heads.user }, body: JSON.stringify({ pack: 'pack5' }) })
  assert.equal(checkout.status, 404)
  const plat = await fetch(base + '/api/lot/plat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x.pdf', data: Buffer.from('%PDF-1.4').toString('base64') }) })
  assert.equal(plat.status, 503)
  assert.match((await plat.json()).error, /the plat reader needs the office Claude key/)
  assert.equal(long.status, 400)
  assert.match(results[results.length - 1].text, /too long/)
})
