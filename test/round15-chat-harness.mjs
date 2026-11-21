// Round 15, the chat: the office API over HTTP in both chat modes, shared by the round15-chat test files. Not a test
// file itself. `office` has no Claude key (the basic rules answer); `officeClaude` has a key and talks to a stand-in
// for api.anthropic.com on this machine (nothing leaves it), which answers with `answer(request, rooms, input)`.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fixtureEnv } from './server-env.mjs'
import { asPrompted } from './round13-requests.mjs'

async function freePort() {
  const s = net.createServer()
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  const { port } = s.address()
  await new Promise((r) => s.close(r))
  return port
}

/** The stand-in model: every request it is sent is kept in `calls`. */
export async function fakeClaude(answer = asPrompted) {
  const calls = []
  let fn = answer
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(body))
      }
      if (req.method === 'GET' && req.url.startsWith('/v1/models/')) return send(200, { type: 'model', id: decodeURIComponent(req.url.split('/').pop()), display_name: 'stand-in', created_at: '2026-01-01T00:00:00Z' })
      if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
        const body = JSON.parse(raw)
        const input = JSON.parse(body.messages[0].content)
        calls.push({ input, system: body.system })
        return send(200, { id: 'msg_standin', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(fn(input.request, input.rooms, input)) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 900, output_tokens: 60 } })
      }
      send(404, { type: 'error', error: { type: 'not_found_error', message: 'not here' } })
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${server.address().port}`, calls, stop: () => new Promise((r) => server.close(r)), answerWith: (f) => (fn = f || answer) }
}

/** One office on a free port, signed in as a homeowner; `drafter()` signs a drafter in on the same office. */
export async function startOffice(env = {}) {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const proc = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, ...fixtureEnv, DRAFTHOUSE_CLAUDE_KEY: '', ANTHROPIC_API_KEY: '', ANTHROPIC_BASE_URL: '', NODE_USE_ENV_PROXY: '', NO_PROXY: '127.0.0.1,localhost', DATABASE_URL: '', SUPABASE_URL: '', RESEND_API_KEY: '', DRAFTHOUSE_APP_KEY: '', DRAFTHOUSE_WORKER_KEY: 'test-worker-key', DRAFTHOUSE_DRAFTERS: 'drafter@drafthouse.test', PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dh-r15-')), ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  proc.stdout.on('data', (c) => (out += c))
  proc.stderr.on('data', (c) => (out += c))
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(base + '/api/health')
      break
    } catch {
      if (i === 99) throw new Error('the office did not start:\n' + out)
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  const signIn = async (email, name) => {
    const login = await (await fetch(base + '/api/auth/dev-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, name }) })).json()
    const h = { 'content-type': 'application/json', authorization: `Bearer ${login.token}` }
    const raw = (method, p, body) =>
      new Promise((resolve, reject) => {
        const req = http.request(base + p, { method, headers: h, agent: false }, (res) => {
          let text = ''
          res.on('data', (c) => (text += c))
          res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : {} }))
        })
        req.on('error', reject)
        if (body !== undefined) req.write(JSON.stringify(body))
        req.end()
      })
    const call = async (method, p, body) => {
      const r = await raw(method, p, body)
      assert.ok(r.status < 300, `${method} ${p} → ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`)
      return r.body
    }
    return { raw, call }
  }
  const owner = await signIn('homeowner@example.com', 'Test Homeowner')
  return {
    base,
    log: () => out,
    stop: () => proc.kill(),
    /** A new saved plan on a lot; its id. */
    start: async (plan) => (await owner.call('POST', '/api/projects', { style: { id: 'farmhouse', name: 'Modern Farmhouse' }, program: plan.program, rooms: plan.rooms, client: 'Test Homeowner', lot: { address: 'test lot', spec: plan.lot.spec } })).id,
    /** One chat message (or a tapped button, with its ops), the way the app posts it. */
    change: (id, text, { ops, lang } = {}) => owner.call('POST', `/api/projects/${id}/change`, { text, ...(ops ? { ops } : {}), ...(lang ? { lang } : {}) }),
    detail: (id) => owner.call('GET', `/api/projects/${id}`),
    rollback: (id, version) => owner.call('POST', `/api/projects/${id}/rollback`, { version }),
    drafter: () => signIn('drafter@drafthouse.test', 'Test Drafter'),
  }
}
