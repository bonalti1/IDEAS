# Fix round 3: architect-grade plans

From the strict architect review of Nov 17 on `main` 64560a7. The rule for this round: every plan the
app shows or sends must be a plan a licensed architect and a building-department plan reviewer would
accept. The audit that says so is `src/draft/lib/audit.js`; `node scripts/plan-audit.mjs --default`
prints it.

Commits on `claude/revit-workflow-optimization-vjh5id`:

- 183b2c5 Plan audit, wing slots, garage at the service end, wall-pushing resizes (items 1–4, 6)
- 298a99e Opening marks and IFC types, one price function, the audit on Review (items 5, 8, 10, 11, 13)
- 857b9bc Floor plan drawing and PDF, sheet plan, 3D roofs, columns and driveway, trust content (items 7, 9, 12, 14)
- the last commit on the branch: roof masses follow their rooms through a push; the report and screenshots

Tests: `npm test` runs 188 tests, 186 pass, 2 skip (they need a Python with ifcopenshell and a live
plat reader). The build is clean. Screenshots: `docs/fix-round-3/before` (main 64560a7) and
`docs/fix-round-3/after`, at 1440 x 900 and at a true 390 x 844.

## Per item

| # | item | status |
|---|---|---|
| 1 | the audit | done: `auditPlan(rooms, program, kit, lot)` with checks a–i, in the rules (every change, Send, Review), `scripts/plan-audit.mjs`, `test/audit.test.mjs` breaks plans on purpose and sees each check fire |
| 2 | first draft passes on 4 lots x 4 programs | done: wing slots at the rear of the bedroom wing (closet, hall door, egress window), Bath 1 from Bedroom 1, garage at the laundry front- or side-load with its doors and roof; table below |
| 3 | chat adds build real rooms | done: rear porch on the rear wall, 10 ft, never twice; baths with fixtures; bedrooms with closet and egress; roof mass; "move the office next to the laundry" moves the office; `test/requests.test.mjs` |
| 4 | resizes push walls | done: `pushWall` v3 moves, gives, stretches, shrinks porches to 8 ft, settles doors, and the roof follows; a push that crosses a setback, lands on a room or breaks an audit check is undone and the other side tried; refusals name the reason and offer a smaller step; 3-car ≥ 32 ft; tables below |
| 5 | catalog sizes, widths agree | done: elements keep catalog size through every scale; rooms snap to 2"; halls 42"; marks D01/W01 shared by design.json, the schedule and the IFC; `test/widths.test.mjs` (4 x 4, every opening within 0.5") |
| 6 | suite and kitchen | done: `d-mbath` from the bedroom, `d-mwic` from the bath (CONFIRM against the Garza set); fridge and range moved so the triangle is 19.7 ft; aisles 42" (`settleIslands`, `settleKitchen`); audit checks on the matrix |
| 7 | floor plan drawing | done: `src/draft/lib/plan-svg.js` (poché, swings, window and fixture symbols, four dimension strings plus overall, labels that shrink or lead and never overlap, north arrow, scale, title); Plan tab in Draft and Review; "Download PDF" on Send opens the tabloid sheet with the title block for Save as PDF; `test/plan-svg.test.mjs` |
| 8 | price range | done: `src/draft/lib/pricing.js`, one `estimate()` on the rooms step, the draft and Send; range, $/sf, county, "construction only"; `test/pricing.test.mjs` (2,000 sf McAllen = $230k–$240k living; Cameron costs more). **Rates unconfirmed: see questions** |
| 9 | 3D | mostly done: added rooms get a roof mass, overhead doors on the garage, 8x8 porch columns, the driveway, shadows, a sun check; room tags still do not shrink with zoom; materials are the kit's colours, not textures |
| 10 | IFC | done: wall, door and window types named as in `kit.revit`, material layer sets, Pset_WallCommon.IsExternal, Pset_DoorCommon, Pset_WindowCommon with ThermalTransmittance, Pset_SpaceCommon, NetFloorArea for every space, room numbers with the name as LongName, marks, no trailing spaces; checked by a JS parser in `test/widths.test.mjs` |
| 11 | drafter sees the audit | done: Review shows pass/fail per check, sf asked vs delivered, open questions; Approve is off while the audit has errors unless the drafter types an override note, which is logged; the staff link reads "Legacy demo"; the demo worker labels its output demo and uploads no model |
| 12 | Revit worker fills the sheets | code written, needs Revit: `src/draft/lib/sheets.js` is the plan (in design.json), `scripts/sheets-dry-run.mjs` lists 11 views and 4 schedules per sheet, `worker/revit/build_model.py` places the plan with door and window tags and exterior dimension strings on 200 with both schedules, four elevations on 300/301, roof plan on 100, site plan on 99, the index on the cover, and reports what it could not place. **The office PC must run it** |
| 13 | RGV climate | done: porches 8 ft minimum, 10 ft default; windows carry U 0.40 / SHGC 0.25 flagged CONFIRM; the sun check toggle; the audit warns on west glass over 40 sf with no porch |
| 14 | trust | done with placeholders: the team line, the drafter (name and photo are placeholders), the IRC check line, what happens next with dates, a link to built homes; the homeowner's summary page (plan, price range, checks passed, next steps) to save as PDF |
| 15 | "show me options" | not done: no option picker this round |

## The audit, before and after

Before, on `main` 64560a7 (the audit code run against the old layout):

```
Plan audit · first draft: 4 bed, 3.5 bath, 2-car, 2800 sf on Lot 514
  17 errors
  ✗ [door-partial] Bedroom 2 door is wider than the wall Bedroom 2 and Hallway share (2.3 ft).
  ✗ [door-partial] Jack & Jill door is wider than the wall Bedroom 2 and Jack & Jill share (0.0 ft).
  ✗ [door-room] Jack & Jill door sits between Vestibule and Bedroom 1, not on its own wall.
  ✗ [door-outside] Bath 1 door opens to the outside.
  ✗ [door-nowall] Dining door is on no wall.
  ✗ [reach] Bath 1 has no door.
  ✗ [reach] Bedroom 3 has no door.
  ✗ [reach] 2-Car Garage has no door.
  ✗ [window-blocked] Bath 1's window faces into Bedroom 3.
  ✗ [window] Dining has no window on an outside wall.
  ✗ [window] Bedroom 3 has no window on an outside wall.
  ✗ [toilet-side] Primary Bath: the toilet needs 15" from its centreline to each side.
  ✗ [garage-door] 2-Car Garage has no door into the house.
  ✗ [garage-overhead] 2-Car Garage has no overhead door.
  ✗ [suite-bath] Primary Bath does not open from the primary bedroom.
  ✗ [suite-closet] Primary Closet does not open from the primary bedroom or its bath.
  ✗ [triangle] Kitchen work triangle is 35.3 ft (legs 10.3, 7.6, 17.3); it should be 26 ft or less with each leg 4 to 9 ft.
  door widths: 26" ×4, 33" ×5, 35" ×3, 39" ×2, 52" ×2, 79" ×2
```

After:

```
Plan audit · first draft: 4 bed, 3.5 bath, 2-car, 2800 sf on Lot 514
  0 errors
  ! [west-glass] 45 sf of west-facing glass with no porch or awning over it.
Measurements
  living area: 2800 sf delivered, 2800 sf asked (0.0%)
  kitchen work triangle: 19.7 ft (legs 4.3, 8.9, 6.4)
  halls: Hallway 47" clear; Vestibule 53" clear; Hall 41" clear
  door widths: 24" ×1, 28" ×2, 30" ×6, 32" ×5, 36" ×2, 48" ×3, 72" ×2, 192" ×1
```

The Garza sample went from 9 errors (the traced doors, the toilet, the suite, a 33 ft triangle) to 0.

## 4 lots x 4 programs

Before (main): 13, 17, 23 and 9 errors on every lot.

After:

| program | reference (Lot 514) | McAllen 100 x 150 | narrow 50 x 120 | corner 110 x 140 |
|---|---|---|---|---|
| 3/2 1,800 sf | 0 errors, 1 warn | 0 errors, 1 warn | does not fit (plan 63 ft wide, lot 40 ft) | 0 errors, 1 warn |
| 4/3.5 office 2-car 2,800 sf | 0 errors, 1 warn | 0 errors, 1 warn | does not fit (plan 74 ft wide, lot 40 ft) | 0 errors, 1 warn |
| 5/4 3-car 3,500 sf | 0 errors, 1 warn (at 2,750 sf, the largest that fits) | 0 errors, 1 warn | does not fit (plan 79 ft wide, lot 40 ft) | 0 errors, 1 warn |
| Garza sample | 0 errors | 0 errors | does not fit (plan 74 ft wide, lot 40 ft) | 0 errors |

The warning is the west-glass note. The narrow 50 ft lot cannot take this kit's plan at any size and
the rooms step says so before drafting. Lot 514 is a skewed parcel: the 5-bed 3-car plan is drafted at
2,750 sf there, the largest that fits, and the rooms step says that too.

## The 10 requests, reference lot, each on a fresh draft

| request | before (main) | after |
|---|---|---|
| make the kitchen 2 feet wider | applied, 20 audit errors | applied, passes |
| make the living room 3 feet deeper | applied, 10 errors | applied, passes |
| make the dining room bigger | applied, 20 errors | applied, passes |
| make the primary bedroom bigger | applied, 11 errors | applied, passes |
| make the garage 3 cars | refused ("There is no garage in this plan") | applied, passes |
| make the primary closet bigger | applied, 11 errors | applied, passes |
| add a bedroom | applied, 10 errors | applied, passes |
| add a porch on the back | refused (not understood) | refused: the sample already has a rear porch |
| make the pantry smaller | applied, 9 errors | applied, passes |
| make bedroom 2 bigger | refused | applied, passes |

Before: 0 of 10 applied and passed. After: 9 of 10 (the tenth is the honest refusal the spec allows).

Five resizes in a row on the default draft: before 0 of 5 applied; after 5 of 5, and the plan passes
the audit with 0 errors. In the app on a McAllen lot (screenshots), all ten requests in a row apply.

## Screenshots

`docs/fix-round-3/before` and `docs/fix-round-3/after`, desktop (1440) and phone (390 x 844):

- `01-rooms-price`: the rooms step with the price range
- `03-plan-first`: the first draft's plan (before: the top-down 3D; after: the drawing)
- `04-3d-bedroom-garage`: 3D after "add a bedroom" and "make the garage 3 cars"
- `05-plan-after-10`: the plan after the ten requests
- `07-send-price`: Send with the price range and the PDF button
- `09-review-audit`: the drafter's Review with the audit panel (before: no panel)

## Questions for Rolando

1. **Price rates.** `src/draft/lib/pricing.js` has $115–120/sf for Hidalgo and Starr, $120–130 for
   Cameron and Willacy, $130–145 for Jim Wells, Nueces, Kleberg and San Patricio, from the website.
   Are these the rates to show? Style multipliers (ranch 0.96, farmhouse 1.00, hill country 1.06,
   spanish 1.08, modern 1.12) are placeholders.
2. **Garage and porch $/sf.** The config says garage $45–55/sf and porches $35–45/sf. Both are
   placeholders until you confirm them.
3. **The drafter's name and photo**, and the link to built homes (`src/draft/lib/trust.js`). The
   screens show "Your drafter" with a monogram until then. The "what happens next" dates (1 business
   day for review, 5 for the sheet set, then a meeting) need your confirmation too.
4. **Kit doors.** The primary bath door now opens from the primary bedroom and the primary closet from
   the bath. Does that match the Garza set, or does the closet open from the bedroom?
5. **The office PC** must run `worker/revit/build_model.py` on a design and report what it placed
   (`sheetsPlaced` and `sheetsNotPlaced` in report.json). Elevations, the roof plan's view range, the
   schedule columns and the dimension references are the parts most likely to need a tweak in Revit.
6. Window U-factor and SHGC are set to the IECC zone 2 limits and flagged CONFIRM against the supplier.

## Not done or partly done

- Item 15 ("show me options"): not started.
- Item 9: room tags in 3D do not yet shrink with zoom; materials are flat colours.
- Item 7: the PDF is the browser's Save as PDF from a print view, not a generated file.
- A kit read back from an IFC (`scripts/kit-from-ifc.py`) does not yet carry every door's room and
  exterior flag, so its draft fails the architect audit; the test reports the count without asserting
  it. The hand-traced farmhouse kit passes.
