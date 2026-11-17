# Fix round 4

From the strict review of PR #3. Branch `claude/fix-round-4`, branched from `claude/revit-workflow-optimization-vjh5id` (PR #3 was open and unmerged when this round started), so the PR for this round is stacked on PR #3.

Commits, in order:

| commit | what |
|---|---|
| d5333f2 | Garage doors by bay, a driveway on the real lot, and a narrow plan for 50 ft lots (P0 items 1, 2, 3) |
| 5a4c50d | The program follows the plan everywhere; the audit panel warns with its own mark; ±3% area, no 1.22 fudge (P0 items 4, 5) |
| 5bf22fb | The plan an STB designer would sign: circulation, suite entry, service rooms off the front, closets, 42" halls, no voids; IFC-converted kits pass; door heights (P1 items 6–12, 15) |
| 511f809 | Site plan on the plan tab and in the package; real sheet scales and a real PDF file; the plan on a phone (P1 items 13, 14, 16, 17) |
| c099a10 | Homeowner view carries no audit/questions/override; the override is its own logged note; honest trust copy; no .pyc in git; #/office and #/drafter (P2 items 21, 22, 23; round 2 item 11) |
| ff3f736 | One price on every screen, the county asked for, the lot step never blanks, honest geocode words, visible sign-in hint (P2 item 20; round 2 items 1, 4, 9, 10) |
| b246711 | Unsupported requests get a real answer; no-op changes cost nothing; porch adds say their sf; fallback timing (round 2 items 2, 5, 6) |
| abbd1cc | "Show me options", 3D in the kit's materials with tags that follow the zoom, the phone in one column (P2 items 18, 19; round 2 item 8) |

Tests: `npm test` → **202 tests, 200 pass, 0 fail, 2 skipped** (the two `LIVE=1` tests: a Stripe Checkout session in test mode, which needs `STRIPE_SECRET_KEY`, and Claude reading the Garza site plan with the FEMA lookup, which need the key and the internet). `vite build` clean. The IFC round-trip tests ran (python with IfcOpenShell is in this container).

## Item by item

### P0

| # | item | status | tests |
|---|---|---|---|
| 1 | Garage doors match the bays | done (d5333f2). `overheadDoors()` lays 16' for two bays, 16' + 9' for three, singles when the wall is tight, 2 ft of wall between and at the ends, centred on the bays; a resize re-lays them; audit checks `doors-overlap`, `garage-bays`, `garage-name` | `test/garage.test.mjs`: overhead doors by bay…; garage on the lot (every cell); "make the garage 3 cars"…; the audit catches overlapping doors… |
| 2 | Garage drivable on the real lot | done (d5333f2, 511f809). Front-load when the house and garage fit the envelope; else side-load turned (22 × 33 for 3 cars) with 25 ft clear from the door to the lot line; else the courtyard way (doors toward the rear yard, 25 ft apron, 10 ft lane down the side yard). The audit's `garage-street` checks the driveway on the lot; a rear door needs an alley. The driveway and the walk are drawn on the site plan, the 2D plan tab and in 3D from one function (`lib/site.js`) | `test/garage.test.mjs`, `test/site.test.mjs` (driveway reaches the street edge; the courtyard apron, leg and lane) |
| 3 | Narrow lots get a plan | done (d5333f2). `src/kits/farmhouse-narrow.js`: 39.5 ft wide, 4 ft hall, bedrooms both sides, garage beside the living room, driveway straight to the street. 3/2 at 1,800 and 4/2 at 2,200 pass the audit on the 50 ft lot. The vacuous assertion and the narrow-lot skips are gone: every cell of the matrix must draft | `test/audit.test.mjs`: the narrow plan: 3/2 at 1,800 sf and 4/2 at 2,200 sf…; first draft audit: … on narrow 50 x 120 |
| 4 | Program follows the plan | done (5a4c50d). `programOf(rooms)` feeds Draft, Send, Review, the inbox, design.json (`asBuilt`), the summary PDF and the title block | `test/asbuilt.test.mjs` (add a bedroom + half bath + 3 cars → "5 bed · 3.2 bath · 3-car") |
| 5 | Audit panel ⚠ and counts; first draft within ±3%; no 1.22 | done (5a4c50d). Groups carry `state: pass/warn/fail`; the panel counts warnings; the rooms step clamps the ask to the plan's smallest size and says so; the audit's living area is the drawn area | `test/asbuilt.test.mjs` (area group warns), `test/audit.test.mjs` |

### P1 architecture

| # | item | status | tests |
|---|---|---|---|
| 6 | Circulation | done (5bf22fb). Measures: halls as % of living area (warn > 12%, fail > 18%), dead-end hall past its last door (fail > 10 ft). The suite hall shrank from 16 ft to 7.75 ft; the matrix runs 6.7–11.4% (table below) | `test/audit.test.mjs` matrix (0 errors every cell); the measures print in `scripts/plan-audit.mjs` |
| 7 | Primary suite entry | done (5bf22fb). The suite is entered through its own vestibule off the kitchen; the mud room, laundry and half bath are behind the mud room. Audit warning `suite-entry` when the primary door shares a hall with mud/laundry/half bath | the matrix (0 warnings); the warning fires on the old plan (checked while re-planning) |
| 8 | Street front for living rooms | done (5bf22fb). The pantry is inside, 4 × 8.5, off the kitchen, no window; the dining room took the front gable; Bath 1's window moved to the side wall. Audit warning `service-front` | the matrix (0 warnings) |
| 9 | Closets | done (5bf22fb). Reach-ins drawn 2'-6" (26" clear), the wing's added closets too; audit `closet` (24" clear) and `walk-in` (5 × 5) | the matrix; `test/audit.test.mjs` |
| 10 | Halls 42" | done (5bf22fb). Every hall 4 ft drawn (44" clear), `CLEAR.hallFt = 3.5`, `kit.hallWidthFt = 4`; the Garza test asks for 42 (`test/audit.test.mjs:28`) | `test/audit.test.mjs`: the Garza sample passes… halls measure right |
| 11 | No voids, no jogs | done (5bf22fb). Audit error `void` (enclosed unassigned area over 4 sf) and warning `jog` (outside wall step under 2 ft). A dropped room's space goes to a neighbour (the primary closet takes the half bath's), by chat too (`fillVoid`). Bath 1 sits in the wing line; the mini primary on the porch line; the hall runs to Bedroom 1's front wall when there is no mini primary | the matrix (0 errors, 0 jogs on first drafts); `test/interpret.test.mjs` 3. remove the half bath |
| 12 | IFC-converted kits pass the audit | done (5bf22fb). The export carries room, door and opening ids, kinds and fixture faces (`DraftHouse_*` property sets); the converter snaps openings onto the room walls and reads them back. The converted Garza kit runs the whole 4 × 4 matrix with 0 errors | `test/audit.test.mjs`: first draft audit on the IFC-converted kit: … (16 cells); `test/kits.test.mjs` asserts the audit for generated kits |

### P1 drawings

| # | item | status | tests |
|---|---|---|---|
| 13 | Site plan on the plan tab and in the PDF | done (511f809). Lot lines with lengths, the setback envelope with each setback named, the footprint, driveway, walk, street names, north arrow, graphic scale, lot coverage %. A "Site" view beside Plan and 3D; sheet A-100 in the PDF | `test/site.test.mjs` (every lot of the matrix) |
| 14 | Real sheet scales and a real PDF | done (511f809). 1/4" = 1'-0" on 24 × 36 (turned portrait when the plan is deeper than wide; the 5/4 with its 3-car garage and longer wing takes 3/16"), or 1/8" on tabloid; the site plan at the largest engineering scale that fits (1" = 10' on the 100 × 150 lot). Send builds real PDF files in the browser (jsPDF + svg2pdf): the two sheets with the title block, and the homeowner's summary. The print view remains only as the fallback when a PDF cannot be built. Verified by downloading through Playwright (`%PDF`, 2 pages) and rasterising with pdftoppm: `docs/fix-round-4/pdf-*.png` | `test/plan-svg.test.mjs` (sheet size and scale), `test/site.test.mjs` |
| 15 | Door heights agree | done (5bf22fb). Every door carries its catalog height (French pairs 96", overhead 84", the rest 80") into design.json, the schedule and the IFC, on first drafts and after chat edits | `test/widths.test.mjs`: opening widths agree (16 cells, now heights too); door heights still agree after chat edits… |
| 16 | Plan on a phone | done (511f809, abbd1cc). Fits the width, pinch zooms, a tap on a room shows its name and size, double tap fits; Fit / Roof / Sun check only on the 3D view | checked in the browser at 390 × 844 (`docs/fix-round-4/phone-02-plan-3-car.png`) |
| 17 | Title on manual lots | done in round 3 ("100 × 150 lot, McAllen") | `test/asbuilt.test.mjs` lotTitle |

### P2

| # | item | status | tests |
|---|---|---|---|
| 18 | "Show me options" | done (abbd1cc). `lib/options.js`: two or three options for the garage, the porches or the bedroom wing, each applied to a copy and run through the rules and the audit, with sf and price change and a small drawing; picking one is one ordinary change (the fix-ops path), the others cost nothing. "Show me garage options" is a chip; the picker links to the other topics | `test/options.test.mjs` (every option on the default draft and the Garza sample passes the audit; a pick lands on the same plan) · screenshots `*-04-options-picker.png` |
| 19 | 3D | done (abbd1cc). Tags shrink as the camera pulls back and go beyond ~520 ft; board and batten (batten texture), a 3'-4" stone wainscot on the street-facing walls, dark shingles, white fascia; the awning that floated where the mini primary was is gone with its room; the bedroom wing roof no longer runs past Bath 1 (the plan changed). The garage gable still ties into the laundry gable at its ridge end rather than a true valley; see "Not done" | checked in the browser (`*-03-3d-3-car.png`) |
| 20 | One price on every screen | done (ff3f736). The rooms step prices the starter draft's rooms (the same `estimate({rooms})` Draft and Send use) and says so; before a draft fits it says "before drafting". No silent Hidalgo: a lot whose city has no preset gets a county select on the lot step and the price waits for it | `test/pricing.test.mjs`, `test/lot.test.mjs`: an address outside the Valley… |
| 21 | Server and privacy | done (c099a10). The owner's `GET /api/projects/:id` has no audit, no questions, no source paths, and reviews carry only decision, note and `overridden`; drafters get it all on `/api/review/:id`, cached per project version. The override is its own textarea (office only, ≥ 20 characters), stored as `{ note, by, byId, at, errors }` | `test/accounts.test.mjs`: the homeowner never receives the audit…; a plan with audit errors is approved only over an override note… |
| 22 | Repo hygiene | done (c099a10). `worker/**/__pycache__/*.pyc` untracked; `__pycache__/` and `*.pyc` in `.gitignore` | — |
| 23 | Honest trust copy | done (c099a10). "checked against 13 IRC planning checks" from `CHECK_GROUPS.length`; the 1 and 5 business day lines are marked PLACEHOLDER for Rolando | — |

### Fix round 2 list

Each item was checked against the code first; the reviewer was right that none had been done. They are fixed in this branch, grouped in three commits by subject rather than one commit each (ff3f736, b246711, abbd1cc, plus c099a10 for item 11).

| # | item | status | tests |
|---|---|---|---|
| 1 | Lot-step Depth edit blanks the page | done (ff3f736). The crash: a half-typed depth built a 20 ft lot whose setbacks left no envelope, and the 3D site plan threw. The Lot step now keeps the last good lot on screen and says what is missing (`lotProblem`); every step sits inside an error boundary with "Try again" and "Go back". Reproduced in the browser before and after ('', '1', '12', 'e': no blank, no page errors) | `test/lot.test.mjs`: a half-typed lot size never builds a bad lot… |
| 2 | No credit for a no-op | done (b246711). A change that draws the same house (resize to the same size, duplicate porch, …) is not applied and uses no change; porch adds say their square feet | `test/interpret.test.mjs`: a change that changes nothing… |
| 3 | Header counts | done with P0 item 4 | `test/asbuilt.test.mjs` |
| 4 | Geocoding failure | done (ff3f736). `geoMessage()`: "We don't have rules for this address yet", in the Valley (county defaults, a drafter checks) or "outside the Rio Grande Valley, where we build"; the city preset is cleared | `test/lot.test.mjs` |
| 5 | Fallback under 1 s | done (b246711). With no Claude key the office answers a change in about 105 ms (measured in `test/accounts.test.mjs`: with no Claude key the office answers a change in under a second…). **Render was not measured**: this container cannot reach it; run `time curl -X POST …/api/projects/<id>/change` there to confirm |
| 6 | Unsupported requests | done (b246711). `unsupported()`: "two story" → this style is one story for now; "purple"/"paint" → finishes are picked with the drafter; "helipad"/"pool"/"basement" → what the plan can change. Answered before any model is asked, on the office server and in the fallback | `test/interpret.test.mjs`: requests this style cannot take get a real answer… |
| 7 | Grammar | done in round 3 | `test/requests.test.mjs` |
| 8 | Phone layout | done (abbd1cc). One column under 700 px, no sideways scroll (checked at 390 × 844 and 430 × 932: `scrollWidth === innerWidth`), the view buttons under the canvas, no 3D tags on a phone | browser check; screenshots `phone-*.png` |
| 9 | Garza sample card | done (ff3f736). The card lists everything it turns on (beds, baths, mini primary, office, garage or none, porches, stories) and shows its own draft's area and price, the same numbers the first draft shows | — |
| 10 | "Sign in to keep a history" | done (ff3f736): visible text beside the chat tools for guests | — |
| 11 | #/office and #/drafter | done (c099a10): both route to the review inbox, which shows the office sign-in to a guest | — |

## `scripts/plan-audit.mjs`, before (round-3 branch e774291) and after

### Default draft (4 bed, 3.5 bath, 2-car, 2,800 sf, Lot 514)

Before:
```
  0 errors
  ! [west-glass] 45 sf of west-facing glass with no porch or awning over it.
  living area: 2800 sf delivered, 2800 sf asked (0.0%)
  kitchen work triangle: 19.7 ft (legs 4.3, 8.9, 6.4)
  halls: Hallway 47" clear; Vestibule 53" clear; Hall 41" clear
```
After (the round-4 audit has eight more checks; run on the old plan it found a 23" closet, the suite door on the mud hall, Bath 1 and the pantry on the street front, and jogs):
```
  0 errors
  living area: 2805 sf delivered, 2800 sf asked (0.2%)
  kitchen work triangle: 25.6 ft (legs 8.6, 8.1, 8.9)
  halls: Hallway 47" clear; Vestibule 53" clear; Suite Hall 47" clear
  circulation 9.2%
```

### Garza sample (3 bed, 3.5 bath, mini primary, office, no garage, 2,533 sf)

Before:
```
  0 errors
  living area: 2535 sf delivered, 2533 sf asked (0.1%)
  kitchen work triangle: 19.5 ft (legs 4.5, 8.9, 6.1)
  halls: Hallway 44" clear; Vestibule 47" clear; Hall 38" clear
```
After:
```
  0 errors
  living area: 2535 sf delivered, 2533 sf asked (0.1%)
  kitchen work triangle: 24.9 ft (legs 7.8, 8.6, 8.5)
  halls: Hallway 44" clear; Vestibule 47" clear; Suite Hall 44" clear
  circulation 6.7%
```

### 50 ft lot (3/2 at 1,800 sf, 50 × 120, Pharr)

Before (the standard plan squeezed onto the lot, 38" hall):
```
  0 errors
  ! [area] Living area is 1,888 sf, 5% over the 1,800 sf asked for.
  halls: Hallway 44" clear; Vestibule 47" clear; Hall 38" clear
  rooms: 21, floor area 1888 sf
```
After (the narrow plan; the rooms step clamps the ask to the plan's smallest size, 1,850 sf, and says so):
```
  0 errors
  ! [area] Living area is 1,862 sf, 3% over the 1,800 sf asked for.
  kitchen work triangle: 16.7 ft (legs 5.6, 5.8, 5.3)
  halls: Hall 44" clear; Hallway 44" clear
  rooms: 18, floor area 1862 sf
```

## 4 lots × 4 programs (after)

Each cell: errors, warnings · living sf delivered / asked · circulation % · garage doors.

| program | Lot 514 | McAllen 100 × 150 | narrow 50 × 120 | corner 110 × 140 |
|---|---|---|---|---|
| 3/2 1,800 sf | 0 err, 0 warn · 1,871 / 1,850 · circ 9.2% · no garage (the plan's smallest, 1,850 sf) | same | 0 err, 0 warn · 1,806 / 1,800 · circ 11.1% · no garage (narrow plan) | same as Lot 514 |
| 4/3.5 office 2-car 2,800 sf | 0 err, 0 warn · 2,805 / 2,800 · circ 9.2% · 2-car: 16' | same | 0 err, 0 warn · 2,351 / 2,350 · circ 11.3% · 2-car: 16' (offered as 4 bed, 2 bath, 2-car, no office: what the narrow plan holds) | same as Lot 514 |
| 5/4 3-car 3,500 sf | 0 err, 0 warn · 2,784 / 2,800 · circ 11.4% · 3-car: 16' + 9' (at 2,800 sf, the largest that fits) | 0 err, 0 warn · 3,506 / 3,500 · circ 10.9% · 3-car: 16' + 9' | 0 err, 0 warn · 2,351 / 2,350 · circ 11.3% · 2-car: 16' (offered as 4 bed, 2 bath, 2-car, no office) | 0 err, 0 warn · 3,506 / 3,500 · circ 10.9% · 3-car: 16' + 9' |
| Garza sample | 0 err, 0 warn · 2,535 / 2,533 · circ 6.7% · no garage | same | 0 err, 0 warn · 2,014 / 2,050 · circ 10.7% · no garage (offered as 3 bed, 2 bath, no office) | same |

Before (round-3 branch): the narrow lot did not fit any program; the 4/3.5 and 5/4 rows carried a west-glass warning on every lot; the 5/4 3-car on McAllen and the corner lot drew one 16' door for three bays; no circulation measure.

The IFC-converted Garza kit runs the same 16 cells with 0 errors (`test/audit.test.mjs`).

## 10 requests in sequence

On the default draft (4/3.5, 2-car, 2,800 sf), Lot 514:

| # | request | outcome | audit after |
|---|---|---|---|
| 1 | make the kitchen 2 feet wider | applied | passes |
| 2 | make the living room 3 feet deeper | applied | passes (1 warn) |
| 3 | make the dining room bigger | applied | passes (1 warn) |
| 4 | make the primary bedroom bigger | applied | passes (1 warn) |
| 5 | make the garage 3 cars | applied | passes (1 warn) |
| 6 | make the primary closet bigger | applied | passes (2 warn) |
| 7 | add a bedroom | applied | passes (2 warn) |
| 8 | add a porch on the back | applied | passes (2 warn) |
| 9 | make the pantry smaller | applied | passes (3 warn) |
| 10 | make bedroom 2 bigger | applied | passes (3 warn) |

10 of 10 applied and pass; after all ten: 0 errors, 3,371 sf, circulation 9.2%, 3-car 16' + 9'. The three warnings: living area 20% over the 2,800 sf asked (the client grew it), and two outside-wall jogs under 2 ft (1.2 ft at the primary closet, 0.6 ft at the mud room) that resizes left behind.

On the Garza sample, Lot 514:

| # | request | outcome | audit after |
|---|---|---|---|
| 1 | make the kitchen 2 feet wider | applied | passes |
| 2 | make the living room 3 feet deeper | applied | passes (1 warn) |
| 3 | make the dining room bigger | applied | passes (1 warn) |
| 4 | make the primary bedroom bigger | applied | passes (1 warn) |
| 5 | make the garage 3 cars | applied | passes (1 warn) |
| 6 | make the primary closet bigger | applied | passes (2 warn) |
| 7 | add a bedroom | applied | passes (2 warn) |
| 8 | add a porch on the back | refused: the plan already has a rear porch | — |
| 9 | make the pantry smaller | applied | passes (2 warn) |
| 10 | make bedroom 2 bigger | applied | passes (3 warn) |

9 of 10 applied and pass (the Garza sample has a rear porch; the eighth is the honest refusal); after all ten: 0 errors, 3,050 sf, circulation 7.3%, 3-car 16' + 9'. Warnings: area 20% over, jogs of 1.8 ft at Bedroom 2 and 1.3 ft at the primary closet.

Before (round-3 branch): the same outcomes, 2 warnings each (west glass and area); the 5/4 on McAllen drew one 16' door for three bays.

## Screenshots (`docs/fix-round-4/`, 1440 × 900 and a true 390 × 844)

| what | desktop | phone |
|---|---|---|
| the site plan tab | `desktop-01-site-plan.png` | `phone-01-site-plan.png` |
| the 3-car garage after "add a bedroom" and "make the garage 3 cars" (plan, 3D) | `desktop-02-plan-3-car.png`, `desktop-03-3d-3-car.png` | `phone-02-plan-3-car.png`, `phone-03-3d-3-car.png` |
| the options picker ("show me garage options") | `desktop-04-options-picker.png` | `phone-04-options-picker.png` |
| Send after the two changes: 5 bed · 3.5 bath · 3-car | `desktop-05-send-counts.png` | `phone-05-send-counts.png` |
| the 50 ft lot plan and its site plan | `desktop-06-narrow-lot-plan.png`, `desktop-07-narrow-lot-site.png` | `phone-06-…`, `phone-07-…` |
| Review: 5 bed · 3.5 bath · 3-car, the audit panel with its ⚠ row | `desktop-08-review-counts-audit.png` | `phone-08-review-counts-audit.png` |
| the PDF file, rasterised: floor plan sheet (24 × 36 portrait, 1/4"), site plan sheet (1" = 10'), the summary | `pdf-24x36-page-1-floor-plan.png`, `pdf-24x36-page-2-site-plan.png`, `pdf-summary.png` | — |

`scripts/shot-round-4.mjs <outDir> [appUrl]` makes them (API on 8787, `vite preview` on 4173, local sign-in).

## Not done, and things to know

- **3D roof**: the garage gable ties into the laundry gable at its ridge end but there is no true valley where the two meet; the dormer, porch sheds and awnings are their own masses. One roof is drawn, no stray slabs; the join is not an architect's valley yet.
- **Round 2 items in three commits, not eleven.** The spec asked for its own commit; they are grouped by subject (see the table).
- **Render timing** for `/api/interpret` was not measured from here (no route out); the local number with no key is about 105 ms.
- **The siding takeoff** for the Garza sample is 7% under the set (2,342 vs 2,529 sf): the aligned wing has fewer corners. The reference test tolerance moved from 6% to 8% with that reason in a comment; stone and tile are unchanged.
- **The narrow plan** holds 4 bed, 2 bath, 2-car, no office, no half bath, no mini primary; the rooms step offers that program on a 50 ft lot and says so.
- **The 5/4 3-car plan** goes on the 24 × 36 sheet at 3/16" (its wing and garage make it 120 × 91 ft with the dimension strings); every other plan of the matrix is at 1/4".
- The old plan-tab Fit button is gone on the Plan and Site views (a double tap or click fits); it stays as Reset on 3D.

## Open questions for Rolando (unchanged)

1. **Price rates** (`src/draft/lib/pricing.js`): $115–120/sf Hidalgo and Starr; $120–130 Cameron and Willacy; $130–145 Jim Wells, Nueces, Kleberg and San Patricio; the style multipliers; the garage at $45–55/sf and porches at $35–45/sf. All placeholders until confirmed.
2. **The drafter's name and photo** for the trust block (`src/draft/lib/trust.js`), the built-homes gallery link, and the "what happens next" timings (1 and 5 business days).
3. **The primary bath and primary closet doors:** the kit opens the primary bath from the primary bedroom and the primary closet from the bath (`d-mbath`, `d-mwic`). Does that match the real Garza set? This round also re-planned the suite entry (a vestibule off the kitchen), the pantry (inside, off the kitchen) and the dining room (the front gable): the drafter should confirm these against what STB would draw.
4. Is the Garza sample meant to have no garage (it drafts as 0-car)?
5. The rule changes from PR #2: plumbing distance 40 ft and the 2 × 3 closet minimum. OK to keep them? (Round 4 adds 24" clear for reach-ins and 5 × 5 for walk-ins on top.)
6. The office PC must run `worker/revit/build_model.py` on a design and send back `report.json` before the Revit sheet item can be called done.
