// The Claude change interpreter, server side: the key never leaves this process.
// ask(input) returns the structured diff with usage, cost and time, or throws an error with
// .status (429/502/503/504), .timeout and .blocked set so callers can label the fallback.
import Anthropic from '@anthropic-ai/sdk'
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema'
import { countAsk, wantsOpen } from '../src/draft/lib/ops.js'

// The diff Claude writes: one shape per op, every field of a shape required (null where the client gave nothing).
// The shape matters to the API, which compiles the schema before the first answer: the single op object this
// used to be, with its optional fields, was refused as "Schema is too complex" once round 12 added two more (16
// optional), and a 14-optional variant took 138 s to compile on its first call (measured; the office waits 8 s,
// so every chat answer in that window comes from the basic rules). With no optional field the first call answers
// in about 3 s. tidy() below turns the answer back into the plain ops the plan code reads (docs/change-diff.md):
// nulls dropped, false flags dropped.
const str = (description) => ({ type: 'string', description })
const num = (description) => ({ type: 'number', description })
const orNull = (schema) => ({ anyOf: [schema, { type: 'null' }] })
const shape = (op, fields) => ({ type: 'object', properties: { op: { type: 'string', enum: [op] }, ...fields }, required: ['op', ...Object.keys(fields)], additionalProperties: false })
export const OP_SHAPES = {
  resize: { room: str('room id'), w: num('feet, along the front'), d: num('feet, front to back'), soft: { type: 'boolean', description: 'true when the client gave no size ("bigger", "smaller"), so the checker may put the change on the side that has room; false when a size was stated' } },
  add: { kind: str('room kind, one of the kit kinds'), name: orNull(str('a name for the room ("Covered Patio"), or null for the kit name')), w: orNull(num('feet along the front, or null for the kit size')), d: orNull(num('feet front to back, or null for the kit size')), near: orNull(str('room id to place the new room beside, or null')), side: orNull({ type: 'string', enum: ['west', 'east'], description: 'a bedroom or bath: in line with the wing (west) or across the hall (east)' }) },
  remove: { room: str('room id') },
  move: { room: str('room id'), dx: num('feet east (west is negative)'), dy: num('feet toward the street (toward the back is negative)') },
  moveBeside: { room: str('room id of the room that moves'), target: str('room id it moves next to') },
  garage: { cars: orNull(num('bays, 1 to 4 ("make the garage 3 cars"), or null to keep the bays it has')), load: orNull({ type: 'string', enum: ['front', 'side'], description: 'front-load (doors to the street) or side-load (doors to the side yard)' }), tandem: { type: 'boolean', description: 'the third car parks behind one of two bays' } },
  scale: { sqft: num('the living area the whole house should come to') },
  swap: { room: str('room id'), target: str('room id of the room it trades places with') },
  count: { kind: { type: 'string', enum: ['bed', 'bath'] }, count: num('how many bedrooms or bathrooms the house should have in all ("I want 4 bedrooms" is 4)') },
}
export const DIFF_SCHEMA = {
  type: 'object',
  properties: {
    ops: { type: 'array', items: { anyOf: Object.entries(OP_SHAPES).map(([op, fields]) => shape(op, fields)) } },
    reply: str('one or two sentences to the client, past tense, no jargon'),
    confidence: num('0 to 1'),
    intent: { type: 'string', enum: ['open', 'none'], description: '"open" when the client wants the house to feel more open (no ops go with it); otherwise "none"' },
  },
  required: ['ops', 'reply', 'confidence', 'intent'],
  additionalProperties: false,
}

/** Claude's answer as the plan code reads it: nulls and false flags dropped from each op, confidence kept in 0 to 1, intent "none" dropped. */
export function tidy(out) {
  if (!out || !Array.isArray(out.ops)) return out
  const ops = out.ops.map((o) => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).filter(([k, v]) => v !== null && v !== undefined && !((k === 'soft' || k === 'tandem') && v === false))) : o))
  const { intent, ...rest } = out
  const confidence = Number.isFinite(+out.confidence) ? Math.max(0, Math.min(1, +out.confidence)) : 0
  return { ...rest, ops, confidence, ...(intent === 'open' ? { intent } : {}) }
}

export const INTERPRET_SYSTEM = `You turn a home buyer's plain-language request into a small list of edits to their floor plan.
You get the current rooms (id, kind, name, width w and depth d in feet, position x y in feet from the rear-left corner, y grows toward the street) and the kit's room kinds with typical sizes.
Rules:
- Use only ids and kinds that appear in the input. Never invent ids.
- Each op has its own fields and all of them are written; use null for one the client did not give.
- "Bigger" means about 15% larger in both directions, "much bigger" about 30%. "Wider" changes w only, "deeper" or "longer" changes d only.
- A size or distance the client states is exact. Use it as given, even when it is under a minimum, crosses the lot, or looks like a bad idea. A plan checker runs after you, enforces minimums, setbacks and overlaps, and explains the problem to the client; never substitute a different number and never ask back just because a stated number breaks a rule.
- Keep dimensions in quarter-foot steps. When you choose a size yourself, keep it within reason: bedrooms 10 to 20 feet, kitchens 9 to 22, no room over 40.
- "Move the X next to the Y" is a moveBeside op: room = X's id, target = Y's id. X is the room that moves (the subject of the sentence); Y stays. A move by a distance ("10 feet toward the street") is a move op with dx, dy.
- "Add" always means one more room of that kind, even when the plan already has one (a second office, a third bedroom). Do not ask whether they meant to resize the existing one.
- "Make the house 3,000 square feet", "the whole plan smaller": one scale op with sqft (the living area asked for); no room resizes.
- "Swap the office and the dining room", "switch X with Y": one swap op, room = X's id, target = Y's id; the two trade places.
- "Side-load garage", "garage doors to the side": a garage op with load "side" (front-load: "front"); "tandem" is a garage op with cars 3 and tandem true.
- A bedroom or bath "across the hall" is an add op with side "east"; "in line" is side "west".
- A new room gets the kit's template size unless the client gives one. Put it near the room they mention with "near".
- "I want 4 bedrooms", "make it 3 bathrooms", "we need 5 bedrooms", "a 4 bedroom house": one count op with kind "bed" or "bath" and count = the total the house should have. The primary bedroom counts as a bedroom; a half bath does not count as a bathroom. Do not write add or remove ops for it, and do not answer that the plan already has that many: the plan checker counts the rooms, adds what is missing or draws the house again with fewer, and writes the reply. "Add a bedroom" and "one more bathroom" stay add ops.
- A patio, a covered patio, a lanai or a back porch is the kit's rearPorch: an add op with kind "rearPorch", and name "Covered Patio" when the client said patio. Put a size in w and d only when the client gave one. Never answer that the kit has no patio, and never refuse it for lack of room: the plan checker finds the wall for it and, when it does not fit, offers the client what does.
- "Bigger" or "smaller" with no size given: set soft true on the resize. Never set soft when the client stated a size.
- "Make it feel more open", "open it up", "open concept", "open the kitchen to the living room", "take out the dining wall", "taller ceilings": there is no op for walls or ceiling heights, and the kit already draws the kitchen, the dining room and the living room with no walls between them. Return no ops, intent "open", confidence 0.9 and a one-sentence reply. The plan checker then tells the client what is already open and offers the changes that do apply as buttons. Never remove or resize a room on your own to make a plan feel open.
- Removing a room removes what is in it. Do not remove the kitchen, the living room, the last bedroom or the last bathroom; set confidence low and explain instead.
- If the request is unclear, or not about the floor plan, return no ops, a question in reply, and confidence below 0.5.
- Never state or estimate any price, cost, rate or total. If asked, say cost is covered at the meeting with the South Texas Builders office.
- The reply is one or two friendly sentences in past tense describing what you did, as if talking to the buyer. Never use the word "setback" in it; say "too close to the side of the lot" or "the space the city keeps open along each edge of the lot".
- Many buyers write in Spanish, the casual Spanish of the Rio Grande Valley, with or without accents and with typos ("recamaras", "banos", "mas"). Read a Spanish request exactly as you would the same request in English and write the same ops: "recámara", "cuarto", "habitación" are a bedroom ("la recámara principal" is the primary bedroom); "baño" a bathroom, "medio baño" a half bath; "cocina" kitchen; "sala" living room; "comedor" dining room; "cochera" or "garaje" garage ("para 3 carros" is 3 cars, "de lado" is side-load); "oficina" office; "lavandería" laundry; "despensa" pantry; "porche" porch and "patio techado" covered patio ("atrás" is the back: rearPorch; "enfrente" the front: frontPorch). "Quiero 4 recámaras", "3 baños" are count ops. "Agrega", "ponle", "quiero un/una" add a room; "quita", "sin", "ya no quiero" remove one. "Más grande" is bigger, "más chica" or "más pequeña" smaller, "más ancha" wider, "más larga" deeper, with soft true when no size is given; "2 pies más ancha" is 2 feet wider. "Que la casa sea de 2,500 pies" is a scale op with sqft 2500 ("pies" for a whole house means square feet). "Que se sienta más abierta", "concepto abierto" are intent "open".
- Write the reply in the buyer's language: the input's "lang" when it is given ("es" Spanish, "en" English), otherwise the language the request is written in. In Spanish use the plain words a homeowner uses (recámara, baño, cochera, pies), address the buyer as "usted", and keep every rule above: no price or cost figure (never the word "precio"), and never "setback" or a trade word for it in Spanish; say "el espacio que la ciudad mantiene libre a lo largo de cada orilla del lote".`

/**
 * The reading the basic rules give for two requests, used when the model came back with nothing to do: a plain
 * count ("I want 4 bedrooms") becomes the count op, and a wish for a more open house is marked so the plan
 * checker answers with its offer. A diff that has ops is left as the model wrote it.
 */
export function backstop(request, out) {
  if (!out || !Array.isArray(out.ops) || out.ops.length) return out
  // a count only when that is all the client said ("I want 4 bedrooms"), never from a longer message or a question
  const text = String(request || '')
  const counts = text.includes('?') || text.trim().split(/\s+/).length > 10 ? [] : countAsk(text)
  if (counts.length) return { ...out, ops: counts.map((c) => ({ op: 'count', kind: c.kind, count: c.count })), confidence: Math.max(Number(out.confidence) || 0, 0.75) }
  if (out.intent !== 'open' && wantsOpen(request)) return { ...out, intent: 'open' }
  return out
}

// the innermost network error code (ECONNREFUSED, ENOTFOUND, ...) behind the SDK's connection error
const netCause = (e) => {
  for (let c = e.cause; c; c = c.cause) if (c.code) return c.code
  return e.cause?.message || e.message
}

// `client` replaces the SDK client (tests pass a stand-in so no request leaves the machine)
export function makeInterpreter({ env = process.env, log = console.log, client: given = null } = {}) {
  const model = env.INTERPRET_MODEL || 'claude-opus-5-5'
  const timeoutMs = +(env.INTERPRET_TIMEOUT_MS || 8000)
  // $ per million tokens; Claude Opus 5.5 list prices. Override with INTERPRET_PRICES='{"in":4,"out":20,"cacheRead":0.2,"cacheWrite":5}'
  const prices = env.INTERPRET_PRICES ? JSON.parse(env.INTERPRET_PRICES) : { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 }
  const costOf = (u) => ((u?.input_tokens || 0) * prices.in + (u?.output_tokens || 0) * prices.out + (u?.cache_read_input_tokens || 0) * prices.cacheRead + (u?.cache_creation_input_tokens || 0) * prices.cacheWrite) / 1e6
  // DRAFTHOUSE_CLAUDE_KEY first (some hosts blank ANTHROPIC_API_KEY), then ANTHROPIC_API_KEY. Only the length is ever printed.
  const keyVar = ['DRAFTHOUSE_CLAUDE_KEY', 'ANTHROPIC_API_KEY'].find((v) => (env[v] || '').trim())
  const key = keyVar ? env[keyVar].trim() : ''
  const client = given || (key ? new Anthropic({ apiKey: key, timeout: timeoutMs, maxRetries: 0 }) : null)
  let reach = { ok: null, detail: 'checking api.anthropic.com' }
  const reachable = () => (reach = { ok: true, detail: `${model}, api.anthropic.com reachable` })

  const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra })

  return {
    model,
    timeoutMs,
    configured: !!client,
    keyVar,
    keyLength: key.length,
    get reach() {
      return reach
    },
    describe: () => ({ ok: !!client && reach.ok !== false, detail: client ? reach.detail : 'no API key: homeowners get the basic chat rules, and an uploaded plat is saved unread for the drafter. Set DRAFTHOUSE_CLAUDE_KEY on the API host.' }),
    async probe() {
      if (!client) return
      try {
        await client.models.retrieve(model, { timeout: 10000 })
        reachable()
      } catch (e) {
        const blocked = e instanceof Anthropic.APIConnectionError
        reach = {
          ok: false,
          detail: blocked
            ? `api.anthropic.com is blocked or unreachable from this machine (network access): ${netCause(e)}`
            : e instanceof Anthropic.AuthenticationError
              ? `api.anthropic.com rejected the key from ${keyVar} (401)`
              : e instanceof Anthropic.PermissionDeniedError
                ? `api.anthropic.com refused access (403): ${e.message}`
                : e instanceof Anthropic.NotFoundError
                  ? `model ${model} not available to this key`
                  : `api.anthropic.com check failed: ${e.message}`,
        }
      }
      log(`interpreter: ${reach.detail}`)
    },
    // a PDF or image → structured JSON by a schema (plat reading)
    async parseDocument({ data, mediaType = 'application/pdf', system, prompt, schema, maxTokens = 3000 }) {
      if (!client) throw fail(503, 'not configured', { unconfigured: true })
      const t0 = Date.now()
      try {
        const message = await client.messages.parse({
          model,
          max_tokens: maxTokens,
          system,
          output_config: { format: jsonSchemaOutputFormat(schema) },
          messages: [{ role: 'user', content: [{ type: mediaType.startsWith('image/') ? 'image' : 'document', source: { type: 'base64', media_type: mediaType, data } }, { type: 'text', text: prompt }] }],
        }, { timeout: 120000 })
        if (message.stop_reason === 'refusal') throw fail(502, 'the reader declined this document', { refusal: true })
        const out = message.parsed_output
        if (!out) throw fail(502, 'the reader returned nothing usable', { noDiff: true })
        return { ...out, usage: message.usage, cost: costOf(message.usage), ms: Date.now() - t0 }
      } catch (e) {
        if (e.status) throw e
        const status = e instanceof Anthropic.RateLimitError ? 429 : e instanceof Anthropic.AuthenticationError ? 503 : e instanceof Anthropic.APIError ? 502 : 500
        throw fail(status, `document reader: ${e.message}`, { ms: Date.now() - t0 })
      }
    },
    // input: { request, program, kit, rooms }
    async ask(input) {
      if (!client) throw fail(503, 'interpreter not configured on this server (no DRAFTHOUSE_CLAUDE_KEY or ANTHROPIC_API_KEY)', { unconfigured: true })
      const t0 = Date.now()
      try {
        const message = await client.messages.parse({
          model,
          max_tokens: 4000,
          system: [{ type: 'text', text: INTERPRET_SYSTEM, cache_control: { type: 'ephemeral' } }],
          output_config: { effort: 'low', format: jsonSchemaOutputFormat(DIFF_SCHEMA, { transform: false }) }, // the schema is sent as written: enum and anyOf are the API's own
          messages: [{ role: 'user', content: JSON.stringify(input) }],
        })
        const ms = Date.now() - t0
        const cost = costOf(message.usage)
        reachable()
        if (message.stop_reason === 'refusal') throw fail(502, 'interpreter declined', { refusal: true, category: message.stop_details?.category || null, usage: message.usage, cost, ms })
        const out = message.parsed_output
        if (!out || !Array.isArray(out.ops)) throw fail(502, 'interpreter returned no diff', { noDiff: true, usage: message.usage, cost, ms })
        return { ...backstop(input?.request, tidy(out)), model, usage: message.usage, cost, ms }
      } catch (e) {
        if (e.status && (e.refusal || e.noDiff)) throw e
        const ms = Date.now() - t0
        const timeout = e instanceof Anthropic.APIConnectionTimeoutError || /timed? ?out/i.test(e.message || '')
        const blocked = !timeout && e instanceof Anthropic.APIConnectionError
        const status = timeout ? 504 : blocked ? 503 : e instanceof Anthropic.RateLimitError ? 429 : e instanceof Anthropic.AuthenticationError ? 503 : e instanceof Anthropic.APIError ? 502 : 500
        const message = timeout ? `interpreter timed out after ${timeoutMs} ms` : blocked ? `api.anthropic.com is blocked or unreachable from this machine (network access): ${netCause(e)}` : String(e.message || e)
        if (blocked) reach = { ok: false, detail: message }
        throw fail(status, message, { timeout, blocked, ms })
      }
    },
  }
}
