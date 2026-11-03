// Office API client. The app works without the office server; every call
// fails soft and the UI says the office is offline.
export const API = (import.meta.env?.VITE_API_URL || 'http://localhost:8787').replace(/\/$/, '')

async function call(path, opts = {}, timeoutMs = 6000) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(API + path, { ...opts, signal: ctl.signal, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } })
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
  fileUrl: (url) => API + url,
}
