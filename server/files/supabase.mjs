// Files in Supabase Storage (one private bucket) through its REST API, no SDK.
// Needs SUPABASE_URL and SUPABASE_SERVICE_KEY (the service role key, server-side only).
const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_')

export function supabaseFiles({ url, serviceKey, bucket = 'drafthouse' }) {
  const base = url.replace(/\/$/, '') + '/storage/v1'
  const headers = { authorization: `Bearer ${serviceKey}`, apikey: serviceKey }
  const call = (method, p, body, extra = {}, timeoutMs = 30000) => fetch(base + p, { method, headers: { ...headers, ...extra }, body, signal: AbortSignal.timeout(timeoutMs) })
  const list = async (prefix, limit = 1000) => {
    const r = await call('POST', `/object/list/${bucket}`, JSON.stringify({ prefix, limit, offset: 0, sortBy: { column: 'name', order: 'asc' } }), { 'content-type': 'application/json' })
    if (!r.ok) throw new Error(`storage list ${r.status}: ${(await r.text()).slice(0, 200)}`)
    return r.json()
  }
  return {
    kind: 'supabase',
    detail: `${new URL(url).host}/${bucket}`,
    async init() {
      const r = await call('POST', '/bucket', JSON.stringify({ id: bucket, name: bucket, public: false }), { 'content-type': 'application/json' })
      if (!r.ok && r.status !== 409 && !/already exists/i.test(await r.text())) throw new Error(`could not create bucket ${bucket} (${r.status})`)
    },
    async ping() {
      try {
        const n = (await list('', 1000)).filter((o) => o.id == null).length // folders = designs
        return { ok: true, detail: `${this.detail}, ${n} design folders` }
      } catch (e) {
        return { ok: false, detail: `${this.detail}: ${e.message}` }
      }
    },
    async put(design, name, body, type = 'application/octet-stream') {
      const p = `${safe(design)}/${safe(name)}`
      const r = await call('POST', `/object/${bucket}/${p}`, body, { 'content-type': type, 'x-upsert': 'true' }, 120000)
      if (!r.ok) throw new Error(`storage upload ${r.status}: ${(await r.text()).slice(0, 200)}`)
      return `/files/${p}`
    },
    async get(design, name) {
      const r = await call('GET', `/object/${bucket}/${safe(design)}/${safe(name)}`, undefined, {}, 120000)
      if (r.status === 404 || r.status === 400) return null
      if (!r.ok) throw new Error(`storage download ${r.status}`)
      return { body: r.body, size: +r.headers.get('content-length') || undefined }
    },
    async count() {
      let n = 0
      for (const folder of (await list('')).filter((o) => o.id == null)) n += (await list(folder.name)).filter((o) => o.id != null).length
      return n
    },
    async putRaw(p, body, type = 'application/octet-stream') {
      const r = await call('POST', `/object/${bucket}/${p}`, body, { 'content-type': type, 'x-upsert': 'true' }, 120000)
      if (!r.ok) throw new Error(`storage upload ${r.status}: ${(await r.text()).slice(0, 200)}`)
      return p
    },
    async listRaw(prefix) {
      return (await list(prefix)).filter((o) => o.id != null).map((o) => `${prefix}/${o.name}`).sort()
    },
    async deleteRaw(p) {
      const r = await call('DELETE', `/object/${bucket}`, JSON.stringify({ prefixes: [p] }), { 'content-type': 'application/json' })
      if (!r.ok) throw new Error(`storage delete ${r.status}`)
    },
  }
}
