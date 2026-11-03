// JSON file store: one db.json written debounced, the interpret log as JSON lines.
// Used when DATABASE_URL is not set (local work, tests). Same interface as postgres.mjs.
import fs from 'node:fs'
import path from 'node:path'

export function jsonStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true })
  const DB_PATH = path.join(dataDir, 'db.json')
  const LOG_PATH = path.join(dataDir, 'interpret-log.jsonl')
  const db = fs.existsSync(DB_PATH) ? JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) : {}
  for (const k of ['designs', 'jobs', 'workers', 'events', 'commands']) db[k] ||= []
  db.meta ||= {}
  let timer = null
  const save = () => {
    clearTimeout(timer)
    timer = setTimeout(() => fs.writeFileSync(DB_PATH, JSON.stringify(db)), 50)
  }
  const flush = () => {
    clearTimeout(timer)
    fs.writeFileSync(DB_PATH, JSON.stringify(db))
  }
  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)))
  const readLog = () => (fs.existsSync(LOG_PATH) ? fs.readFileSync(LOG_PATH, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])

  return {
    kind: 'json',
    detail: DB_PATH,
    async init() {},
    async ping() {
      try {
        fs.accessSync(dataDir, fs.constants.W_OK)
        return { ok: true, detail: `json file, ${db.designs.length} designs, ${db.jobs.length} jobs` }
      } catch {
        return { ok: false, detail: `${dataDir} not writable` }
      }
    },
    designs: {
      async add(d) {
        db.designs.unshift(clone(d))
        save()
        return d
      },
      async get(id) {
        return clone(db.designs.find((d) => d.id === id) || null)
      },
      async list(limit = 100) {
        return clone(db.designs.slice(0, limit))
      },
      async count() {
        return db.designs.length
      },
    },
    jobs: {
      async add(j) {
        db.jobs.unshift(clone(j))
        save()
        return j
      },
      async get(id) {
        return clone(db.jobs.find((j) => j.id === id) || null)
      },
      async put(j) {
        const i = db.jobs.findIndex((x) => x.id === j.id)
        if (i < 0) throw new Error('job not found: ' + j.id)
        db.jobs[i] = clone(j)
        save()
        return j
      },
      async list(limit = 200) {
        return clone(db.jobs.slice(0, limit))
      },
      // oldest queued job, marked running for this worker
      async claim(worker, now) {
        const job = [...db.jobs].reverse().find((j) => j.status === 'queued')
        if (!job) return null
        Object.assign(job, { status: 'running', worker, startedAt: now, updatedAt: now, attempts: (job.attempts || 0) + 1, steps: [] })
        save()
        return clone(job)
      },
      async stats(leaseMs, nowMs) {
        const done = db.jobs.filter((j) => j.status === 'done')
        return {
          total: db.jobs.length,
          queued: db.jobs.filter((j) => j.status === 'queued').length,
          running: db.jobs.filter((j) => j.status === 'running').length,
          stuck: db.jobs.filter((j) => j.status === 'running' && nowMs - Date.parse(j.updatedAt) > leaseMs).length,
          done: done.length,
          failed: db.jobs.filter((j) => j.status === 'failed').length,
          avgDurationS: done.length ? Math.round(done.reduce((s, j) => s + (j.durationS || 0), 0) / done.length) : null,
          recentDone: done.slice(0, 20).reverse().map((j) => ({ id: j.id, client: j.client, s: j.durationS })),
        }
      },
    },
    workers: {
      async get(id) {
        return clone(db.workers.find((w) => w.id === id) || null)
      },
      async put(w) {
        const i = db.workers.findIndex((x) => x.id === w.id)
        if (i < 0) db.workers.push(clone(w))
        else db.workers[i] = clone(w)
        save()
        return w
      },
      async list() {
        return clone(db.workers)
      },
    },
    commands: {
      async add(c) {
        db.commands.push(clone(c))
        save()
      },
      async take(worker, now) {
        const mine = db.commands.filter((c) => c.worker === worker && !c.taken)
        mine.forEach((c) => (c.taken = now))
        db.commands = db.commands.filter((c) => !c.taken || Date.parse(c.taken) > Date.now() - 86400000)
        save()
        return mine.map((c) => c.command)
      },
    },
    events: {
      async add(e) {
        db.events.unshift(clone(e))
        db.events.length = Math.min(db.events.length, 500)
        save()
      },
      async list(limit = 40) {
        return clone(db.events.slice(0, limit))
      },
    },
    interpretLog: {
      async add(rec) {
        fs.appendFileSync(LOG_PATH, JSON.stringify(rec) + '\n')
      },
      async recent(n = 50) {
        return readLog().slice(-n).reverse()
      },
      async summary() {
        const recs = readLog()
        const calls = recs.filter((r) => r.cost !== undefined && r.cost !== null)
        const cost = calls.reduce((s, r) => s + (+r.cost || 0), 0)
        return { count: recs.length, calls: calls.length, cost, perCall: calls.length ? cost / calls.length : 0, avgMs: calls.length ? Math.round(calls.reduce((s, r) => s + (r.ms || 0), 0) / calls.length) : 0 }
      },
    },
    meta: {
      async get(key) {
        return clone(db.meta[key] ?? null)
      },
      async set(key, value) {
        db.meta[key] = clone(value)
        save()
      },
    },
    async dump() {
      return { at: new Date().toISOString(), kind: 'json', designs: clone(db.designs), jobs: clone(db.jobs), workers: clone(db.workers), commands: clone(db.commands), events: clone(db.events), interpretLog: readLog(), meta: clone(db.meta) }
    },
    async close() {
      flush()
    },
  }
}
