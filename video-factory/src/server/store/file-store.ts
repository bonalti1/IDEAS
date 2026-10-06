import fs from 'node:fs'
import path from 'node:path'
import { matches, NotFoundError, type Store, type TableName, type Tables } from './store.ts'

type Data = { [K in TableName]: Record<string, Tables[K]> }
// Untyped view for writes (TS cannot index a generic mapped type for writing).
type Rows = Record<string, Record<string, unknown>>

const empty = (): Data => ({
  projects: {},
  assets: {},
  stages: {},
  candidates: {},
  transitions: {},
  takes: {},
  jobs: {},
})

/**
 * Single-process JSON store for local development and tests.
 * Pass `file: null` for a purely in-memory store.
 */
export class FileStore implements Store {
  readonly kind: string
  private data: Data
  private timer: NodeJS.Timeout | null = null

  constructor(private file: string | null) {
    this.kind = file ? `file (${file})` : 'memory'
    this.data = empty()
    if (file && fs.existsSync(file)) {
      this.data = { ...empty(), ...JSON.parse(fs.readFileSync(file, 'utf8')) }
    }
  }

  private persist() {
    if (!this.file || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, 50)
  }

  flush() {
    if (!this.file) return
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(this.data))
    fs.renameSync(tmp, this.file)
  }

  async insert<T extends TableName>(table: T, row: Tables[T]) {
    const r = row as Tables[T] & { id: string }
    if (this.data[table][r.id]) throw new Error(`${table}/${r.id} already exists`)
    ;(this.data as unknown as Rows)[table][r.id] = structuredClone(row) as unknown as Record<string, unknown>
    this.persist()
    return structuredClone(row)
  }

  async get<T extends TableName>(table: T, id: string) {
    const row = this.data[table][id]
    return row ? (structuredClone(row) as Tables[T]) : null
  }

  async update<T extends TableName>(table: T, id: string, patch: Partial<Tables[T]>) {
    const row = this.data[table][id]
    if (!row) throw new NotFoundError(`${table}/${id} not found`)
    const next = { ...row, ...structuredClone(patch) }
    ;(this.data as unknown as Rows)[table][id] = next
    this.persist()
    return structuredClone(next) as Tables[T]
  }

  async list<T extends TableName>(table: T, where?: Partial<Tables[T]>) {
    return Object.values(this.data[table])
      .filter((r) => matches(r as Tables[T], where))
      .map((r) => structuredClone(r) as Tables[T])
  }

  async remove(table: TableName, id: string) {
    delete this.data[table][id]
    this.persist()
  }
}
