// Saved projects: lot, style, program, every version of the rooms, credits, the drafter review.
// A change runs here, not in the browser: Claude (or the basic rules when it is unavailable),
// then the plan rules, and a credit is taken only when the change is applied.
import crypto from 'node:crypto'
import { decide, unsupported, editsOf } from '../src/draft/lib/interpret.js'
import { regexOps, summarizeRooms, replaceOnLot } from '../src/draft/lib/ops.js'
import { kitFor, programOf } from '../src/draft/lib/layout.js'
import { checkRules } from '../src/draft/lib/rules.js'
import { auditSummary } from '../src/draft/lib/audit.js'
import { RATES } from '../src/draft/lib/pricing.js'
import { STYLES } from '../src/draft/lib/styles.js'

const id = (p) => p + '_' + crypto.randomBytes(5).toString('hex')
const now = () => new Date().toISOString()
const fail = (status, error, extra = {}) => Object.assign(new Error(error), { status, ...extra })
export const EDITABLE = ['drafting', 'returned']

export function makeProjects({ env = process.env, store, interpreter, event, logInterpret, lots }) {

  const styleOf = (p) => STYLES.find((s) => s.id === p.style?.id) || STYLES.find((s) => s.ready)
  const publicProject = (p, extra = {}) => ({ ...p, ...extra })
  // what a homeowner sees of a review: the decision and the note written to them; the override and the
  // audit it covered stay in the office
  const clientReview = (r) => (r ? { id: r.id, projectId: r.projectId, drafter: r.drafter, decision: r.decision, note: r.note, at: r.at, overridden: !!r.override } : r)
  /**
   * Every project payload a homeowner receives (the list, the detail, what create/update/send/rollback
   * return) goes through this one view: no audit, no office questions, no override notes or the errors
   * they covered, no drafter ids, no plat-reader or lot-confirmation notes written for the office.
   */
  const ownerView = (p) => {
    if (!p) return p
    const { audit, questions, auditErrors, review, reviews, lot, ...rest } = p
    const spec = lot?.spec ? (({ confirmedBy, confirmNote, ...keep }) => keep)(lot.spec) : lot?.spec
    const plat = lot?.plat ? (({ notes, readNotes, ...keep }) => keep)(lot.plat) : lot?.plat
    return { ...rest, lot: lot ? { ...lot, spec, plat: plat ?? null } : lot, review: clientReview(review), ...(reviews ? { reviews: reviews.map(clientReview) } : {}) }
  }
  const auditCache = new Map() // project id + version → the audit of that version (the rooms do not change under a version)

  const asBuiltCache = new Map()
  async function withRooms(p) {
    const v = await store.versions.get(p.id, p.version)
    return { ...p, rooms: v?.rooms || [] }
  }
  // the architect audit of the current version, with the open questions a drafter settles by hand
  function auditOf(full) {
    if (!full.rooms?.length || !full.program) return null
    try {
      const style = styleOf(full)
      const a = auditSummary(full.rooms, full.program, kitFor(style), full.lot)
      const questions = []
      if (!RATES.confirmed) questions.push('Price rates are not confirmed yet (src/draft/lib/pricing.js): the client saw an estimate, not a quote.')
      if (full.lot?.spec?.kind === 'plat' && !full.lot.spec.confirmed) questions.push('The lot was read from a plat and is not confirmed.')
      if (full.lot?.spec?.kind === 'parcel' && !full.lot.spec.confirmed) questions.push('The lot came from the appraisal district parcel map and is not confirmed against a plat or survey.')
      if (full.lot?.flags?.length) questions.push(...full.lot.flags.map((f) => `Lot rules: ${f}`))
      if (full.lot?.zoning?.residential === false) questions.push(`Zoning: ${full.lot.zoning.district} (${full.lot.zoning.use}); a house may need a rezoning.`)
      if (full.lot?.assumed) questions.push('The lot size was assumed, not measured.')
      const kit = kitFor(style)
      if (Object.values(kit.windows || {}).some((w) => w?.energy === 'CONFIRM')) questions.push('Window U-factor and SHGC in the kit are marked CONFIRM against the supplier.')
      return { ...a, questions }
    } catch (e) {
      return { ok: false, errors: 1, warnings: 0, groups: [], questions: [`The audit could not run: ${e.message}`] }
    }
  }

  return {
    ownerView,
    /** A lot spec the office cannot build is refused at the door, not on the first change. */
    async checkLot(lot) {
      if (!lot?.spec || lot.spec.kind === 'reference') return
      try {
        const spec = lot.spec
        // a typed lot needs a real width and depth (the builder would quietly fall back to a default otherwise)
        if (spec.kind === 'manual' && !(Number(spec.width) >= 20 && Number(spec.depth) >= 20 && Number(spec.width) <= 5000 && Number(spec.depth) <= 5000)) throw new Error('width and depth')
        // a plat needs its boundary calls, unless a drafter has already confirmed the lot by hand
        if ((spec.kind === 'plat' || spec.kind === 'parcel') && !spec.confirmed && !(Array.isArray(spec.calls) && spec.calls.length >= 3) && !(Array.isArray(spec.corners) && spec.corners.length >= 3)) throw new Error('no boundary')
        // a parcel from the appraisal district: at least three sides, closing within 1.5 ft (round 7, item 7)
        if (spec.kind === 'parcel' && !(Array.isArray(spec.calls) && spec.calls.length >= 3)) throw new Error('parcel needs three sides')
        const built = await lots.lotOfProject({ lot })
        // a lot that builds to no boundary or no buildable area is refused; one the office has not built
        // (a stubbed lot service hands the spec back) has nothing to check here
        const degenerate = (pts) => Array.isArray(pts) && pts.length < 3
        if (!built || degenerate(built.boundary) || degenerate(built.envelope) || (built.envelopeSf !== undefined && !(built.envelopeSf > 0))) throw new Error('no buildable area')
        if (spec.kind === 'parcel' && built.closure > 1.5) throw new Error(`parcel does not close (${built.closure} ft)`)
      } catch (e) {
        throw fail(400, `the lot cannot be built from what was sent (${lot.spec.kind || 'no kind'}${lot.spec.width !== undefined || lot.spec.depth !== undefined ? `, ${lot.spec.width ?? '?'} x ${lot.spec.depth ?? '?'}` : ''}): give it a width and depth, or an address, or a plat with its boundary calls`)
      }
    },
    async create(user, body) {
      if (!Array.isArray(body.rooms) || !body.rooms.length) throw fail(400, 'rooms required')
      if (!body.style?.id) throw fail(400, 'style required')
      await this.checkLot(body.lot)
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
    // the owner's view carries no audit, office questions or override notes; the drafter's carries them all
    async detail(p, { drafter = false } = {}) {
      const [full, versions, reviews, job, owner] = await Promise.all([withRooms(p), store.versions.list(p.id), store.reviews.list(p.id), p.jobId ? store.jobs.get(p.jobId) : null, store.users.get(p.userId)])
      const jobView = job ? { id: job.id, status: job.status, steps: job.steps?.slice(-1), outputs: job.outputs, error: job.error, warnings: job.warnings } : null
      if (!drafter) return ownerView(publicProject(full, { credits: owner?.credits ?? 0, versions, reviews, job: jobView }))
      return publicProject(full, { credits: owner?.credits ?? 0, versions, reviews, audit: this.auditCached(full), job: jobView })
    },
    auditCached(full) {
      const key = `${full.id}:${full.version}:${full.lot?.updatedAt || ''}:${JSON.stringify(full.program || {})}`
      if (!auditCache.has(key)) {
        if (auditCache.size > 500) auditCache.clear()
        auditCache.set(key, auditOf(full))
      }
      return auditCache.get(key)
    },

    // lot, style, program, and (when the program changed) regenerated rooms as a free version
    async update(p, body) {
      if (!EDITABLE.includes(p.status)) throw fail(409, 'the design is with the drafters; it cannot change now')
      if (body.lot) {
        await this.checkLot(body.lot)
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
      const no = unsupported(request, style)
      if (no) {
        logInterpret({ request, client: p.email, projectId: p.id, source: 'fallback', verdict: 'unsupported', reply: no, ops: [] })
        return { applied: false, reply: no, source: 'fallback', reasons: ['unsupported'], fixes: [], credits: owner.credits, version: p.version }
      }
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
      // the client's edits so far, so a re-draft (a new size, a garage the plan cannot add in place) puts them back
      const edits = editsOf(await store.versions.list(p.id))
      const result = decide(diff, rooms, p.program, style, kit, source, lot, { history: edits })
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
      if ((p.lot?.spec?.kind === 'plat' || p.lot?.spec?.kind === 'parcel') && !p.lot.spec.confirmed) throw fail(409, 'a drafter has not confirmed your lot yet; it is in their queue', { lotPending: true })
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
      // the counts a drafter reads come from the plan as it is, not the program the client started with;
      // a version never changes once saved, so its counts are read once (asBuiltCache, keyed by project and version)
      const asBuilt = async (list) =>
        Promise.all(
          list.map(async (p) => {
            const key = `${p.id}:${p.version}`
            let got = asBuiltCache.get(key)
            if (!got) {
              got = programOf((await withRooms(p)).rooms, p.program || {})
              asBuiltCache.set(key, got)
              if (asBuiltCache.size > 2000) asBuiltCache.delete(asBuiltCache.keys().next().value)
            }
            return { ...p, asBuilt: got }
          }),
        )
      const waiting = await asBuilt(await store.projects.listByStatus(['in_review']))
      const recent = await asBuilt(await store.projects.listByStatus(['returned', 'approved', 'built'], 30))
      const open = await store.projects.listByStatus(['drafting', 'returned', 'in_review'], 200)
      const lots = open.filter((p) => (p.lot?.spec?.kind === 'plat' || p.lot?.spec?.kind === 'parcel') && !p.lot.spec.confirmed)
      return { waiting, recent, lots }
    },

    // a drafter confirms the lot read from a plat, with corrected calls or setbacks when needed
    async confirmLot(p, drafter, { confirmed = true, spec, note }) {
      if (p.lot?.spec?.kind !== 'plat' && p.lot?.spec?.kind !== 'parcel') throw fail(409, 'this lot was typed in, nothing to confirm')
      const next = { ...p.lot.spec, ...(spec || {}), kind: p.lot.spec.kind === 'parcel' ? 'parcel' : 'plat', confirmed: !!confirmed, confirmedBy: confirmed ? drafter.email : null, confirmedAt: confirmed ? now() : null, confirmNote: note || null }
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
      return this.detail(p, { drafter: true })
    },

    // approve → queue the Revit build; return → back to the client with a note
    async review(p, drafter, { decision, note, override }, queueJob) {
      if (p.status !== 'in_review') throw fail(409, `this design is ${p.status.replace('_', ' ')}, not waiting for review`)
      if (!['approved', 'returned'].includes(decision)) throw fail(400, 'decision must be approved or returned')
      const t = now()
      // the note is written to the client; the override note (below) stays in the office
      const r = { id: id('rev'), projectId: p.id, drafterId: drafter.id, drafter: drafter.name || drafter.email, decision, note: String(note || '').trim().slice(0, 2000), at: t }
      // a plan with audit errors is approved only over an override note of its own, 20 characters at least,
      // stored with who wrote it, when, and which errors it covered
      if (decision === 'approved') {
        const audit = this.auditCached(await withRooms(p))
        if (audit && !audit.ok) {
          const why = String(override || '').trim().slice(0, 2000)
          if (why.length < 20) throw fail(409, `the plan has ${audit.errors} audit error${audit.errors === 1 ? '' : 's'}; fix them, or approve with an override note of at least 20 characters`)
          const errors = audit.groups.flatMap((g) => g.errors)
          r.override = { note: why, by: r.drafter, byId: drafter.id, at: t, errors }
          await event('project', `${p.client}: approved over ${audit.errors} audit error${audit.errors === 1 ? '' : 's'} by ${r.drafter}: "${why.slice(0, 80)}"`, { projectId: p.id, override: true })
        }
      }
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
      return this.detail(p, { drafter: true })
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
