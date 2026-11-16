// Saved projects: lot, style, program, every version of the rooms, credits, the drafter review.
// A change runs here, not in the browser: Claude (or the basic rules when it is unavailable),
// then the plan rules, and a credit is taken only when the change is applied.
import crypto from 'node:crypto'
import { decide } from '../src/draft/lib/interpret.js'
import { regexOps, summarizeRooms } from '../src/draft/lib/ops.js'
import { kitFor } from '../src/draft/lib/layout.js'
import { STYLES } from '../src/draft/lib/styles.js'

const id = (p) => p + '_' + crypto.randomBytes(5).toString('hex')
const now = () => new Date().toISOString()
const fail = (status, error, extra = {}) => Object.assign(new Error(error), { status, ...extra })
export const EDITABLE = ['drafting', 'returned']

export function makeProjects({ env = process.env, store, interpreter, event, logInterpret }) {
  const CREDITS = +(env.CREDITS_PER_PROJECT || 10)

  const styleOf = (p) => STYLES.find((s) => s.id === p.style?.id) || STYLES.find((s) => s.ready)
  const publicProject = (p, extra = {}) => ({ ...p, ...extra })

  async function withRooms(p) {
    const v = await store.versions.get(p.id, p.version)
    return { ...p, rooms: v?.rooms || [] }
  }

  return {
    CREDITS,
    async create(user, body) {
      if (!Array.isArray(body.rooms) || !body.rooms.length) throw fail(400, 'rooms required')
      if (!body.style?.id) throw fail(400, 'style required')
      const t = now()
      const p = {
        id: id('prj'),
        userId: user.id,
        email: user.email,
        client: body.client || user.name || user.email,
        address: body.lot?.address || '',
        lot: body.lot || null,
        style: { id: body.style.id, name: body.style.name || body.style.id },
        program: body.program || {},
        status: 'drafting',
        credits: CREDITS,
        creditsTotal: CREDITS,
        version: 1,
        createdAt: t,
        updatedAt: t,
      }
      await store.projects.add(p)
      await store.versions.add({ projectId: p.id, n: 1, at: t, kind: 'initial', text: 'First draft', credit: 0, rooms: body.rooms })
      await event('project', `${p.client}: started a ${p.style.name} on ${p.address || 'a lot'}`, { projectId: p.id })
      return this.detail(p)
    },

    // the owner, or a drafter; 404 for anyone else so ids cannot be probed
    async load(user, projectId, { drafter = false } = {}) {
      const p = await store.projects.get(projectId)
      if (!p || (p.userId !== user.id && !drafter)) throw fail(404, 'project not found')
      return p
    },

    async detail(p) {
      const [full, versions, reviews, job] = await Promise.all([withRooms(p), store.versions.list(p.id), store.reviews.list(p.id), p.jobId ? store.jobs.get(p.jobId) : null])
      return publicProject(full, { versions, reviews, job: job ? { id: job.id, status: job.status, steps: job.steps?.slice(-1), outputs: job.outputs, error: job.error, warnings: job.warnings } : null })
    },

    // lot, style, program, and (when the program changed) regenerated rooms as a free version
    async update(p, body) {
      if (!EDITABLE.includes(p.status)) throw fail(409, 'the design is with the drafters; it cannot change now')
      if (body.lot) {
        p.lot = body.lot
        p.address = body.lot.address || p.address
      }
      if (body.style?.id) p.style = { id: body.style.id, name: body.style.name || body.style.id }
      if (body.program) p.program = body.program
      if (body.client) p.client = body.client
      p.updatedAt = now()
      if (Array.isArray(body.rooms) && body.rooms.length) {
        p.version += 1
        await store.versions.add({ projectId: p.id, n: p.version, at: p.updatedAt, kind: 'program', text: body.note || 'Rooms changed', credit: 0, rooms: body.rooms })
      }
      await store.projects.put(p)
      return this.detail(p)
    },

    // one plain-language request → Claude or the basic rules → plan rules → charged only if applied
    async change(p, text) {
      if (!EDITABLE.includes(p.status)) throw fail(409, 'the design is with the drafters; it cannot change now')
      const request = String(text || '').trim().slice(0, 500)
      if (!request) throw fail(400, 'text required')
      if (p.credits <= 0) throw fail(402, 'no changes left on this design', { credits: 0 })
      const style = styleOf(p)
      const kit = kitFor(style)
      const current = await store.versions.get(p.id, p.version)
      const rooms = current?.rooms || []
      const kitMeta = { id: kit.id, name: kit.name, kinds: Object.fromEntries(Object.entries(kit.rooms).map(([k, t]) => [k, { name: t.name, w: t.w, d: t.d, zone: t.zone }])), minSize: kit.rules?.minSize || {} }
      let diff
      let source = 'claude'
      let meta = {}
      try {
        diff = await interpreter.ask({ request, program: p.program, kit: kitMeta, rooms: summarizeRooms(rooms) })
        meta = { usage: diff.usage, cost: diff.cost, ms: diff.ms, model: diff.model }
        logInterpret({ request, client: p.email, projectId: p.id, rooms: rooms.length, diff: { ops: diff.ops, reply: diff.reply, confidence: diff.confidence }, verdict: diff.confidence < 0.5 || !diff.ops.length ? 'unsure' : 'diff', ...meta })
      } catch (e) {
        if (!e.unconfigured) logInterpret({ request, client: p.email, projectId: p.id, verdict: e.timeout ? 'timeout' : e.refusal ? 'refusal' : 'error', error: String(e.message).slice(0, 200), ms: e.ms, cost: e.cost, usage: e.usage, model: interpreter.model })
        diff = regexOps(request, rooms, kit)
        source = e.timeout ? 'timeout' : 'fallback'
      }
      const result = decide(diff, rooms, p.program, style, kit, source)
      logInterpret({ request, client: p.email, projectId: p.id, source, verdict: result.applied ? 'applied' : 'rejected', reasons: result.reasons || [], reply: result.reply, ops: result.ops })
      if (!result.applied) return { applied: false, reply: result.reply, source, reasons: result.reasons || [], credits: p.credits, version: p.version }
      const charged = await store.projects.charge(p.id, now())
      if (!charged) throw fail(402, 'no changes left on this design', { credits: 0 })
      const n = charged.version + 1
      const t = now()
      await store.versions.add({ projectId: p.id, n, at: t, kind: 'change', text: request, credit: 1, rooms: result.rooms, reply: result.reply, source, ops: result.ops, did: result.did })
      charged.version = n
      charged.updatedAt = t
      await store.projects.put(charged)
      await event('project', `${p.client}: "${request.slice(0, 60)}" applied (${source}), ${charged.credits} credit${charged.credits === 1 ? '' : 's'} left`, { projectId: p.id })
      return { applied: true, reply: result.reply, source, rooms: result.rooms, credits: charged.credits, version: n, did: result.did, ops: result.ops, ...meta }
    },

    // back to any earlier version; credits spent on the versions after it come back
    async rollback(p, target) {
      if (!EDITABLE.includes(p.status)) throw fail(409, 'the design is with the drafters; it cannot change now')
      const k = +target
      const want = await store.versions.get(p.id, k)
      if (!want) throw fail(404, 'no such version')
      if (k === p.version) return this.detail(p)
      const all = await store.versions.list(p.id)
      let refund = 0
      for (const v of all) {
        if (v.n > k && v.credit && !v.refunded) {
          refund += v.credit
          await store.versions.put({ ...(await store.versions.get(p.id, v.n)), refunded: true })
        }
      }
      const t = now()
      p.version += 1
      p.credits = Math.min(p.creditsTotal || CREDITS, p.credits + refund)
      p.updatedAt = t
      await store.versions.add({ projectId: p.id, n: p.version, at: t, kind: 'rollback', text: `Back to version ${k}`, rollbackOf: k, credit: 0, rooms: want.rooms })
      await store.projects.put(p)
      await event('project', `${p.client}: back to version ${k}${refund ? `, ${refund} credit${refund === 1 ? '' : 's'} returned` : ''}`, { projectId: p.id })
      return { ...(await this.detail(p)), refunded: refund }
    },

    // the client hands the design to the drafters; nothing is built until a drafter approves
    async send(p, { design, ifc }, saveDesign) {
      if (!EDITABLE.includes(p.status)) throw fail(409, `already ${p.status.replace('_', ' ')}`)
      if (!design || design.contract !== 1) throw fail(400, 'design with contract 1 required')
      const d = await saveDesign({ ...design, client: design.client || p.client, projectId: p.id }, ifc, { projectId: p.id })
      p.designId = d.id
      p.status = 'in_review'
      p.sentAt = now()
      p.updatedAt = p.sentAt
      await store.projects.put(p)
      await event('project', `${p.client}: design sent for review`, { projectId: p.id, designId: d.id })
      return this.detail(p)
    },

    // drafter inbox: waiting first, then recent decisions
    async inbox() {
      const waiting = await store.projects.listByStatus(['in_review'])
      const recent = await store.projects.listByStatus(['returned', 'approved', 'built'], 30)
      return { waiting, recent }
    },

    // approve → queue the Revit build; return → back to the client with a note
    async review(p, drafter, { decision, note }, queueJob) {
      if (p.status !== 'in_review') throw fail(409, `this design is ${p.status.replace('_', ' ')}, not waiting for review`)
      if (!['approved', 'returned'].includes(decision)) throw fail(400, 'decision must be approved or returned')
      const t = now()
      const r = { id: id('rev'), projectId: p.id, drafterId: drafter.id, drafter: drafter.name || drafter.email, decision, note: String(note || '').trim().slice(0, 2000), at: t }
      await store.reviews.add(r)
      p.review = r
      p.updatedAt = t
      if (decision === 'approved') {
        p.status = 'approved'
        const job = await queueJob(p.designId, { projectId: p.id, client: p.client, address: p.address })
        p.jobId = job.id
        await event('project', `${p.client}: approved by ${r.drafter}, Revit build queued`, { projectId: p.id, jobId: job.id })
      } else {
        p.status = 'returned'
        await event('project', `${p.client}: returned by ${r.drafter}${r.note ? ` ("${r.note.slice(0, 60)}")` : ''}`, { projectId: p.id })
      }
      await store.projects.put(p)
      return this.detail(p)
    },

    // the worker finished the model
    async built(jobId) {
      const job = await store.jobs.get(jobId)
      if (!job?.projectId) return
      const p = await store.projects.get(job.projectId)
      if (!p || p.status !== 'approved') return
      p.status = 'built'
      p.updatedAt = now()
      await store.projects.put(p)
      await event('project', `${p.client}: Revit model ready`, { projectId: p.id, jobId })
    },
  }
}
