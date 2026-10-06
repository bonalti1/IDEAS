/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NotFoundError, type Store, type TableName, type Tables } from './store.ts'

// Columns are snake_case in Postgres; records are camelCase in TS.
// Only top-level keys are converted: jsonb payloads (scene, review, …) are stored as-is.
const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const toCamel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())

function rowToDb(obj: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [toSnake(k), v]))
}

function rowFromDb<T>(obj: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [toCamel(k), v])) as T
}

/** Supabase-backed store. Uses the service-role key: call only from the server. */
export class SupabaseStore implements Store {
  readonly kind = 'supabase'
  private db: SupabaseClient<any, string>

  constructor(url: string, serviceRoleKey: string, private schema = 'public') {
    this.db = createClient(url, serviceRoleKey, {
      auth: { persistSession: false },
      db: { schema },
    })
  }

  private table(t: TableName) {
    return this.db.from(`vf_${t}`)
  }

  async insert<T extends TableName>(table: T, row: Tables[T]) {
    const { data, error } = await this.table(table).insert(rowToDb(row)).select().single()
    if (error) throw new Error(`insert ${table}: ${error.message}`)
    return rowFromDb<Tables[T]>(data)
  }

  async get<T extends TableName>(table: T, id: string) {
    const { data, error } = await this.table(table).select().eq('id', id).maybeSingle()
    if (error) throw new Error(`get ${table}: ${error.message}`)
    return data ? rowFromDb<Tables[T]>(data) : null
  }

  async update<T extends TableName>(table: T, id: string, patch: Partial<Tables[T]>) {
    const { data, error } = await this.table(table).update(rowToDb(patch)).eq('id', id).select().maybeSingle()
    if (error) throw new Error(`update ${table}: ${error.message}`)
    if (!data) throw new NotFoundError(`${table}/${id} not found`)
    return rowFromDb<Tables[T]>(data)
  }

  async list<T extends TableName>(table: T, where?: Partial<Tables[T]>) {
    let q = this.table(table).select()
    for (const [k, v] of Object.entries(where ?? {})) {
      q = v === null ? q.is(toSnake(k), null) : q.eq(toSnake(k), v as string)
    }
    const { data, error } = await q
    if (error) throw new Error(`list ${table}: ${error.message}`)
    return (data ?? []).map((r) => rowFromDb<Tables[T]>(r))
  }

  async remove(table: TableName, id: string) {
    const { error } = await this.table(table).delete().eq('id', id)
    if (error) throw new Error(`delete ${table}: ${error.message}`)
  }
}
