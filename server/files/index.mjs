// Pick the file store: Supabase Storage when SUPABASE_URL and SUPABASE_SERVICE_KEY are set, else local disk.
import path from 'node:path'
import { localFiles } from './local.mjs'
import { supabaseFiles } from './supabase.mjs'

export function openFiles({ dataDir, env = process.env } = {}) {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) return supabaseFiles({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_KEY, bucket: env.SUPABASE_BUCKET || 'drafthouse' })
  return localFiles(path.join(dataDir, 'files'))
}
