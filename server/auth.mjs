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
    const a = req.headers.authorization || ''
    if (/^bearer /i.test(a)) return a.slice(7).trim()
    return url.searchParams.get('key') || ''
  }
  // 'app' | 'worker' | null; 'open' when no keys are configured
  const role = (req, url) => {
    if (!enforced) return 'open'
    const k = keyOf(req, url)
    if (workerKey && same(k, workerKey)) return 'worker'
    if (appKey && same(k, appKey)) return 'app'
    return null
  }
  // need: 'public' | 'any' | 'app' | 'worker'
  const allows = (need, r) => need === 'public' || r === 'open' || (need === 'any' ? !!r : r === need)

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
