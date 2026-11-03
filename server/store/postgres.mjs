// Postgres store (Supabase or any Postgres). Same interface as json.mjs.
// Migrations in server/migrations/*.sql run at start, once each, in name order.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

export function postgresStore(url) {
  const ssl = /localhost|127\.0\.0\.1/.test(url) || process.env.PGSSL === 'off' ? undefined : { rejectUnauthorized: false }
  const pool = new pg.Pool({ connectionString: url, ssl, max: 8, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 })
  pool.on('error', (e) => console.error('postgres pool:', e.message))
  const q = (text, params) => pool.query(text, params)
  const num = (x) => (x == null ? x : +x)
  const host = (() => {
    try {
      return new URL(url).host
    } catch {
      return 'postgres'
    }
  })()

  async function migrate() {
    await q('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())')
    const done = new Set((await q('select name from schema_migrations')).rows.map((r) => r.name))
    const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
    const applied = []
    for (const f of files) {
      if (done.has(f)) continue
      const c = await pool.connect()
      try {
        await c.query('begin')
        await c.query(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
        await c.query('insert into schema_migrations (name) values ($1)', [f])
        await c.query('commit')
        applied.push(f)
      } catch (e) {
        await c.query('rollback')
        throw new Error(`migration ${f} failed: ${e.message}`)
      } finally {
        c.release()
      }
    }
    return applied
  }

  return {
    kind: 'postgres',
    detail: host,
    async init() {
      const applied = await migrate()
      if (applied.length) console.log(`postgres: applied ${applied.join(', ')}`)
    },
    async ping() {
      try {
        const r = await q('select (select count(*) from designs) as designs, (select count(*) from jobs) as jobs, (select count(*) from schema_migrations) as migrations')
        return { ok: true, detail: `${host}, ${r.rows[0].designs} designs, ${r.rows[0].jobs} jobs, ${r.rows[0].migrations} migrations` }
      } catch (e) {
        return { ok: false, detail: `${host}: ${e.message}` }
      }
    },
    designs: {
      async add(d) {
        await q('insert into designs (id, created_at, client, doc) values ($1, $2, $3, $4)', [d.id, d.createdAt, d.client, d])
        return d
      },
      async get(id) {
        return (await q('select doc from designs where id = $1', [id])).rows[0]?.doc || null
      },
      async list(limit = 100) {
        return (await q('select doc from designs order by created_at desc limit $1', [limit])).rows.map((r) => r.doc)
      },
      async count() {
        return num((await q('select count(*) as n from designs')).rows[0].n)
      },
    },
    jobs: {
      async add(j) {
        await q('insert into jobs (id, design_id, status, worker, created_at, updated_at, doc) values ($1, $2, $3, $4, $5, $6, $7)', [j.id, j.designId, j.status, j.worker || null, j.createdAt, j.updatedAt, j])
        return j
      },
      async get(id) {
        return (await q('select doc from jobs where id = $1', [id])).rows[0]?.doc || null
      },
      async put(j) {
        const r = await q('update jobs set status = $2, worker = $3, updated_at = $4, doc = $5 where id = $1', [j.id, j.status, j.worker || null, j.updatedAt, j])
        if (!r.rowCount) throw new Error('job not found: ' + j.id)
        return j
      },
      async list(limit = 200) {
        return (await q('select doc from jobs order by created_at desc limit $1', [limit])).rows.map((r) => r.doc)
      },
      // oldest queued job, locked so two workers never take the same one
      async claim(worker, now) {
        const c = await pool.connect()
        try {
          await c.query('begin')
          const r = await c.query("select doc from jobs where status = 'queued' order by created_at asc limit 1 for update skip locked")
          if (!r.rows.length) {
            await c.query('commit')
            return null
          }
          const job = r.rows[0].doc
          Object.assign(job, { status: 'running', worker, startedAt: now, updatedAt: now, attempts: (job.attempts || 0) + 1, steps: [] })
          await c.query('update jobs set status = $2, worker = $3, updated_at = $4, doc = $5 where id = $1', [job.id, job.status, worker, now, job])
          await c.query('commit')
          return job
        } catch (e) {
          await c.query('rollback')
          throw e
        } finally {
          c.release()
        }
      },
      async stats(leaseMs, nowMs) {
        const r = await q(
          `select
             count(*) as total,
             count(*) filter (where status = 'queued') as queued,
             count(*) filter (where status = 'running') as running,
             count(*) filter (where status = 'running' and updated_at < $1) as stuck,
             count(*) filter (where status = 'done') as done,
             count(*) filter (where status = 'failed') as failed,
             avg((doc->>'durationS')::numeric) filter (where status = 'done') as avg_s
           from jobs`,
          [new Date(nowMs - leaseMs).toISOString()]
        )
        const s = r.rows[0]
        const recent = await q("select doc from jobs where status = 'done' order by created_at desc limit 20")
        return {
          total: num(s.total),
          queued: num(s.queued),
          running: num(s.running),
          stuck: num(s.stuck),
          done: num(s.done),
          failed: num(s.failed),
          avgDurationS: s.avg_s == null ? null : Math.round(+s.avg_s),
          recentDone: recent.rows.map((x) => x.doc).reverse().map((j) => ({ id: j.id, client: j.client, s: j.durationS })),
        }
      },
    },
    workers: {
      async get(id) {
        return (await q('select doc from workers where id = $1', [id])).rows[0]?.doc || null
      },
      async put(w) {
        await q(
          'insert into workers (id, name, first_seen, last_seen, doc) values ($1, $2, $3, $4, $5) on conflict (id) do update set name = excluded.name, last_seen = excluded.last_seen, doc = excluded.doc',
          [w.id, w.name || null, w.firstSeen, w.lastSeen, w]
        )
        return w
      },
      async list() {
        return (await q('select doc from workers order by first_seen')).rows.map((r) => r.doc)
      },
    },
    commands: {
      async add(c) {
        await q('insert into commands (id, worker, command, at) values ($1, $2, $3, $4)', [c.id, c.worker, c.command, c.at])
      },
      async take(worker, now) {
        const r = await q('update commands set taken = $2 where worker = $1 and taken is null returning command', [worker, now])
        return r.rows.map((x) => x.command)
      },
    },
    events: {
      async add(e) {
        const { id, at, kind, message, ...rest } = e
        await q('insert into events (id, at, kind, message, doc) values ($1, $2, $3, $4, $5)', [id, at, kind, message, rest])
      },
      async list(limit = 40) {
        return (await q('select id, at, kind, message, doc from events order by at desc limit $1', [limit])).rows.map((r) => ({ id: r.id, at: r.at.toISOString(), kind: r.kind, message: r.message, ...r.doc }))
      },
    },
    interpretLog: {
      async add(rec) {
        await q('insert into interpret_log (at, request, client, verdict, source, ms, cost, doc) values ($1, $2, $3, $4, $5, $6, $7, $8)', [rec.at, rec.request || null, rec.client || null, rec.verdict || null, rec.source || null, rec.ms ?? null, rec.cost ?? null, rec])
      },
      async recent(n = 50) {
        return (await q('select doc from interpret_log order by id desc limit $1', [n])).rows.map((r) => r.doc)
      },
      async summary() {
        const r = await q('select count(*) as count, count(cost) as calls, coalesce(sum(cost), 0) as cost, avg(ms) filter (where cost is not null) as avg_ms from interpret_log')
        const s = r.rows[0]
        const calls = num(s.calls)
        return { count: num(s.count), calls, cost: +s.cost, perCall: calls ? +s.cost / calls : 0, avgMs: s.avg_ms == null ? 0 : Math.round(+s.avg_ms) }
      },
    },
    meta: {
      async get(key) {
        return (await q('select value from meta where key = $1', [key])).rows[0]?.value ?? null
      },
      async set(key, value) {
        await q('insert into meta (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value, updated_at = now()', [key, value])
      },
    },
    async dump() {
      const rows = async (sql) => (await q(sql)).rows
      return {
        at: new Date().toISOString(),
        kind: 'postgres',
        designs: (await rows('select doc from designs order by created_at desc')).map((r) => r.doc),
        jobs: (await rows('select doc from jobs order by created_at desc')).map((r) => r.doc),
        workers: (await rows('select doc from workers')).map((r) => r.doc),
        commands: (await rows('select id, worker, command, at, taken from commands where taken is null')),
        events: (await rows('select id, at, kind, message, doc from events order by at desc limit 500')).map((r) => ({ id: r.id, at: r.at, kind: r.kind, message: r.message, ...r.doc })),
        interpretLog: (await rows('select doc from interpret_log order by id')).map((r) => r.doc),
        meta: Object.fromEntries((await rows('select key, value from meta')).map((r) => [r.key, r.value])),
      }
    },
    // import a dump or an old db.json (used by scripts/migrate-json-to-pg.mjs and restores)
    async load(dump) {
      let n = 0
      for (const d of dump.designs || []) {
        await q('insert into designs (id, created_at, client, doc) values ($1, $2, $3, $4) on conflict (id) do update set doc = excluded.doc', [d.id, d.createdAt, d.client, d])
        n++
      }
      for (const j of dump.jobs || []) {
        await q('insert into jobs (id, design_id, status, worker, created_at, updated_at, doc) values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do update set status = excluded.status, worker = excluded.worker, updated_at = excluded.updated_at, doc = excluded.doc', [j.id, j.designId, j.status, j.worker || null, j.createdAt, j.updatedAt, j])
        n++
      }
      for (const w of dump.workers || []) {
        await this.workers.put(w)
        n++
      }
      for (const e of dump.events || []) {
        const { id, at, kind, message, ...rest } = e
        await q('insert into events (id, at, kind, message, doc) values ($1, $2, $3, $4, $5) on conflict (id) do nothing', [id, at, kind, message, rest])
        n++
      }
      for (const rec of dump.interpretLog || []) {
        await this.interpretLog.add(rec)
        n++
      }
      for (const [k, v] of Object.entries(dump.meta || {})) await this.meta.set(k, v)
      return n
    },
    async close() {
      await pool.end()
    },
  }
}
