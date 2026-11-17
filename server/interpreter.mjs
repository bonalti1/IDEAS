// The Claude change interpreter, server side: the key never leaves this process.
// ask(input) returns the structured diff with usage, cost and time, or throws an error with
// .status (429/502/503/504), .timeout and .blocked set so callers can label the fallback.
import Anthropic from '@anthropic-ai/sdk'
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema'

export const DIFF_SCHEMA = {
  type: 'object',
  properties: {
    ops: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['resize', 'add', 'remove', 'move'] },
          room: { type: 'string', description: 'room id for resize, remove, move' },
          kind: { type: 'string', description: 'room kind for add, one of the kit kinds' },
          name: { type: 'string' },
          w: { type: 'number', description: 'feet, along the front' },
          d: { type: 'number', description: 'feet, front to back' },
          near: { type: 'string', description: 'room id to place a new room beside' },
          dx: { type: 'number', description: 'feet east' },
          dy: { type: 'number', description: 'feet toward the street' },
        },
        required: ['op'],
        additionalProperties: false,
      },
    },
    reply: { type: 'string', description: 'one or two sentences to the client, past tense, no jargon' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['ops', 'reply', 'confidence'],
  additionalProperties: false,
}

export const INTERPRET_SYSTEM = `You turn a home buyer's plain-language request into a small list of edits to their floor plan.
You get the current rooms (id, kind, name, width w and depth d in feet, position x y in feet from the rear-left corner, y grows toward the street) and the kit's room kinds with typical sizes.
Rules:
- Use only ids and kinds that appear in the input. Never invent ids.
- "Bigger" means about 15% larger in both directions, "much bigger" about 30%. "Wider" changes w only, "deeper" or "longer" changes d only.
- A size or distance the client states is exact. Use it as given, even when it is under a minimum, crosses the lot, or looks like a bad idea. A plan checker runs after you, enforces minimums, setbacks and overlaps, and explains the problem to the client; never substitute a different number and never ask back just because a stated number breaks a rule.
- Keep dimensions in quarter-foot steps. When you choose a size yourself, keep it within reason: bedrooms 10 to 20 feet, kitchens 9 to 22, no room over 40.
- "Add" always means one more room of that kind, even when the plan already has one (a second office, a third bedroom). Do not ask whether they meant to resize the existing one.
- A new room gets the kit's template size unless the client gives one. Put it near the room they mention with "near".
- Removing a room removes what is in it. Do not remove the kitchen, the living room, the last bedroom or the last bathroom; set confidence low and explain instead.
- If the request is unclear, or not about the floor plan, return no ops, a question in reply, and confidence below 0.5.
- The reply is one or two friendly sentences in past tense describing what you did, as if talking to the buyer.`

// the innermost network error code (ECONNREFUSED, ENOTFOUND, ...) behind the SDK's connection error
const netCause = (e) => {
  for (let c = e.cause; c; c = c.cause) if (c.code) return c.code
  return e.cause?.message || e.message
}

export function makeInterpreter({ env = process.env, log = console.log } = {}) {
  const model = env.INTERPRET_MODEL || 'claude-opus-5-5'
  const timeoutMs = +(env.INTERPRET_TIMEOUT_MS || 8000)
  // $ per million tokens; Claude Opus 5.5 list prices. Override with INTERPRET_PRICES='{"in":4,"out":20,"cacheRead":0.2,"cacheWrite":5}'
  const prices = env.INTERPRET_PRICES ? JSON.parse(env.INTERPRET_PRICES) : { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 }
  const costOf = (u) => ((u?.input_tokens || 0) * prices.in + (u?.output_tokens || 0) * prices.out + (u?.cache_read_input_tokens || 0) * prices.cacheRead + (u?.cache_creation_input_tokens || 0) * prices.cacheWrite) / 1e6
  // DRAFTHOUSE_CLAUDE_KEY first (some hosts blank ANTHROPIC_API_KEY), then ANTHROPIC_API_KEY. Only the length is ever printed.
  const keyVar = ['DRAFTHOUSE_CLAUDE_KEY', 'ANTHROPIC_API_KEY'].find((v) => (env[v] || '').trim())
  const key = keyVar ? env[keyVar].trim() : ''
  const client = key ? new Anthropic({ apiKey: key, timeout: timeoutMs, maxRetries: 0 }) : null
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
    describe: () => ({ ok: !!client && reach.ok !== false, detail: client ? reach.detail : 'no API key, clients get the basic rules' }),
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
          output_config: { effort: 'low', format: jsonSchemaOutputFormat(DIFF_SCHEMA) },
          messages: [{ role: 'user', content: JSON.stringify(input) }],
        })
        const ms = Date.now() - t0
        const cost = costOf(message.usage)
        reachable()
        if (message.stop_reason === 'refusal') throw fail(502, 'interpreter declined', { refusal: true, category: message.stop_details?.category || null, usage: message.usage, cost, ms })
        const out = message.parsed_output
        if (!out || !Array.isArray(out.ops)) throw fail(502, 'interpreter returned no diff', { noDiff: true, usage: message.usage, cost, ms })
        return { ...out, model, usage: message.usage, cost, ms }
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
