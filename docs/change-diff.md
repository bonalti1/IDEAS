# Change diff, version 1

The structured result of interpreting a client's plain-language request. The
interpreter (Claude through `POST /api/interpret`, or the regex fallback)
produces it; the rules engine checks it; `applyOps` applies it. Feet
throughout, plan coordinates: x along the front from the left, y from the
rear wall toward the street.

```json
{
  "ops": [
    { "op": "resize", "room": "kitchen", "w": 12, "d": 19 },
    { "op": "add", "kind": "office", "name": "Office", "w": 11, "d": 10, "near": "living" },
    { "op": "remove", "room": "halfbath" },
    { "op": "move", "room": "laundry", "dx": 0, "dy": -4 }
  ],
  "reply": "Widened the kitchen to 12 feet and added an office next to the living room.",
  "confidence": 0.9
}
```

| Op | Fields | Meaning |
|---|---|---|
| `resize` | `room` (id), `w`, `d` (feet, absolute, quarter-foot steps) | New outside dimensions. The room keeps its centre. Doors, windows and fixtures scale with it. |
| `add` | `kind` (a key in `kit.rooms`), optional `name`, `w`, `d`, `near` (room id) | New room. Sizes default to the kit template. Placed beside `near` if there is space, otherwise below the bedroom wing. Gets a door on the shared wall and, for bedrooms and offices, a window on the outside wall. |
| `remove` | `room` (id) | Removes the room and everything in it. |
| `move` | `room`, `dx`, `dy` (feet) | Translates the room and its contents. |
| `count` | `kind` (`bed` or `bath`), `count` (the total the house should have) | Round 12. "I want 4 bedrooms". More rooms are added in place when they fit; fewer, or more that do not go in place, become a new draft with the client's room edits put back. A count the lot or the style cannot take is refused in plain words and uses no change. |

`reply` is one or two sentences the client reads. `confidence` is 0 to 1; below 0.5 the app asks the client to rephrase instead of applying.

Room ids are the kit plan ids (`kitchen`, `bed1`, `mwic`, `halfbath`, ...) or ids of rooms added earlier (`office-2`). The interpreter gets the current room list with ids, kinds, names and sizes, plus the kit's room kinds and template sizes, so it never has to guess an id.

The interpreter translates the request faithfully and leaves the judging to the rules:

- A size or distance the client states is exact. "Bedroom 2, 8 by 8" becomes `resize bed2 8 8`, and the rules reject it with the minimum. The interpreter never quietly swaps in a legal size, so the client is never charged a credit for a change they did not ask for.
- "Add" always means one more room of that kind, even when the plan already has one.
- The interpreter refuses on its own only when the request removes the kitchen, the living room, the last bedroom or the last bathroom, or when the request is unclear (`ops: []`, confidence below 0.5, and a question in `reply`).

## Rules applied before any op takes effect

Checked on the plan as it would be after the ops (`src/draft/lib/rules.js`). Any failure rejects the whole diff with a reason the client can read.

1. Every conditioned room stays inside the setback envelope.
2. Rooms do not overlap other rooms.
3. Minimum sizes from `kit.rules.minSize`; habitable rooms at least 70 square feet and 7 feet in each direction.
4. Every bedroom keeps at least one window for egress.
5. Wet rooms (baths, kitchen, laundry) stay within `kit.rules.wetDistanceFt` of another wet room.
6. The footprint stays within the lot-fit limit: the smaller of the buildable area and the lot area times the city's maximum coverage.
7. The house keeps a kitchen, a living room, a bedroom and a bathroom.

## Live path, logging, time limit

- `POST /api/interpret` waits at most 8 s on Claude (`INTERPRET_TIMEOUT_MS`). On timeout it answers 504 with `timeout: true`; the app then runs the regex fallback and labels the reply "basic rules, assistant took too long". The browser side gives up at 8.5 s on its own.
- Every call is appended to `server/data/interpret-log.jsonl`: request, diff, verdict (`diff` / `unsure` / `refusal` / `no-diff` / `timeout` / `error`), ms, token usage, cost in dollars (`INTERPRET_PRICES` overrides the per-million-token prices; default Opus 5.5 list: in 4, out 20, cache read 0.2, cache write 5). The app posts its own verdict (`applied` / `rejected` with reasons, and which path answered) to `POST /api/interpret/verdict`, so each request has two lines: what Claude said, and what the rules did with it.
- `GET /api/interpret/log` returns the last 50 entries plus totals (calls, cost, cost per call, average ms). The office dashboard shows it under "Client requests".
- Key: the server reads `DRAFTHOUSE_CLAUDE_KEY`, then `ANTHROPIC_API_KEY`, and only ever prints the key's length. At start it calls the Models API once. The result shows in the log and in the `interpreter` health check: reachable, key rejected, or "api.anthropic.com is blocked or unreachable from this machine (network access)". A blocked connection during a request answers 503 with `blocked: true`, and the app falls back to the basic rules.
- `node scripts/try-interpret.mjs [api base]` prints the key's length, checks api.anthropic.com directly (and stops with a clear BLOCKED line if network access does not allow it), then runs the ten named requests against the live endpoint. For each request it prints the diff, the rules verdict (it uses the app's own `decide`), the reply, the time, the tokens and the cost, and grades the outcome as RIGHT or WRONG: requests 1 to 7 must apply and take effect, and requests 8 to 10 must be refused, either by the rules or by Claude asking back. It posts each verdict to the log and exits 0 when at least 9 of the 10 come out right.
- Last live result, 2026-11-03, `claude-opus-5-5` at low effort: 10 of 10 right in three consecutive runs, about 2.2 s and $0.012 per request ($0.117 to $0.123 for all ten). The system prompt is cached, about 1,200 tokens read from cache per call after the first.
- Undo in the Draft step restores the plan and the credit of the last applied change. A rejected change never costs a credit.

## With an account

Signed-in clients do not call `/api/interpret` from the browser. The office API runs the whole step for the saved project (`POST /api/projects/:id/change`): Claude or the basic rules, the shape check, the plan rules, and the credit, which is taken only when the change applies. The response carries the new rooms, the reply, the source label, the credits left and the version number. The browser path above remains for the no-account mode.

## Round 12 additions

- `resize` takes `soft: true` when the client gave no size ("bigger", "smaller"). A soft resize that does not fit is refused with the nearest step that does, offered as a button.
- `add` with `kind: "rearPorch"` is also what a patio, a covered patio or a lanai means; it takes `w` and `d` when the client gave a size, and goes behind the dining room when the living room's back wall is taken.
- The answer carries `intent: "open"` (no ops with it) when the client wants the house to feel more open. Nothing changes; the reply says what is already open and offers resizes of the open rooms as buttons.
- The schema sent to Claude is one shape per op with every field written (null for "not given"); `tidy()` in `server/interpreter.mjs` drops the nulls before the plan code reads the ops. The earlier shape with optional fields was refused by the API as too complex once these fields were added.

## Round 13 additions

- **Spanish.** A request in Spanish (casual Rio Grande Valley Spanish, accents or none, typos) is understood in both modes. The basic rules read it through `fromSpanish()` in `src/draft/lib/es.js`, which turns each clause into the English request the rules already read ("quiero 4 recámaras" → "4 bedrooms") and keeps the client's own words for the reply to quote. Claude reads the client's own words; the prompt lists the vocabulary and says to write the same ops as for the English request.
- **The answer's language.** The plan code keeps writing English from its templates (that is what is logged and stored with the version). An answer leaves in Spanish when the request was Spanish or the screen is: `POST /api/projects/:id/change` takes `lang: 'es' | 'en'` beside `text` and `ops`; without it the language is read from the text. `localize()` in `interpret.js` runs the reply and every button label through `toSpanish()`, and adds `askLabel` (the words of the "ask the office" button, in either language) and `lang: 'es'`. Claude is sent `lang` with the request and writes its own sentence in that language; a sentence that still has English in it is replaced by the plan code's own description of what was done, so nothing half-English reaches a Spanish speaker. Feet stay feet ("pies"), sf is "pies²", and the space the city keeps open along each edge of the lot is said that way ("el espacio que la ciudad mantiene libre a lo largo de cada orilla del lote"), never as a trade word.
- **`toSpanish(text)`** covers every sentence the plan code writes for a homeowner: chat replies, refusals, button labels, the rule reasons as `plain.js` words them, the fit messages of the rooms step, the office's answers, undo. `untranslated(text)` lists the sentences it has no template for (the tests sweep the chat's answers with it); `isSpanish(text)` is the detector.
- **The answer shape sent to Claude did not change**: same schema, every field required, `intent` still `open | none`. Only the prompt grew (two rules).
- **Typed undo.** "undo", "undo that", "go back", "go back to how it was", "put it back", "deshaz eso", "regresa como estaba", "quita el último cambio" (`isUndoRequest()` in `ops.js`) never reach a model. On a saved plan the office rolls back to the version before the last standing change, the same rollback the Undo button uses, and the change comes back to the plan; typed again it takes off the change before that; with nothing to undo it says so and uses no change. The answer carries `undo: true`, the restored `rooms`, the counts and `project`.
- **Two wishes that pull against each other.** "Make the house smaller but add 2 bedrooms" (`tradeOffAsk()`) is answered before any model is asked: the trade-off in plain words, and one option as a button that applies on this lot and passes every rule (a house a little smaller with the bedrooms asked for; else the house at its size with one more; else the smaller house with the rooms it has). `offer: 'trade-off'`, no change used.
- **A request nobody can read.** "asdf", "make it nicer", "hmm": the basic rules mark it `intent: 'unclear'`; when Claude comes back with nothing to do on such a message, `markUnclear()` marks it the same way. The answer is "I did not catch that" with three example changes as buttons, each checked to apply on the plan as it is (`exampleFixes()`), `offer: 'examples'`, no change used. A question Claude asks about a request that names a room stays Claude's question.
- `interpretRequest` takes `lang` and `fixOps` (a tapped button's ops, taken as given: the label is not read).
