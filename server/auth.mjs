// API keys and CORS.
// Two keys: DRAFTHOUSE_APP_KEY for the client app and dashboard, DRAFTHOUSE_WORKER_KEY for the
// office Revit worker. With neither set the API is open (local work only) and health says so.
// The key travels in x-api-key, in "Authorization: Bearer", or as ?key= for file links opened in a tab.
import crypto from 'node:crypto'

const same = (a, b) => {
  if (!a || !b) return false
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

export function makeAuth(env = process.env) {
  const appKey = (env.DRAFTHOUSE_APP_KEY || '').trim()
  const workerKey = (env.DRAFTHOUSE_WORKER_KEY || '').trim()
  const enforced = !!(appKey || workerKey)
  const origins = (env.DRAFTHOUSE_APP_ORIGIN || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean)

  const keyOf = (req, url) => {
    const h = req.headers['x-api-key']
    if (h) return String(h).trim()
    const q = url.searchParams.get('key')
    if (q) return q
    const a = req.headers.authorization || '' // normally the user's sign-in token; a key here still works for scripts
    return /^bearer /i.test(a) ? a.slice(7).trim() : ''
  }
  // 'worker' | 'app' | 'open' (no app key configured, so app routes are open) | null (a key was needed and none or a wrong one came)
  const role = (req, url) => {
    const k = keyOf(req, url)
    if (workerKey && same(k, workerKey)) return 'worker'
    if (appKey && same(k, appKey)) return 'app'
    return appKey ? null : 'open'
  }
  // need: 'public' | 'any' | 'app' | 'worker'. Each key gates only its own routes: with no worker key the worker routes are open too.
  const allows = (need, r) => {
    if (need === 'public') return true
    const app = r === 'app' || r === 'open'
    const worker = r === 'worker' || (!workerKey && app)
    return need === 'app' ? app : need === 'worker' ? worker : app || worker
  }

  const cors = (req) => {
    const origin = req.headers.origin
    const h = { 'access-control-allow-headers': 'content-type, x-api-key, authorization', 'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS', vary: 'origin' }
    if (!origins.length) h['access-control-allow-origin'] = '*'
    else if (origin && origins.includes(origin.replace(/\/$/, ''))) h['access-control-allow-origin'] = origin
    return h
  }

  return {
    enforced,
    origins,
    role,
    allows,
    cors,
    describe: () => ({
      ok: enforced,
      detail: enforced ? `${appKey ? 'app key' : 'no app key'}, ${workerKey ? 'worker key' : 'no worker key'}; CORS ${origins.length ? origins.join(', ') : 'open to any site'}` : 'open: no DRAFTHOUSE_APP_KEY or DRAFTHOUSE_WORKER_KEY set (local only)',
    }),
  }
}
