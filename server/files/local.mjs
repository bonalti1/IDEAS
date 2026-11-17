// Files on local disk under DATA_DIR/files/<design>/<name>. Same interface as supabase.mjs.
import fs from 'node:fs'
import path from 'node:path'

const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, '_')

export function localFiles(root) {
  fs.mkdirSync(root, { recursive: true })
  const full = (p) => path.join(root, ...String(p).split('/').map(safe))
  return {
    kind: 'local',
    detail: root,
    async init() {},
    async ping() {
      try {
        fs.accessSync(root, fs.constants.W_OK)
        return { ok: true, detail: `${await this.count()} files on disk` }
      } catch {
        return { ok: false, detail: `${root} not writable` }
      }
    },
    async put(design, name, body, type) {
      const dir = full(design)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, safe(name)), body)
      return `/files/${safe(design)}/${safe(name)}`
    },
    async get(design, name) {
      const f = path.join(full(design), safe(name))
      if (!fs.existsSync(f)) return null
      return { body: fs.createReadStream(f), size: fs.statSync(f).size }
    },
    async count() {
      let n = 0
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : n++))
      walk(root)
      return n
    },
    // flat objects outside the design folders (backups)
    async putRaw(p, body) {
      const f = full(p)
      fs.mkdirSync(path.dirname(f), { recursive: true })
      fs.writeFileSync(f, body)
      return p
    },
    async listRaw(prefix) {
      const dir = full(prefix)
      if (!fs.existsSync(dir)) return []
      return fs.readdirSync(dir).map((n) => `${prefix}/${n}`).sort()
    },
    async deleteRaw(p) {
      fs.rmSync(full(p), { force: true })
    },
  }
}
