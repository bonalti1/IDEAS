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

## Rules applied before any op takes effect

Checked on the plan as it would be after the ops (`src/draft/lib/rules.js`). Any failure rejects the whole diff with a reason the client can read.

1. Every conditioned room stays inside the setback envelope.
2. Rooms do not overlap other rooms.
3. Minimum sizes from `kit.rules.minSize`; habitable rooms at least 70 square feet and 7 feet in each direction.
4. Every bedroom keeps at least one window for egress.
5. Wet rooms (baths, kitchen, laundry) stay within `kit.rules.wetDistanceFt` of another wet room.
6. The footprint stays within the lot-fit limit: the smaller of the buildable area and the lot area times the city's maximum coverage.
7. The house keeps a kitchen, a living room, a bedroom and a bathroom.
