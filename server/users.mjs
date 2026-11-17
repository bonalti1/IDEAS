// Who is calling. Two modes:
//  - Supabase (SUPABASE_URL set): the app signs in with a magic link through Supabase Auth and
//    sends the access token as "Authorization: Bearer". Verified here with SUPABASE_JWT_SECRET
//    (HS256) when set, otherwise with the project's public keys (JWKS, RS256/ES256), cached.
//  - Local (no SUPABASE_URL): POST /api/auth/dev-login {email} hands out a signed token so the
//    app, the tests and the screenshots work on a laptop. Never on in production.
// Roles: client (default), drafter, admin. DRAFTHOUSE_DRAFTERS lists drafter emails; the users
// table keeps the role after that, so an admin can also change it through the API.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const b64u = (buf) => Buffer.from(buf).toString('base64url')
const fromB64u = (s) => Buffer.from(s, 'base64url')

export function makeUsers({ env = process.env, store, dataDir, log = console.log }) {
  const supabaseUrl = (env.SUPABASE_URL || '').trim().replace(/\/$/, '')
  const devMode = !supabaseUrl
  const jwtSecret = (env.SUPABASE_JWT_SECRET || '').trim()
  const drafters = new Set(
    (env.DRAFTHOUSE_DRAFTERS || (devMode ? 'drafter@drafthouse.local' : ''))
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  )
  const admins = new Set((env.DRAFTHOUSE_ADMINS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
  const FREE = +(env.FREE_CREDITS_PER_ACCOUNT ?? env.CREDITS_PER_PROJECT ?? 10) // credits a new account starts with; 0 once houses are paid

  // local-mode signing secret, kept in DATA_DIR so tokens survive a restart
  let devSecret = ''
  if (devMode) {
    const f = path.join(dataDir, 'dev-secret')
    try {
      devSecret = fs.readFileSync(f, 'utf8').trim()
    } catch {
      devSecret = crypto.randomBytes(32).toString('hex')
      fs.mkdirSync(dataDir, { recursive: true })
      fs.writeFileSync(f, devSecret)
    }
  }
  const devSign = (payload) => {
    const body = b64u(JSON.stringify(payload))
    return `dh1.${body}.${b64u(crypto.createHmac('sha256', devSecret).update(body).digest())}`
  }
  const devVerify = (token) => {
    const [tag, body, sig] = token.split('.')
    if (tag !== 'dh1' || !body || !sig) return null
    const want = b64u(crypto.createHmac('sha256', devSecret).update(body).digest())
    if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null
    const claims = JSON.parse(fromB64u(body).toString())
    if (claims.exp && claims.exp < Date.now() / 1000) return null
    return claims
  }

  // Supabase JWT: HS256 with the project secret, or RS256/ES256 with the published keys
  let jwks = { at: 0, keys: [] }
  async function publicKey(kid) {
    if (Date.now() - jwks.at > 600000 || !jwks.keys.length) {
      const r = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`, { signal: AbortSignal.timeout(8000) })
      if (!r.ok) throw new Error(`jwks ${r.status}`)
      jwks = { at: Date.now(), keys: (await r.json()).keys || [] }
    }
    const jwk = jwks.keys.find((k) => k.kid === kid) || jwks.keys[0]
    return jwk ? crypto.createPublicKey({ key: jwk, format: 'jwk' }) : null
  }
  async function supabaseVerify(token) {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const header = JSON.parse(fromB64u(parts[0]).toString())
    const data = Buffer.from(`${parts[0]}.${parts[1]}`)
    const sig = fromB64u(parts[2])
    let ok = false
    if (header.alg === 'HS256') {
      if (!jwtSecret) return null
      const want = crypto.createHmac('sha256', jwtSecret).update(data).digest()
      ok = want.length === sig.length && crypto.timingSafeEqual(want, sig)
    } else if (header.alg === 'RS256' || header.alg === 'ES256') {
      const key = await publicKey(header.kid)
      if (!key) return null
      ok = crypto.verify('sha256', data, header.alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key, sig)
    }
    if (!ok) return null
    const claims = JSON.parse(fromB64u(parts[1]).toString())
    if (claims.exp && claims.exp < Date.now() / 1000) return null
    if (claims.aud && claims.aud !== 'authenticated' && !(Array.isArray(claims.aud) && claims.aud.includes('authenticated'))) return null
    return claims
  }

  const roleFor = (email, existing) => (admins.has(email) ? 'admin' : existing === 'admin' ? 'admin' : drafters.has(email) || existing === 'drafter' ? 'drafter' : 'client')

  // claims → user row, created on first sight
  async function resolve(claims) {
    const email = String(claims.email || '').toLowerCase()
    if (!email) return null
    const id = devMode ? 'usr_' + crypto.createHash('sha256').update(email).digest('hex').slice(0, 16) : claims.sub
    const now = new Date().toISOString()
    let u = await store.users.get(id)
    if (!u) {
      u = { id, email, role: roleFor(email), name: claims.name || claims.user_metadata?.name || '', credits: FREE, createdAt: now, lastSeen: now }
      await store.users.put(u)
      return u
    }
    const role = roleFor(email, u.role)
    if (role !== u.role || Date.now() - Date.parse(u.lastSeen) > 60000) {
      u.role = role
      u.lastSeen = now
      await store.users.put(u)
    }
    return u
  }

  return {
    devMode,
    freeCredits: FREE,
    isDrafter: (u) => !!u && (u.role === 'drafter' || u.role === 'admin'),
    // local sign-in: anyone with an email, no password; drafters by the DRAFTHOUSE_DRAFTERS list
    async devLogin({ email, name }) {
      if (!devMode) throw new Error('local sign-in is off when Supabase is configured')
      const e = String(email || '').trim().toLowerCase()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('a valid email is required')
      const token = devSign({ email: e, name: String(name || '').trim(), exp: Math.floor(Date.now() / 1000) + 30 * 86400 })
      const user = await resolve({ email: e, name })
      return { token, user }
    },
    async fromToken(token) {
      if (!token) return null
      try {
        const claims = devMode ? devVerify(token) : token.startsWith('dh1.') ? null : await supabaseVerify(token)
        return claims ? await resolve(claims) : null
      } catch (e) {
        log(`token check failed: ${e.message}`)
        return null
      }
    },
    fromRequest(req) {
      const a = req.headers.authorization || ''
      return this.fromToken(/^bearer /i.test(a) ? a.slice(7).trim() : '')
    },
    describe: () => ({ ok: !devMode, detail: devMode ? `local sign-in (no Supabase); drafters: ${[...drafters].join(', ') || 'none'}` : `Supabase Auth at ${new URL(supabaseUrl).host}, ${jwtSecret ? 'HS256 secret' : 'public keys'}; drafters: ${[...drafters].join(', ') || 'from the users table'}` }),
  }
}
