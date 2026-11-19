// Saved projects: lot, style, program, every version of the rooms, the change allowance, the drafter review.
// A change runs here, not in the browser: Claude (or the basic rules when it is unavailable),
// then the plan rules, and one change of the plan's allowance is used only when it is applied.
// Money never reaches a homeowner from here (round 8, P0b): the office estimate is drafter-only and
// ownerView strips every price-shaped field as a backstop.
import crypto from 'node:crypto'
import { zoningBlocksSend } from '../src/draft/lib/lot.js'
import { decide, dropUnsupported, editsOf, netsToNothing } from '../src/draft/lib/interpret.js'
import { regexOps, summarizeRooms, replaceOnLot, splitCost, costReply } from '../src/draft/lib/ops.js'
import { kitFor, programOf, floorArea } from '../src/draft/lib/layout.js'
import { checkRules } from '../src/draft/lib/rules.js'
import { auditSummary } from '../src/draft/lib/audit.js'
import { RATES, estimate, range, rateLine, estimateLines } from '../src/draft/lib/pricing.js'
import { takeoff } from '../src/draft/lib/takeoff.js'
import { STYLES } from '../src/draft/lib/styles.js'

const id = (p) => p + '_' + crypto.randomBytes(5).toString('hex')
const now = () => new Date().toISOString()
const fail = (status, error, extra = {}) => Object.assign(new Error(error), { status, ...extra })
export const EDITABLE = ['drafting', 'returned']
// what the office tells a homeowner who asks for a meeting, or for more changes (round 8, M4/M8)
export const OFFICE_PHONE = '(956) 594-6936'
export const MEETING_THANKS = `Thanks! The office will reach out within 1 business day. You can also call ${OFFICE_PHONE}.`
export const MORE_CHANGES_THANKS = `Done. The office has your request and usually adds more within 1 business day. You can also call ${OFFICE_PHONE}.`
export const OUT_OF_CHANGES = "You've used the free changes on this plan. The office will add more for you. Want me to let them know?"
export const REQUEST_KINDS = ['meeting', 'more-changes']

export function makeProjects({ env = process.env, store, interpreter, event, logInterpret, lots, alerts = null, parcels = null, zoning = null }) {
  // free changes a new plan starts with; the office changes the default on the dashboard (store.meta)
  const DEFAULT_ALLOWANCE = (() => {
    const n = Number(env.CHANGES_PER_PROJECT ?? env.CREDITS_PER_PROJECT ?? 10)
    return Number.isInteger(n) && n >= 1 && n <= 50 ? n : 10
  })()
  const okAllowance = (n) => Number.isInteger(n) && n >= 1 && n <= 50
  async function allowanceDefault() {
    const v = await store.meta.get('allowance:default')
    const n = Number(v?.value ?? v)
    return okAllowance(n) ? n : DEFAULT_ALLOWANCE
  }

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
  // no money either: no price, estimate, cost, rate, parts or flatwork dollars, no Claude-usage cost, and
  // of the allowance only the counts (never the log or who granted it)
  const MONEY_KEY = /^(price|estimate|cost|perSf|parts|rates|flatwork\$|usage|credits|creditsUsed|allowanceLog|meetingRequests)$/
  const ownerView = (p) => {
    if (!p) return p
    const { audit, questions, auditErrors, review, reviews, lot, ...rest } = p
    for (const k of Object.keys(rest)) if (MONEY_KEY.test(k)) delete rest[k]
    const spec = lot?.spec ? (({ confirmedBy, confirmNote, ...keep }) => keep)(lot.spec) : lot?.spec
    const plat = lot?.plat ? (({ notes, readNotes, ...keep }) => keep)(lot.plat) : lot?.plat
    const allowed = p.changesAllowed ?? DEFAULT_ALLOWANCE
    const used = p.changesUsed ?? p.creditsUsed ?? 0
    return { ...rest, changesAllowed: allowed, changesUsed: used, changesLeft: Math.max(0, allowed - used), lot: lot ? { ...lot, spec, plat: plat ?? null } : lot, review: clientReview(review), ...(reviews ? { reviews: reviews.map(clientReview) } : {}) }
  }
  /**
   * The allowance lives on the plan (round 8, M7). A plan saved before that gets the default on first read,
   * and once per plan any balance the account still held is mapped onto it so nobody loses changes: the
   * mapping is logged on the plan and in the activity; the account record is left as it was.
   */
  async function withAllowance(p) {
    if (!p || (p.changesAllowed !== undefined && p.changesUsed !== undefined)) return p
    const used = p.changesUsed ?? p.creditsUsed ?? 0
    let allowed = await allowanceDefault()
    const log = Array.isArray(p.allowanceLog) ? [...p.allowanceLog] : []
    const owner = await store.users.get(p.userId)
    const balance = Math.max(0, Math.round(owner?.credits || 0))
    if (balance && EDITABLE.includes(p.status) && used + balance > allowed) {
      log.push({ at: now(), by: 'migration', add: used + balance - allowed, note: `account balance of ${balance} mapped onto this plan`, before: allowed, after: used + balance })
      allowed = used + balance
    }
    p.changesAllowed = allowed
    p.changesUsed = used
    p.allowanceLog = log
    delete p.creditsUsed
    await store.projects.put(p)
    if (log.length && log[log.length - 1].by === 'migration') await event('project', `${p.client}: allowance set to ${allowed} (the account balance of ${balance} was mapped onto the plan)`, { projectId: p.id })
    return p
  }
  const changesLeft = (p) => Math.max(0, (p.changesAllowed ?? DEFAULT_ALLOWANCE) - (p.changesUsed ?? 0))
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
      if (!RATES.confirmed) questions.push('Rates are not confirmed yet (src/draft/lib/pricing.js): the office estimate is a range, not a quote. The client sees no number.')
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
    allowanceDefault,
    /** The office sets the free changes a new plan starts with (1–50); existing plans keep theirs. */
    async setAllowanceDefault(n, by) {
      if (!okAllowance(n)) throw fail(400, 'the default must be a whole number from 1 to 50')
      await store.meta.set('allowance:default', { value: n, by: by?.email || 'office', at: now() })
      await event('project', `${by?.email || 'the office'} set the free changes for new plans to ${n}`)
      return { default: n }
    },
    /**
     * The zoning of a parcel lot, read by the server (round 11, item 1): the district at the interior point of the
     * parcel the lot names, from the server's own copy of that parcel, in the city the server geocoded the address to.
     * Nothing here comes from the browser but the parcel's id and the address. null for a lot that is not a parcel;
     * an "unknown" record when it could not be read (the drafter's confirmation reads it again). mayLookup says whether
     * an outside call may be made for it now (the homeowner's lookup limit); a drafter's read always may.
     */
    async readZoning(spec, { mayLookup = () => true } = {}) {
      if (!zoning || !parcels || spec?.kind !== 'parcel' || spec.propId == null || spec.propId === '') return null
      const unread = (reason) => ({ status: 'unknown', district: null, residential: null, reason, readBy: 'server', at: now() })
      let allowed
      const may = () => (allowed ??= !!mayLookup())
      try {
        let rec = spec.address ? await parcels.cached(spec.address) : null
        if (!rec || String(rec.propId) !== String(spec.propId)) {
          const county = spec.county || rec?.county
          if (!county) return unread('no county on the lot; the drafter reads the zoning')
          rec = (await parcels.byId({ county, propId: spec.propId, cachedOnly: true }).catch(() => null)) || (may() ? await parcels.byId({ county, propId: spec.propId }) : null)
        }
        if (!rec?.interior) return unread('the parcel was not read; the zoning is read when the drafter confirms the lot')
        const geo = spec.address ? (await lots.geocodeCached?.(spec.address)) || (may() ? await lots.geocode(spec.address).catch(() => null) : null) : null
        const cityId = geo?.found ? geo.cityId || '' : spec.city || ''
        const z = await zoning.lookup({ cityId, lat: rec.interior.lat, lon: rec.interior.lon })
        const { raw, cached, ...keep } = z
        return { ...keep, propId: String(spec.propId), readBy: 'server' }
      } catch (e) {
        return unread(e?.status === 502 ? String(e.message) : 'the zoning could not be read; the drafter reads it')
      }
    },
    /**
     * A lot as a homeowner's browser may send it (rounds 10 and 11): the drafter's marks and the zoning are never
     * taken from the browser. A confirmed lot keeps its confirmation, and any lot its stored zoning, only while its
     * outline (and the parcel it names) is the one already stored. A parcel lot that is new or changed gets its zoning
     * from the server's own read; a typed lot has none until a drafter confirms one.
     */
    async ownerLot(lot, prev = null, { mayLookup } = {}) {
      if (!lot?.spec || typeof lot.spec !== 'object') return lot
      const { confirmedBy, confirmedAt, confirmNote, zoning: fromBrowser, ...spec } = lot.spec
      const was = prev?.spec || null
      const sameOutline = !!was && was.kind === spec.kind && JSON.stringify(was.calls || null) === JSON.stringify(spec.calls || null) && String(was.propId ?? '') === String(spec.propId ?? '')
      if (spec.kind === 'plat' || spec.kind === 'parcel') {
        if (sameOutline && was.confirmed) Object.assign(spec, { confirmed: true, confirmedBy: was.confirmedBy || null, confirmedAt: was.confirmedAt || null, confirmNote: was.confirmNote || null, setbacks: was.setbacks || spec.setbacks })
        else spec.confirmed = false
      }
      if (sameOutline && was.zoning) spec.zoning = was.zoning
      else if (was?.zoning?.confirmedBy && was.kind === spec.kind && spec.kind === 'manual') spec.zoning = was.zoning // a drafter's zoning on a typed lot stays with the plan
      else spec.zoning = spec.kind === 'parcel' ? await this.readZoning(spec, { mayLookup }) : null
      return { ...lot, spec, zoning: spec.zoning || null, ...(spec.kind === 'plat' || spec.kind === 'parcel' ? { confirmed: !!spec.confirmed } : {}) }
    },
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
        changesAllowed: await allowanceDefault(),
        changesUsed: 0,
        allowanceLog: [],
        version: 1,
        createdAt: t,
        updatedAt: t,
      }
      await store.projects.add(p)
      await store.versions.add({ projectId: p.id, n: 1, at: t, kind: 'initial', text: 'First draft', used: 0, rooms: body.rooms })
      await event('project', `${p.client}: started a ${p.style.name} on ${p.address || 'a lot'}`, { projectId: p.id })
      return this.detail(p)
    },

    // the owner, or a drafter; 404 for anyone else so ids cannot be probed
    async load(user, projectId, { drafter = false } = {}) {
      const p = await store.projects.get(projectId)
      if (!p || (p.userId !== user.id && !drafter)) throw fail(404, 'project not found')
      return withAllowance(p)
    },
    /** A homeowner's own plans, as the owner sees them. */
    async list(user) {
      const all = await store.projects.listForUser(user.id)
      return Promise.all(all.map(async (p) => ownerView(await withAllowance(p))))
    },

    // the allowance lives on the plan: what it may use and what it used
    // the owner's view carries no audit, office questions, override notes or money; the drafter's carries them all
    async detail(p, { drafter = false } = {}) {
      await withAllowance(p)
      const [full, versions, reviews, job] = await Promise.all([withRooms(p), store.versions.list(p.id), store.reviews.list(p.id), p.jobId ? store.jobs.get(p.jobId) : null])
      const jobView = job ? { id: job.id, status: job.status, steps: job.steps?.slice(-1), outputs: job.outputs, error: job.error, warnings: job.warnings } : null
      if (!drafter) return ownerView(publicProject(full, { versions, reviews, job: jobView }))
      return publicProject(full, { versions, reviews, audit: this.auditCached(full), job: jobView, changesLeft: changesLeft(full) })
    },
    /**
     * The office estimate for a plan (round 8, M2): the range, the rate line, the parts and the takeoff.
     * Drafters and admins only; a homeowner never receives it (the route answers 403).
     */
    async estimateFor(p, { upgrades = null } = {}) {
      const full = await withRooms(p)
      const style = styleOf(p)
      const kit = kitFor(style)
      const lot = await lots.lotOfProject(p)
      const est = estimate({ rooms: full.rooms, program: full.program || {}, style, lot, upgrades })
      return { ...est, range: range(est), rateLine: rateLine(est), lines: estimateLines(est), notes: est.lines, upgradeChoices: Object.keys(RATES.upgrades).map((id) => ({ id, label: RATES.upgradeNames[id] || id, perSf: Array.isArray(RATES.upgrades[id]) ? RATES.upgrades[id] : [RATES.upgrades[id], RATES.upgrades[id]], on: est.upgrades.some((u) => u.id === id) })), takeoff: takeoff(full.rooms, full.program || {}, kit, lot), internal: 'Internal: not for the client', rooms: full.rooms, program: full.program, style: p.style, lot: p.lot, client: p.client, address: p.address, createdAt: p.createdAt }
    },
    /** The office adds changes to a plan (round 8, M7): 1–50 at a time, logged with who, before and after. */
    async grantAllowance(p, drafter, { add, note }) {
      if (!okAllowance(add)) throw fail(400, 'add must be a whole number from 1 to 50')
      const before = p.changesAllowed
      const after = before + add
      const entry = { at: now(), by: drafter.email, add, note: String(note || '').slice(0, 200), before, after }
      p.changesAllowed = after
      p.allowanceLog = [...(p.allowanceLog || []), entry]
      p.wantsMoreChanges = false
      p.updatedAt = entry.at
      await store.projects.put(p)
      await event('project', `${p.client}: ${drafter.email} added ${add} change${add === 1 ? '' : 's'} (${before} → ${after})${entry.note ? ` — ${entry.note}` : ''}`, { projectId: p.id })
      return this.detail(p, { drafter: true })
    },
    /**
     * A homeowner asks the office for a meeting, or for more changes (round 8, M4/M8). Stored on the plan,
     * written to the activity, emailed to ALERT_EMAIL_TO when it is set. The answer carries the office phone.
     */
    async requestMeeting(p, { note = '', kind = 'meeting' } = {}) {
      if (!REQUEST_KINDS.includes(kind)) throw fail(400, `kind must be one of ${REQUEST_KINDS.join(', ')}`)
      const t = now()
      const req = { at: t, note: String(note || '').trim().slice(0, 500), kind }
      p.meetingRequest = req
      p.meetingRequests = [...(p.meetingRequests || []), req].slice(-20)
      if (kind === 'more-changes') p.wantsMoreChanges = true
      p.updatedAt = t
      await store.projects.put(p)
      const what = kind === 'more-changes' ? `wants more changes (${p.changesUsed ?? 0} of ${p.changesAllowed ?? DEFAULT_ALLOWANCE} used)` : 'asked for a meeting with the office'
      await event('request', `${p.client}: ${what}${req.note ? ` — "${req.note.slice(0, 80)}"` : ''}`, { projectId: p.id, request: kind })
      if (alerts) {
        const subject = kind === 'more-changes' ? `Draft House: ${p.client} wants more changes` : `Draft House: ${p.client} asked for a meeting`
        const body = `${p.client} (${p.email})${p.address ? `, ${p.address}` : ''} ${what}.\n${req.note ? `Note: ${req.note}\n` : ''}Plan ${p.id}, version ${p.version}. Open the review inbox to ${kind === 'more-changes' ? 'add changes' : 'see the plan'}.`
        alerts.email(subject, body).catch(() => {})
      }
      return { ok: true, kind, at: t, message: kind === 'more-changes' ? MORE_CHANGES_THANKS : MEETING_THANKS }
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
        await store.versions.add({ projectId: p.id, n: p.version, at: p.updatedAt, kind: 'program', text: body.note || 'Rooms changed', used: 0, rooms: body.rooms })
      }
      await store.projects.put(p)
      return this.detail(p)
    },

    /** The program as the drawn plan has it: counts from the rooms, the living area to 50 sf, the first ask kept in `asked`. */
    followPlan(program, rooms) {
      const got = programOf(rooms, program || {})
      const stories = program?.stories || 1
      const { asked: _a, livingSf: _l, halfBaths: _h, ...counts } = got
      const first = program?.asked || (program ? { ...program, asked: undefined } : null)
      return { ...program, ...counts, stories, sqft: Math.round(floorArea(rooms, stories) / 50) * 50, asked: first }
    },

    // one plain-language request → Claude or the basic rules → plan rules → one change used only if applied.
    // With `ops` (a fix the client clicked), the ops are taken as given and only the rules run.
    // A cost question never reaches the model and never uses a change: the answer points to the meeting (M3).
    async change(p, text, fixOps = null) {
      if (!EDITABLE.includes(p.status)) throw fail(409, 'the design is with the drafters; it cannot change now')
      const request = String(text || '').trim().slice(0, 500)
      if (!request) throw fail(400, 'text required')
      const left = changesLeft(p)
      const counts = () => ({ changesLeft: changesLeft(p), changesAllowed: p.changesAllowed, changesUsed: p.changesUsed })
      const costQ = Array.isArray(fixOps) && fixOps.length ? { text: request, cost: false } : splitCost(request)
      if (costQ.cost && !costQ.text) {
        const reply = costReply(costQ)
        logInterpret({ request, client: p.email, projectId: p.id, source: 'fallback', verdict: 'cost', reply, ops: [] })
        return { applied: false, reply, source: 'fallback', reasons: ['cost question'], fixes: [], askOffice: 'meeting', ...counts(), version: p.version }
      }
      const style = styleOf(p)
      const kit = kitFor(style)
      const current = await store.versions.get(p.id, p.version)
      const rooms = current?.rooms || []
      const kitMeta = { id: kit.id, name: kit.name, kinds: Object.fromEntries(Object.entries(kit.rooms).map(([k, t]) => [k, { name: t.name, w: t.w, d: t.d, zone: t.zone }])), minSize: kit.rules?.minSize || {} }
      const lot = await lots.lotOfProject(p)
      let diff
      let source = 'claude'
      let meta = {}
      // "undo", "go back": the previous version, at no change (the change it used comes back); works at 0 left
      if (/^\s*(undo( that| it| the last( change| one)?)?|go back( one| a step)?|put it back|take (that|it) back|revert( that)?)\s*[.!]?\s*$/i.test(request)) {
        if (p.version <= 1) return { applied: false, reply: 'There is nothing to undo yet.', source: 'fallback', reasons: ['nothing to undo'], fixes: [], ...counts(), version: p.version }
        const before = p.version
        const back = await this.rollback(p, p.version - 1)
        logInterpret({ request, client: p.email, projectId: p.id, source: 'fallback', verdict: 'undo', reply: back.reply, ops: [] })
        return { applied: true, undo: true, reply: `Back to version ${before - 1}.${back.refunded ? ` ${back.refunded} change${back.refunded === 1 ? '' : 's'} returned.` : ' No change used.'}`, source: 'fallback', rooms: back.rooms, changesLeft: back.changesLeft, changesAllowed: back.changesAllowed, changesUsed: back.changesUsed, version: back.version, project: back, ops: [] }
      }
      // "make the kitchen bigger and then make it smaller": the two parts cancel; said so, and no change is used
      // (round 10, item 8: the app's own chat goes through here, and this check was only on the offline path)
      const net = Array.isArray(fixOps) && fixOps.length ? null : netsToNothing(costQ.text, rooms, kit)
      if (net) {
        logInterpret({ request, client: p.email, projectId: p.id, source: 'fallback', verdict: 'no change', reply: net, ops: [] })
        return { applied: false, noop: true, reply: net, source: 'fallback', reasons: ['no change'], fixes: [], ...counts(), version: p.version }
      }
      // what this style cannot take is set aside clause by clause: the rest goes through, the dropped part is named
      const split = dropUnsupported(costQ.text, style)
      if (!split.text) {
        const no = split.dropped.map((d) => d.why).join(' ')
        logInterpret({ request, client: p.email, projectId: p.id, source: 'fallback', verdict: 'unsupported', reply: no, ops: [] })
        return { applied: false, reply: no, source: 'fallback', reasons: ['unsupported'], fixes: [], ...counts(), version: p.version }
      }
      // out of changes: nothing is applied and nothing is used; the answer offers to tell the office (M8)
      if (left <= 0) {
        logInterpret({ request, client: p.email, projectId: p.id, source: 'fallback', verdict: 'out of changes', reply: OUT_OF_CHANGES, ops: [] })
        return { applied: false, reply: OUT_OF_CHANGES, source: 'fallback', reasons: ['out of changes'], fixes: [], askOffice: 'more-changes', outOfChanges: true, ...counts(), version: p.version }
      }
      const asked = split.text
      if (Array.isArray(fixOps) && fixOps.length) {
        diff = { ops: fixOps.slice(0, 8), reply: '', confidence: 1 } // the answer says what was done, not the button's question
        source = 'fix'
      } else
      try {
        diff = await interpreter.ask({ request: asked, program: p.program, kit: kitMeta, rooms: summarizeRooms(rooms) })
        meta = { usage: diff.usage, cost: diff.cost, ms: diff.ms, model: diff.model }
        logInterpret({ request, client: p.email, projectId: p.id, rooms: rooms.length, diff: { ops: diff.ops, reply: diff.reply, confidence: diff.confidence }, verdict: diff.confidence < 0.5 || !diff.ops.length ? 'unsure' : 'diff', ...meta })
      } catch (e) {
        if (!e.unconfigured) logInterpret({ request, client: p.email, projectId: p.id, verdict: e.timeout ? 'timeout' : e.refusal ? 'refusal' : 'error', error: String(e.message).slice(0, 200), ms: e.ms, cost: e.cost, usage: e.usage, model: interpreter.model })
        diff = regexOps(asked, rooms, kit, lot)
        source = e.timeout ? 'timeout' : 'fallback'
      }
      // the client's edits so far, so a re-draft (a new size, a garage the plan cannot add in place) puts them back
      const edits = editsOf(await store.versions.list(p.id))
      const result = decide(diff, rooms, p.program, style, kit, source, lot, { history: edits, unsupported: split.dropped })
      logInterpret({ request, client: p.email, projectId: p.id, source, verdict: result.applied ? 'applied' : 'rejected', reasons: result.reasons || [], reply: result.reply, ops: result.ops })
      // a cost question beside a change: the change goes through, the answer ends with the cost sentence (M3)
      const costTail = costQ.cost ? { reply: `${String(result.reply || '').trim().replace(/\s+$/, '')} ${costReply(costQ)}`.trim(), askOffice: 'meeting' } : {}
      if (!result.applied) return { applied: false, reply: result.reply, source, reasons: result.reasons || [], caused: result.caused, preexisting: result.preexisting, fixes: result.fixes || [], ...counts(), version: p.version, ...costTail }
      const n = p.version + 1
      const t = now()
      await store.versions.add({ projectId: p.id, n, at: t, kind: 'change', text: request, used: 1, rooms: result.rooms, reply: result.reply, source, ops: result.ops, did: result.did })
      p.program = this.followPlan(p.program, result.rooms) // the stored program follows the drawn plan (round 8)
      p.version = n
      p.changesUsed = (p.changesUsed || 0) + 1
      p.updatedAt = t
      await store.projects.put(p)
      await event('project', `${p.client}: "${request.slice(0, 60)}" applied (${source}), ${changesLeft(p)} of ${p.changesAllowed} change${p.changesAllowed === 1 ? '' : 's'} left`, { projectId: p.id })
      // the Claude usage and its cost stay in the log and the activity (office-only); the owner gets the plan
      return { applied: true, reply: result.reply, source, rooms: result.rooms, ...counts(), version: n, did: result.did, ops: result.ops, ms: meta.ms, ...costTail }
    },

    // back to any earlier version; the changes used on the versions after it come back to the plan
    async rollback(p, target) {
      if (!EDITABLE.includes(p.status)) throw fail(409, 'the design is with the drafters; it cannot change now')
      const k = +target
      const want = await store.versions.get(p.id, k)
      if (!want) throw fail(404, 'no such version')
      if (k === p.version) return this.detail(p)
      const all = await store.versions.list(p.id)
      let refund = 0
      for (const v of all) {
        const used = v.used ?? v.credit ?? 0
        if (v.n > k && used && !v.refunded) {
          refund += used
          await store.versions.put({ ...(await store.versions.get(p.id, v.n)), refunded: true })
        }
      }
      const t = now()
      p.version += 1
      p.changesUsed = Math.max(0, (p.changesUsed || 0) - refund)
      p.updatedAt = t
      await store.versions.add({ projectId: p.id, n: p.version, at: t, kind: 'rollback', text: `Back to version ${k}`, rollbackOf: k, used: 0, rooms: want.rooms })
      p.program = this.followPlan(p.program, want.rooms)
      await store.projects.put(p)
      await event('project', `${p.client}: back to version ${k}${refund ? `, ${refund} change${refund === 1 ? '' : 's'} returned` : ''}`, { projectId: p.id })
      return { ...(await this.detail(p)), refunded: refund }
    },

    // the client hands the design to the drafters; nothing is built until a drafter approves
    async send(p, { design, ifc }, saveDesign) {
      if (!EDITABLE.includes(p.status)) throw fail(409, `already ${p.status.replace('_', ' ')}`)
      if ((p.lot?.spec?.kind === 'plat' || p.lot?.spec?.kind === 'parcel') && !p.lot.spec.confirmed) throw fail(409, 'a drafter has not confirmed your lot yet; it is in their queue', { lotPending: true })
      if (!design || design.contract !== 1) throw fail(400, 'design with contract 1 required')
      // decision B6 (round 10, item 4): a lot that is not a house district blocks Send, never the draft, and only when
      // the zoning is this lot's own (a parcel or plat lot, or a typed lot whose zoning a drafter confirmed)
      const lotNow = await lots.lotOfProject(p)
      if (zoningBlocksSend(lotNow)) throw fail(409, `this lot is zoned ${lotNow.zoning.district} (${lotNow.zoning.use}); a house may need a rezoning, and the office calls you before the design is sent on`, { zoning: true })
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
            await withAllowance(p)
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
      for (const p of open) await withAllowance(p)
      const lots = open.filter((p) => (p.lot?.spec?.kind === 'plat' || p.lot?.spec?.kind === 'parcel') && !p.lot.spec.confirmed)
      // what clients asked the office for (a meeting, more changes), newest first, and every open plan's allowance
      const requests = open.filter((p) => p.meetingRequest || p.wantsMoreChanges).sort((a, b) => Date.parse(b.meetingRequest?.at || b.updatedAt) - Date.parse(a.meetingRequest?.at || a.updatedAt))
      const plans = open.map((p) => ({ id: p.id, client: p.client, email: p.email, address: p.address, status: p.status, version: p.version, updatedAt: p.updatedAt, changesAllowed: p.changesAllowed, changesUsed: p.changesUsed, meetingRequest: p.meetingRequest || null, wantsMoreChanges: !!p.wantsMoreChanges }))
      return { waiting, recent, lots, requests, plans }
    },

    // a drafter confirms the lot read from a plat, with corrected calls or setbacks when needed
    async confirmLot(p, drafter, { confirmed = true, spec, note }) {
      if (p.lot?.spec?.kind !== 'plat' && p.lot?.spec?.kind !== 'parcel') throw fail(409, 'this lot was typed in, nothing to confirm')
      const next = { ...p.lot.spec, ...(spec || {}), kind: p.lot.spec.kind === 'parcel' ? 'parcel' : 'plat', confirmed: !!confirmed, confirmedBy: confirmed ? drafter.email : null, confirmedAt: confirmed ? now() : null, confirmNote: note || null }
      // round 11, item 1: the lot is confirmed with its zoning. The server reads the district again at the parcel (a
      // drafter's read is never limited); a read that fails keeps the one already stored. The zoning it confirmed
      // carries who confirmed it, so nothing a browser sends later can replace it.
      if (confirmed) {
        const fresh = await this.readZoning(next)
        const z = fresh && fresh.status !== 'unknown' ? fresh : next.zoning || fresh
        next.zoning = z ? { ...z, confirmedBy: drafter.email, confirmedAt: now() } : null
      }
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
        await store.versions.add({ projectId: p.id, n: p.version, at: p.updatedAt, kind: 'lot', text: 'Lot corrected by the drafter', used: 0, rooms: placed })
      }
      await store.projects.put(p)
      await event('project', `${p.client}: lot ${confirmed ? 'confirmed' : 'sent back'} by ${drafter.name || drafter.email}${changed ? ' with corrections' : ''}`, { projectId: p.id })
      return this.detail(p, { drafter: true })
    },

    /**
     * A drafter confirms the zoning of a typed lot (round 10, item 4): a typed lot carries no zoning of its own, so a
     * district read at an address nobody confirmed can never block it. Once a drafter has read the city map and says
     * the lot is not a house district, Send is blocked for it; `clear` removes the note.
     */
    async confirmZoning(p, drafter, { district, residential, use, note, clear = false }) {
      if (!p.lot?.spec || p.lot.spec.kind === 'reference') throw fail(409, 'this plan has no lot of its own')
      const d = String(district || '').trim().slice(0, 20)
      if (!clear && !d) throw fail(400, 'district required (the code on the city zoning map, such as R-1 or C-3)')
      const isRes = residential !== false
      const useLine = String(use || (isRes ? 'single-family' : 'not a house district')).slice(0, 60)
      const zoning = clear ? null : { status: 'found', district: d, residential: isRes, use: useLine, message: isRes ? null : `This lot is zoned ${d} (${useLine}). A house may need a rezoning; the office will call you.`, layer: 'read from the city zoning map by the drafter', confirmedBy: drafter.email, confirmedAt: now(), note: note ? String(note).slice(0, 300) : null }
      const next = { ...p.lot.spec, zoning }
      p.lot = { ...(await lots.lotOfProject({ lot: { spec: next, plat: p.lot.plat } })), plat: p.lot.plat || null }
      p.updatedAt = now()
      await store.projects.put(p)
      await event('project', `${p.client}: zoning ${clear ? 'note cleared' : `${d} confirmed`} by ${drafter.name || drafter.email}`, { projectId: p.id })
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
