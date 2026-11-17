// Saved projects: lot, style, program, every version of the rooms, credits, the drafter review.
// A change runs here, not in the browser: Claude (or the basic rules when it is unavailable),
// then the plan rules, and a credit is taken only when the change is applied.
import crypto from 'node:crypto'
import { decide } from '../src/draft/lib/interpret.js'
import { regexOps, summarizeRooms, replaceOnLot } from '../src/draft/lib/ops.js'
import { kitFor } from '../src/draft/lib/layout.js'
import { checkRules } from '../src/draft/lib/rules.js'
import { STYLES } from '../src/draft/lib/styles.js'

const id = (p) => p + '_' + crypto.randomBytes(5).toString('hex')
const now = () => new Date().toISOString()
const fail = (status, error, extra = {}) => Object.assign(new Error(error), { status, ...extra })
export const EDITABLE = ['drafting', 'returned']

export function makeProjects({ env = process.env, store, interpreter, event, logInterpret, lots }) {

  const styleOf = (p) => STYLES.find((s) => s.id === p.style?.id) || STYLES.find((s) => s.ready)
  const publicProject = (p, extra = {}) => ({ ...p, ...extra })

  async function withRooms(p) {
    const v = await store.versions.get(p.id, p.version)
    return { ...p, rooms: v?.rooms || [] }
  }

  return {
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
        creditsUsed: 0,
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

    // credits are the owner's account balance; the project only counts what it used
    async detail(p) {
      const [full, versions, reviews, job, owner] = await Promise.all([withRooms(p), store.versions.list(p.id), store.reviews.list(p.id), p.jobId ? store.jobs.get(p.jobId) : null, store.users.get(p.userId)])
      return publicProject(full, { credits: owner?.credits ?? 0, versions, reviews, job: job ? { id: job.id, status: job.status, steps: job.steps?.slice(-1), outputs: job.outputs, error: job.error, warnings: job.warnings } : null })
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

    // one plain-language request → Claude or the basic rules → plan rules → charged only if applied.
    // With `ops` (a fix the client clicked), the ops are taken as given and only the rules run.
    async change(p, text, fixOps = null) {
      if (!EDITABLE.includes(p.status)) throw fail(409, 'the design is with the drafters; it cannot change now')
      const request = String(text || '').trim().slice(0, 500)
      if (!request) throw fail(400, 'text required')
      const owner = await store.users.get(p.userId)
      if (!owner || (owner.credits || 0) <= 0) throw fail(402, 'no changes left on your account; add more on the billing page', { credits: 0 })
      const style = styleOf(p)
      const kit = kitFor(style)
      const current = await store.versions.get(p.id, p.version)
      const rooms = current?.rooms || []
      const kitMeta = { id: kit.id, name: kit.name, kinds: Object.fromEntries(Object.entries(kit.rooms).map(([k, t]) => [k, { name: t.name, w: t.w, d: t.d, zone: t.zone }])), minSize: kit.rules?.minSize || {} }
      const lot = await lots.lotOfProject(p)
      let diff
      let source = 'claude'
      let meta = {}
      if (Array.isArray(fixOps) && fixOps.length) {
        diff = { ops: fixOps.slice(0, 8), reply: request, confidence: 1 }
        source = 'fix'
      } else
      try {
        diff = await interpreter.ask({ request, program: p.program, kit: kitMeta, rooms: summarizeRooms(rooms) })
        meta = { usage: diff.usage, cost: diff.cost, ms: diff.ms, model: diff.model }
        logInterpret({ request, client: p.email, projectId: p.id, rooms: rooms.length, diff: { ops: diff.ops, reply: diff.reply, confidence: diff.confidence }, verdict: diff.confidence < 0.5 || !diff.ops.length ? 'unsure' : 'diff', ...meta })
      } catch (e) {
        if (!e.unconfigured) logInterpret({ request, client: p.email, projectId: p.id, verdict: e.timeout ? 'timeout' : e.refusal ? 'refusal' : 'error', error: String(e.message).slice(0, 200), ms: e.ms, cost: e.cost, usage: e.usage, model: interpreter.model })
        diff = regexOps(request, rooms, kit, lot)
        source = e.timeout ? 'timeout' : 'fallback'
      }
      const result = decide(diff, rooms, p.program, style, kit, source, lot)
      logInterpret({ request, client: p.email, projectId: p.id, source, verdict: result.applied ? 'applied' : 'rejected', reasons: result.reasons || [], reply: result.reply, ops: result.ops })
      if (!result.applied) return { applied: false, reply: result.reply, source, reasons: result.reasons || [], caused: result.caused, preexisting: result.preexisting, fixes: result.fixes || [], credits: owner.credits, version: p.version }
      const charged = await store.users.charge(p.userId, now())
      if (!charged) throw fail(402, 'no changes left on your account; add more on the billing page', { credits: 0 })
      const n = p.version + 1
      const t = now()
      await store.versions.add({ projectId: p.id, n, at: t, kind: 'change', text: request, credit: 1, rooms: result.rooms, reply: result.reply, source, ops: result.ops, did: result.did })
      p.version = n
      p.creditsUsed = (p.creditsUsed || 0) + 1
      p.updatedAt = t
      await store.projects.put(p)
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
      p.creditsUsed = Math.max(0, (p.creditsUsed || 0) - refund)
      p.updatedAt = t
      if (refund) await store.users.addCredits(p.userId, refund, t)
      await store.versions.add({ projectId: p.id, n: p.version, at: t, kind: 'rollback', text: `Back to version ${k}`, rollbackOf: k, credit: 0, rooms: want.rooms })
      await store.projects.put(p)
      await event('project', `${p.client}: back to version ${k}${refund ? `, ${refund} credit${refund === 1 ? '' : 's'} returned` : ''}`, { projectId: p.id })
      return { ...(await this.detail(p)), refunded: refund }
    },

    // the client hands the design to the drafters; nothing is built until a drafter approves
    async send(p, { design, ifc }, saveDesign) {
      if (!EDITABLE.includes(p.status)) throw fail(409, `already ${p.status.replace('_', ' ')}`)
      if (p.lot?.spec?.kind === 'plat' && !p.lot.spec.confirmed) throw fail(409, 'a drafter has not confirmed your lot yet; it is in their queue', { lotPending: true })
      if (!design || design.contract !== 1) throw fail(400, 'design with contract 1 required')
      // the plan as saved here, on the lot as the office rebuilds it, must pass the rules
      const current = await store.versions.get(p.id, p.version)
      const rules = checkRules(current?.rooms || [], p.program || {}, styleOf(p), await lots.lotOfProject(p))
      if (!rules.ok) throw fail(409, `the plan breaks ${rules.reasons.length} rule${rules.reasons.length === 1 ? '' : 's'}: ${rules.reasons[0]}`, { rules: rules.reasons })
      const d = await saveDesign({ ...design, client: design.client || p.client, projectId: p.id }, ifc, { projectId: p.id })
      p.designId = d.id
      p.status = 'in_review'
      p.sentAt = now()
      p.updatedAt = p.sentAt
      await store.projects.put(p)
      await event('project', `${p.client}: design sent for review`, { projectId: p.id, designId: d.id })
      return this.detail(p)
    },

    // drafter inbox: waiting first, then recent decisions, plus plat lots nobody has confirmed
    async inbox() {
      const waiting = await store.projects.listByStatus(['in_review'])
      const recent = await store.projects.listByStatus(['returned', 'approved', 'built'], 30)
      const open = await store.projects.listByStatus(['drafting', 'returned', 'in_review'], 200)
      const lots = open.filter((p) => p.lot?.spec?.kind === 'plat' && !p.lot.spec.confirmed)
      return { waiting, recent, lots }
    },

    // a drafter confirms the lot read from a plat, with corrected calls or setbacks when needed
    async confirmLot(p, drafter, { confirmed = true, spec, note }) {
      if (p.lot?.spec?.kind !== 'plat') throw fail(409, 'this lot was typed in, nothing to confirm')
      const next = { ...p.lot.spec, ...(spec || {}), kind: 'plat', confirmed: !!confirmed, confirmedBy: confirmed ? drafter.email : null, confirmedAt: confirmed ? now() : null, confirmNote: note || null }
      const lot = { ...(await lots.lotOfProject({ lot: { spec: next, plat: p.lot.plat } })), plat: p.lot.plat || null }
      const changed = spec && JSON.stringify(spec) !== '{}'
      p.lot = lot
      p.address = lot.address || p.address
      p.updatedAt = now()
      if (changed) {
        // the plan keeps its shape; its place on the lot follows the corrected lot
        const cur = await store.versions.get(p.id, p.version)
        const style = styleOf(p)
        const placed = replaceOnLot(cur?.rooms || [], kitFor(style), p.program?.stories || 1, lot)
        p.version += 1
        await store.versions.add({ projectId: p.id, n: p.version, at: p.updatedAt, kind: 'lot', text: 'Lot corrected by the drafter', credit: 0, rooms: placed })
      }
      await store.projects.put(p)
      await event('project', `${p.client}: lot ${confirmed ? 'confirmed' : 'sent back'} by ${drafter.name || drafter.email}${changed ? ' with corrections' : ''}`, { projectId: p.id })
      return this.detail(p)
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
