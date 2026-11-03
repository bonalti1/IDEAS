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
