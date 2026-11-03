// Office API client. The app works without the office server; every call
// fails soft and the UI says the office is offline.
export const API = (import.meta.env?.VITE_API_URL || 'http://localhost:8787').replace(/\/$/, '')
// The app key gates the office API (DRAFTHOUSE_APP_KEY on the server, VITE_API_KEY at build time).
// Anyone who opens the site can read it; it keeps strangers and bots out, not a determined person.
// Client accounts (phase 2) are the real door. Empty when the office runs open on a laptop.
export const API_KEY = (import.meta.env?.VITE_API_KEY || '').trim()

async function call(path, opts = {}, timeoutMs = 6000) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(API + path, { ...opts, signal: ctl.signal, headers: { 'content-type': 'application/json', ...(API_KEY ? { 'x-api-key': API_KEY } : {}), ...(opts.headers || {}) } })
    if (res.status === 204) return null
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    return body
  } finally {
    clearTimeout(t)
  }
}

export const api = {
  health: () => call('/api/health'),
  overview: () => call('/api/admin/overview'),
  interpretLog: () => call('/api/interpret/log'),
  sendDesign: (design, ifc) => call('/api/designs', { method: 'POST', body: JSON.stringify({ design, ifc }) }, 20000),
  job: (id) => call(`/api/jobs/${id}`),
  interpret: (body) => call('/api/interpret', { method: 'POST', body: JSON.stringify(body) }, 8500), // the office waits 8 s on Claude, then we fall back
  verdict: (body) => call('/api/interpret/verdict', { method: 'POST', body: JSON.stringify(body) }, 4000).catch(() => null),
  retry: (id) => call(`/api/jobs/${id}/retry`, { method: 'POST' }),
  command: (worker, command) => call(`/api/workers/${worker}/commands`, { method: 'POST', body: JSON.stringify({ command }) }),
  fileUrl: (url) => API + url + (API_KEY ? `?key=${encodeURIComponent(API_KEY)}` : ''),
  backup: () => call('/api/admin/backup', { method: 'POST' }, 60000),
}
