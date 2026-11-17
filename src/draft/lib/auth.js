// Who is signed in. Two modes, chosen at build time:
//  - Supabase (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set): email magic link through
//    Supabase Auth; the session's access token goes to the office API as a Bearer token.
//  - Local (neither set): the office API's local sign-in hands out a token for any email,
//    kept in localStorage. For laptops, screenshots and tests. Off in production.
import { api, setTokenProvider } from './api.js'

const SUPA_URL = (import.meta.env?.VITE_SUPABASE_URL || '').trim()
const SUPA_ANON = (import.meta.env?.VITE_SUPABASE_ANON_KEY || '').trim()
export const AUTH_MODE = SUPA_URL && SUPA_ANON ? 'supabase' : 'local'
const KEY = 'dh.session'

let supabase = null
async function client() {
  if (!supabase) {
    const { createClient } = await import('@supabase/supabase-js')
    supabase = createClient(SUPA_URL, SUPA_ANON, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } })
  }
  return supabase
}

const readLocal = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null')
  } catch {
    return null
  }
}
const writeLocal = (v) => {
  try {
    v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY)
  } catch {
    /* private window: the session lasts the page */
  }
}

export async function getToken() {
  if (AUTH_MODE === 'local') return readLocal()?.token || null
  const { data } = await (await client()).auth.getSession()
  return data.session?.access_token || null
}
setTokenProvider(getToken)

/** The signed-in user from the office API, or null. */
export async function currentUser() {
  if (!(await getToken())) return null
  try {
    return (await api.me()).user
  } catch (e) {
    if (/sign in/i.test(e.message)) await signOut()
    return null
  }
}

/** Local: signed in at once. Supabase: a link is emailed; resolves { sent: true }. */
export async function signIn(email, name) {
  if (AUTH_MODE === 'local') {
    const res = await api.devLogin({ email, name })
    writeLocal({ token: res.token, email })
    return { user: res.user }
  }
  const { error } = await (await client()).auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + window.location.pathname, data: { name } } })
  if (error) throw new Error(error.message)
  return { sent: true }
}

export async function signOut() {
  if (AUTH_MODE === 'local') writeLocal(null)
  else await (await client()).auth.signOut()
}

/** Fires when a magic link lands or the session changes (Supabase only). */
export function onAuthChange(cb) {
  if (AUTH_MODE === 'local') return () => {}
  let sub
  client().then((c) => {
    sub = c.auth.onAuthStateChange(() => cb())
  })
  return () => sub?.data?.subscription?.unsubscribe()
}
