# Style kits

A kit is everything the layout engine and the drafter handoff need to produce a
house in one style: wall types, plate heights, roof rules, standard openings,
room templates with real sizes, adjacency, electrical and code notes, and the
sheet set.

| Kit | Source | Status |
|---|---|---|
| `modern-farmhouse.js` | Garza residence, plan FD-25083 rev 08 | Extracted from the set. Items marked CONFIRM need a drafter's sign-off. |

## What a drafter should confirm on the farmhouse kit

- Garage rules. The Garza plan has no garage, so garage size, slab drop, and separation came from the code notes, not a drawing.
- Code year. The rafter table cites IRC 2018. Confirm the cities you build in have not adopted 2021.
- Window assignments per room. Counts match the Garza set, but which room gets which mark is my reading of sheet 200.
- Stone wainscot height. Modeled as 3.33 ft along the front to reproduce 240 sf on a 72 ft front.

## Adding a kit

Copy the farmhouse file, change the ids and sizes, and register it in
`src/draft/lib/styles.js`. Keep the same shape so the layout engine and the
takeoff work without changes.
