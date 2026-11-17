// Office API client. The app works without the office server; every call
// fails soft and the UI says the office is offline.
// VITE_API_URL='' means same origin (the Vite dev proxy, or the app served by the API itself)
export const API = (import.meta.env?.VITE_API_URL ?? 'http://localhost:8787').replace(/\/$/, '')
// The app key gates the office API (DRAFTHOUSE_APP_KEY on the server, VITE_API_KEY at build time).
// Anyone who opens the site can read it; it keeps strangers and bots out, not a determined person.
// Client accounts (phase 2) are the real door. Empty when the office runs open on a laptop.
export const API_KEY = (import.meta.env?.VITE_API_KEY || '').trim()

// the signed-in user's token, set by auth.js
let tokenProvider = async () => null
export const setTokenProvider = (fn) => (tokenProvider = fn)

async function call(path, opts = {}, timeoutMs = 6000) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const token = await tokenProvider()
    const res = await fetch(API + path, { ...opts, signal: ctl.signal, headers: { 'content-type': 'application/json', ...(API_KEY ? { 'x-api-key': API_KEY } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) } })
    if (res.status === 204) return null
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw Object.assign(new Error(body.error || `HTTP ${res.status}`), { status: res.status, body })
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
  // accounts and saved projects
  devLogin: (body) => call('/api/auth/dev-login', { method: 'POST', body: JSON.stringify(body) }),
  me: () => call('/api/me'),
  projects: () => call('/api/projects'),
  project: (id) => call(`/api/projects/${id}`),
  createProject: (body) => call('/api/projects', { method: 'POST', body: JSON.stringify(body) }, 20000),
  updateProject: (id, body) => call(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(body) }, 20000),
  change: (id, text, ops) => call(`/api/projects/${id}/change`, { method: 'POST', body: JSON.stringify(ops ? { text, ops } : { text }) }, 20000),
  rollback: (id, version) => call(`/api/projects/${id}/rollback`, { method: 'POST', body: JSON.stringify({ version }) }, 20000),
  sendProject: (id, design, ifc) => call(`/api/projects/${id}/send`, { method: 'POST', body: JSON.stringify({ design, ifc }) }, 30000),
  // lots
  cities: () => call('/api/cities'),
  setCity: (id, patch) => call(`/api/admin/cities/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  readPlat: (body) => call('/api/lot/plat', { method: 'POST', body: JSON.stringify(body) }, 150000),
  flood: (address) => call(`/api/lot/flood?address=${encodeURIComponent(address)}`, {}, 30000),
  geocode: (address) => call(`/api/lot/geocode?address=${encodeURIComponent(address)}`, {}, 20000),
  confirmLot: (id, body) => call(`/api/review/${id}/lot`, { method: 'POST', body: JSON.stringify(body) }, 20000),
  platUrl: (platId) => API + `/api/lot/plat/${platId}` + (API_KEY ? `?key=${encodeURIComponent(API_KEY)}` : ''),
  // billing
  billing: () => call('/api/billing'),
  checkout: (pack) => call('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ pack }) }, 30000),
  billingSession: (id) => call(`/api/billing/session/${id}`, {}, 20000),
  pricing: () => call('/api/admin/pricing'),
  setPricing: (body) => call('/api/admin/pricing', { method: 'PUT', body: JSON.stringify(body) }),
  payments: () => call('/api/admin/payments'),
  users: () => call('/api/admin/users'),
  grantCredits: (userId, credits, note) => call(`/api/admin/users/${userId}/credits`, { method: 'POST', body: JSON.stringify({ credits, note }) }),
  // drafter review
  inbox: () => call('/api/review'),
  reviewProject: (id) => call(`/api/review/${id}`),
  review: (id, decision, note, override = '') => call(`/api/review/${id}`, { method: 'POST', body: JSON.stringify({ decision, note, override }) }, 20000),
  backup: () => call('/api/admin/backup', { method: 'POST' }, 60000),
}
