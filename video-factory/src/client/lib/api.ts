import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppConfigDTO, Project, ProjectSummaryDTO, ProjectViewDTO } from '../../shared/types.ts'

const TOKEN_KEY = 'vf.apiToken'

function headers(extra: Record<string, string> = {}) {
  let token: string | null = null
  try {
    token = localStorage.getItem(TOKEN_KEY)
  } catch {
    /* storage unavailable */
  }
  return token ? { ...extra, authorization: `Bearer ${token}` } : extra
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: headers() }
  if (body instanceof FormData) init.body = body
  else if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = headers({ 'content-type': 'application/json' })
  }
  const res = await fetch(url, init)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, (json as { error?: string }).error ?? res.statusText)
  return json as T
}

export const api = {
  config: () => request<AppConfigDTO>('GET', '/api/config'),
  projects: () => request<ProjectSummaryDTO[]>('GET', '/api/projects'),
  createProject: (form: FormData) => request<Project>('POST', '/api/projects', form),
  project: (id: string) => request<ProjectViewDTO>('GET', `/api/projects/${id}`),
  /** Mutations on a project return the refreshed project view. */
  act: (id: string, method: string, path: string, body?: unknown) =>
    request<ProjectViewDTO>(method, `/api/projects/${id}${path}`, body),
}

export function hasActiveJobs(v: ProjectViewDTO | null) {
  return !!v?.jobs.some((j) => j.status === 'queued' || j.status === 'running')
}

/** Loads a project view; polls quickly while jobs run, slowly otherwise. */
export function useProject(id: string) {
  const [view, setView] = useState<ProjectViewDTO | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const v = await api.project(id)
      if (alive.current) {
        setView(v)
        setError(null)
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message)
    }
  }, [id])

  useEffect(() => {
    alive.current = true
    setView(null)
    refresh()
    return () => {
      alive.current = false
    }
  }, [refresh])

  const active = hasActiveJobs(view)
  useEffect(() => {
    const t = setInterval(refresh, active ? 1500 : 15000)
    return () => clearInterval(t)
  }, [refresh, active])

  const act = useCallback(
    async (method: string, path: string, body?: unknown) => {
      setBusy(true)
      setError(null)
      try {
        const v = await api.act(id, method, path, body)
        if (alive.current) setView(v)
        return v
      } catch (e) {
        if (alive.current) setError((e as Error).message)
        return null
      } finally {
        if (alive.current) setBusy(false)
      }
    },
    [id],
  )

  return { view, error, setError, busy, act, refresh }
}

export type ProjectCtl = ReturnType<typeof useProject>

export function useHashRoute(): [string[], (path: string) => void] {
  const parse = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [parts, setParts] = useState(parse)
  useEffect(() => {
    const on = () => setParts(parse())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return [parts, (p: string) => (window.location.hash = `#/${p}`)]
}
