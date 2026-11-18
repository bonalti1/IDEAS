# Fix round 6

From the review of PR #5. Branch `claude/fix-round-6`, branched from `claude/fix-round-5` (PR #5 was open and unmerged when this round started), so the PR for this round is stacked on PR #5. Nothing on the PR #3, #4 or #5 branches was touched.

Commits, in order (one per item where the item has its own files; `layout.js` and `audit.js` carry more than one item, said in the message):

| commit | what |
|---|---|
| 329a795 | The bedroom wing grows at the front and across the hall before it grows long: no hall over 35 ft on the default, the 4/3.5 or the 5/4 (item 2) |
| 49777df | A garage-forward variant of the standard plan for 70–100 ft lots; anisotropic fit, quarter-foot fit steps, plan offers that step down their range (item 1, and the fit changes the matrix needed) |
| 66b7ee0 | Narrow plan rear access, the primary's window, Bedroom 3 cut to size; the rear-door check and the side yards; `swing-small`; the hall as its enclosed run (items 3, 5, and the audit side of 2) |
| 9c7691f | Compact plan: mud room exterior door, pocket doors, pantry swings; door swings and pockets through the IFC round trip (items 4, 5) |
| c0694a3 | Price the flatwork (item 12) |
| 633eb92 | Tandem said plainly everywhere; `program.asked` stored and shown (items 9, 10) |
| d71cab0 | Lot specs validated at the door; a 5xx answers with a generic line and the detail in the log; a crash in the error handler fixed (item 13) |
| 86f288f | Arch D stays at 1/4": a long plan splits across two sheets with match lines (item 14) |
| 73f005d | "Make the house N sf" re-drafts when the stretched plan fails, the client's edits put back, what could not be kept named (item 6) |
| cf0b99b | A request in parts says which part went through; the round-6 chat tests (item 7) |
| 6c19a75 | Refusals offer the next best thing: plain words, one bay less, a tandem bay, a new draft with the garage (item 8) |
| ad6e9a2 | Wing option "Split the bedrooms across the hall" (item 11) |
| 23fe5ac | Options build one candidate a turn; the round-6 screenshot script completes the 430 phone set; API test for the re-draft fix (items 15, 16) |
| 3fd2f33 | A garage change on the garage-forward plan comes with its fallbacks; new-draft garage options; the narrow lot offers the narrow plan at the size it takes; the picker uses the async build (what the tables and the browser run turned up) |

Tests: `npm test` → **250 tests, 248 pass, 0 fail, 2 skipped** (the two skipped are the `LIVE=1` tests, as in round 5: a Stripe Checkout session in test mode and Claude reading the Garza plat with the FEMA lookup). `npm run build` clean. `npm audit --omit=dev`: `found 0 vulnerabilities`. Every item has a test that failed before its fix and passes after it, except 15 and the spinner half of 16, which are only visible in a browser: the screenshot script checks them and `docs/fix-round-6/notes.txt` records what it measured.

## Item by item

### P1 plan

| # | item | status | tests |
|---|---|---|---|
| 1 | Garage-forward variant for 70–100 ft lots | done (49777df). `src/kits/farmhouse-front-garage.js` builds `KIT.plans.frontgarage` from the standard plan: the kitchen at the street side and the dining room behind it, an east column with the primary suite at the rear and the pantry, mud room, laundry and the garage at the front, the garage face toward the street. `fromPlan` draws it when the standard plan has no garage on the lot or fits under 97%, and only when the variant fits and has its garage. Width and depth now scale apart when the lot is tight (depth capped at 1.4×), the fit steps in quarter feet when the slack is under 2 ft, and a draft capped on depth is not offered as a fit. On McAllen 100 × 150: the 4/3.5 2-car drafts **2,829 sf (101% of 2,800)** with a 31 ft driveway, the 5/4 3-car **3,509 sf (100%)** with a 32 ft driveway, both 0 errors (round 5: 2,356 sf and 2,566 sf, driveways 99 and 76 ft). The corner 110 × 140 4/3.5 keeps its office at 2,829 sf. **Not met**: the corner 5/4 3-car drafts at 2,562 sf (73% of the ask; the 84 ft envelope takes the variant with a 3-car only that small); the rooms step says so and offers it | `test/audit.test.mjs`: first draft audit, every cell, livingSf ≥ 0.97 × the drafted ask; the garage-forward cells on McAllen and the corner (sf, driveway ≤ 45 ft, 0 errors) |
| 2 | Double-load the wing | done (329a795). `extendWing` puts the first extra bedroom across the hall against the living room's back wall with its door at the front end of the hall (the hall grows 1.5 ft, not a room), and a second extra bath in a column beside it; the mini-primary's spot at the front of the wing takes a bedroom first. Halls: default 29.8 ft (was 45.8), 5/4 33.5 (was 55.8), narrow 3/2 21.4; circulation 7.4% / 6.9% / 12.0% (the narrow 3/2 at its floor sits on the 12% mark; its warning does not fire). **Still warned**: a 6-bed wing (48.3 ft) | `test/plan-r5.test.mjs`: a hall over 35 ft is warned: a 6-bed wing has one; the default, the 5-bed and the 3/2 do not; the 5-bed wing geometry |
| 3 | Narrow plan rear access | done (66b7ee0). `farmhouse-narrow.js` redrawn: the dining room on the rear wall with a 72" pair to the yard, the kitchen beside it, a 4 ft cross hall to the pantry and Bath 2 beside Bedroom 3, Bedroom 3 cut to the others' size (15.5 × 12.5), the fourth bedroom last in the list so a 3-bed drops the right room; the primary keeps a window (the rear one goes only when Bedroom 4 stands there). The audit's `rear-door` counts a side-wall door only where the side yard is 10 ft or more (`CLEAR.sideYardFt`). **To know**: the narrow 4/2 tops out at 2,200 sf and the 3/2's floor is about 1,850 sf on the 50 ft lot (the plan's rooms at their minimums); the tests say so | `test/plan-r6.test.mjs`: the narrow plan's rear access…; `test/plan-r5.test.mjs`: the narrow plan: the hall bath sits beside Bedroom 3…; `test/audit.test.mjs` narrow cells |
| 4 | Compact plan's mud room | half done (9c7691f). The mud room gets an exterior door when the plan has no garage (`d-mud-ext`, `unless: 'garage'`) and a pocket door to the kitchen. **Not done**: one open living / kitchen / dining room at 1,300 sf; the compact plan keeps its three rooms (the 3'-6" hall between them stays) | `test/plan-r6.test.mjs`: the compact plan: the mud room has a door out… |
| 5 | Pantry doors; no door into a room under 25 sf | done (9c7691f, 66b7ee0). The standard plan's pantry door is a pocket door, the compact's and the narrow's swing out; audit error `swing-small` (`CLEAR.swingRoomSf = 25`, halls and foyers excepted). The IFC door pset carries Swing, Hinge, Pocket and Barn so `scripts/kit-from-ifc.py` rebuilds the same doors (the converted kit used to force a swing into the pantry) | `test/plan-r6.test.mjs`: swing-small…; `test/kits.test.mjs` (the converted kit passes) |

### P1 chat

| # | item | status | tests |
|---|---|---|---|
| 6 | "Make the house N sf" re-drafts | done (73f005d). `decide()` tries the stretch first; when it throws or fails the rules it calls `redraft()`: `generateRooms` at the rooms' counted program and the new size on the same lot, then the client's room-level edits applied again one by one (from the version log on the office, `editsOf(versions)`, reading past rollbacks; from the chat on the client), each kept only if it still applies and passes. The reply says "Re-drafted the house at 3,222 sf: stretching the rooms as they were would not pass (…). Your earlier changes still stand: "make the kitchen 2 feet wider". Could not keep: …". Under the plan's floor it names the smallest size and offers it as a fix that itself applies; past the lot it names the largest. The ladder on the default draft: 2,000 → "the rooms fall under their minimums; the smallest this plan goes with these rooms is about 2,300 sf" with the fix *Make it 2,300 sf* (applies); 2,200 → 2,299 sf; 2,400 → 2,417; 2,600 → 2,641; 2,700 → 2,689 (stretched); 3,000 → 3,025; 3,200 → 3,222 (all 0 errors). On McAllen (garage-forward plan): 2,000 names 2,300; 2,200 → 2,299 on the standard plan; 2,400–3,200 stretch in place (2,390 / 2,599 / 2,706 / 2,991 / 3,201). The help text's "make the house 2,400 sf" now works where it is suggested | `test/round6-chat.test.mjs`: the size ladder…; a re-draft puts the client's room edits back…; the edit log reads past a rollback…; `test/round6-api.test.mjs`: a fix the plan cannot take in place is a new draft through the office (the earlier edit accounted for) |
| 7 | Say when part of a request was dropped | done (cf0b99b). The fallback reads clauses joined by and / then / also / commas as parts (a swap stays whole); `decide()` applies a multi-part diff (the fallback's parts, or a model diff with more than one op) part by part when the whole fails, and answers "Done: …; Not done: … (why). This counts as one change, for what was done." "make the house 3000 sf and add a bedroom" on the default draft does both (5 bed, 3,223 sf, 0 errors). The office charges one credit per applied request, so a part-applied request is one credit, for what was done | `test/round6-chat.test.mjs`: "make the house 3000 sf and add a bedroom" does both… |
| 8 | Refusals offer the next best thing | done (6c19a75, 3fd2f33). "there is no free wall at the laundry for a garage" is now "There is no room for a garage against the laundry on this plan."; `garageFallbacks()` tries one bay less, a tandem bay and a new draft with that garage, offers each only if it applies, and the same fixes lead the reply when a garage change breaks the rules in place (the garage-forward plan: "make the garage 3 cars" → *Re-draft the house with a 3-car garage*, which draws 2,854 sf with the 3-car, as the browser run shows). The `redraft` op draws the house again with a program change and the client's edits put back, on the office and in the browser. Narrow 3/2 "add a garage": refused in plain words with *Re-draft the house with a 2-car garage* (applies, 0 errors); the garage options on that plan offer the same new draft. Garza 10 requests in sequence: **9 of 10** (8 as typed, the 9th with one tap on *Make it a 2-car garage instead?*; the 10th is "the plan already has a rear porch") | `test/round6-chat.test.mjs`: a garage that will not go where asked…; on the garage-forward plan "make the garage 3 cars"…; the Garza sample: at least 9 of the 10…; `test/round6-api.test.mjs` |
| 9 | Tandem UX | done (633eb92). `programOf` carries `tandem`; `programLine` says "3-car (tandem: one bay two cars deep)" everywhere it is used (the summary, the title block, the IFC `Program` property); the garage option is labelled the same; the chat suggestions count a tandem bay as three cars the way `options.js` does | `test/round6.test.mjs`: a tandem third bay is said so… |
| 10 | Keep what the client asked for | done (633eb92). Taking a fit offer on the rooms step stores `program.asked` (the program as first asked, with its sf); Send and Review show "Asked for: 4 bed · 3.5 bath · 2-car · 2,800 sf → drafted 2,356 sf to fit the lot" when it is there; it rides through create, detail and the list | `test/round6.test.mjs`: a program carries what was asked…; `test/round6-api.test.mjs`: a project keeps what the client first asked for… |
| 11 | Wing option "split bedrooms" | done, narrowly (ad6e9a2). With `wingSplit` the extra bedrooms stack on both sides of the hall and the extra baths fill the band the hall opens for the second one (two rooms a band). The option *Split the bedrooms across the hall (shorter hall)* appears on a plan with a hall over 30 ft and only when the re-draft does shorten it. **To know**: with the double-loaded wing from item 2 the first extra bedroom already sits across the hall with its bath beside it, so the split pays off only from two extra bedrooms and two extra baths: the 6/5 goes from 54.8 to 48.3 ft. For the default, the 5/4 and the 6/4 it draws the same house and is not offered | `test/round6-chat.test.mjs`: a split wing: the 6/5 is offered… |

### P1 business

| # | item | status | tests |
|---|---|---|---|
| 12 | Price the flatwork | done (c0694a3). `flatwork(rooms, kit, lot)` in `takeoff.js` measures the driveway and the front walk from the slabs the site plan draws; `takeoff()` carries `areas.driveway / walk / flatwork`; `RATES.flatworkPerSf = [6, 9]` (**CONFIRM**, a 4" broom-finish slab), `estimate()` has `parts.flatwork` and `areas.flatwork`, the rate line says "driveway and walk $6–9/sf", Send shows the sf and the line in the breakdown. With a program alone (the rooms step) a 30 ft drive the garage's width and a 4 ft walk stand in. McAllen 4/3.5: 722 sf, $4,332–6,498 | `test/round6.test.mjs`: the driveway and the front walk are in the takeoff and priced as flatwork…; `test/pricing.test.mjs` |

### P2

| # | item | status | tests |
|---|---|---|---|
| 13 | Validate lot specs at the door | done (d71cab0). `projects.checkLot(lot)` on create and update: a typed lot needs a width and depth of 20–5,000 ft, a plat needs its boundary calls (or a drafter's confirmation), and whatever the lot service builds must have a boundary and a buildable area; else `400 the lot cannot be built from what was sent (manual, 0 x 150): give it a width and depth, or an address, or a plat with its boundary calls`. A 5xx answers "Something went wrong on our side; the office has the detail. Try again in a moment." and logs the stack. **Found on the way**: the first cut of that handler read a variable out of its scope, so any 5xx (the 503 of a checkout without Stripe) crashed the server; the test now checks the server stays up | `test/round6-api.test.mjs`: a lot spec the office cannot build is refused at the door…; a fault on our side answers 500 with a generic line… |
| 14 | Arch D at 1/4" for the 5/4 | done (86f288f). `sheetFor` keeps Arch D at 1/4" = 1'-0" and splits a plan that runs past one 24 × 36 sheet across two with match lines, the way tabloid does at 1/8" | `test/site.test.mjs` (the sheet tests) |
| 15 | Phone 430 set complete | done (23fe5ac). `scripts/shot-round-6.mjs` runs the narrow lot and the review at 430 × 932 too: `phone430-09-narrow-lot-plan.png`, `phone430-10-narrow-lot-site.png`, `phone430-11-review-audit.png` | the screenshots, `notes.txt` |
| 16 | Option speed | done, the light way (23fe5ac, 3fd2f33). `optionsForAsync()` builds the picker one candidate a turn of the event loop, so the "Working on it…" spinner paints between candidates instead of the page freezing; `Draft.jsx` uses it. No worker: the plan code is shared with the office and not bundled for one | `test/round6-chat.test.mjs`: the options come out the same built one candidate a turn… |

## Before and after, by the round-6 audit

The round-5 plans (branch `claude/fix-round-5`) and this round's plans, both judged by this round's audit (which adds `swing-small` and the side-yard rule for `rear-door`, and measures a hall as its enclosed run). The full output is `docs/fix-round-6/before-after.md`.

| plan | before (round 5) | after (round 6) |
|---|---|---|
| default draft 4/3.5 2-car 2,800, Lot 514 | 1 error (swing-small: pantry), 1 warning (hall-long 45.8 ft) · 2,801 sf · triangle 20.3 · driveway 56 ft | 0 errors, 0 warnings · 2,804 sf · hall 29.8 ft · triangle 20.5 · driveway 57 ft |
| Garza sample, Lot 514 | 1 error (swing-small) | 0 errors, 0 warnings · 2,556 sf · hall 28.5 ft |
| 5/4 3-car 3,500, Lot 514 | 1 error (swing-small), 1 warning (hall-long 55.8 ft) · 3,555 sf | 0 errors, 0 warnings · 3,521 sf · hall 33.5 ft · driveway 59 ft |
| 4/3.5 2-car 2,800, McAllen 100 × 150 | at 2,350 sf: 1 error, 1 warning (hall-long 41.8) · 2,356 sf · driveway 99 ft | 0 errors, 0 warnings · **2,829 sf** (garage-forward plan) · hall 30.5 ft · driveway 31 ft |
| 5/4 3-car 3,500, McAllen 100 × 150 | at 2,550 sf: 1 error, 1 warning (hall-long 46.8) · 2,566 sf · driveway 76 ft | 0 errors, 2 warnings (triangle 22.0 ft, hall-long 39.8 ft) · **3,509 sf** (garage-forward plan) · driveway 32 ft |
| 4/3.5 office 2-car 2,800, corner 110 × 140 | without the office: 1 error, 1 warning (hall-long 41.3) · 2,166 sf · driveway 95 ft | 0 errors, 0 warnings · 2,829 sf **with the office** · driveway 31 ft |
| narrow plan 4/2 2-car 2,350, 50 × 120 | 0 errors, 2 warnings (hall-long 39.5, no rear door) · 2,351 sf | as the narrow plan draws it, 2,202 sf: 0 errors, 0 warnings · hall 21.4 ft · driveway 35 ft |
| narrow plan 3/2 1,800, 50 × 120 | 0 errors, 1 warning (no rear door) · 1,811 sf | 0 errors, 0 warnings · 1,847 sf (the plan's smallest, 1,850) |
| 3/2 2-car 1,450 (compact), 50 × 120 | 1 error (swing-small) · 1,471 sf | 0 errors, 0 warnings · 1,471 sf |
| compact 3/2 no garage 1,300, McAllen | 1 error (swing-small) · 1,308 sf | 0 errors, 0 warnings · 1,308 sf (the mud room has its door out) |

## 4 lots × 4 programs (after)

Each cell: the plan drawn · errors, warnings (ids) · the program as asked → as drafted, with the living sf and its share of the drafted ask · circulation % · the longest hall · the kitchen triangle · garage doors · driveway length and slabs. Produced by the round-6 tables script (in the session scratchpad; the full output is `docs/fix-round-6/tables.md`); the same 16 cells run in `test/audit.test.mjs` and `test/garage.test.mjs`.

| program | Lot 514 | McAllen 100 × 150 | narrow 50 × 120 | corner 110 × 140 |
|---|---|---|---|---|
| 3/2 1,800 sf | standard · 0 err, 0 warn · 3/2 g0 → 1,871 sf (the plan's smallest, 1,850) · circ 10% · hall 29.3 · triangle 19 · no garage | same | narrow · 0 err, 0 warn · → 1,847 sf (the plan's smallest) · circ 12% · hall 21.4 · triangle 19 | same as Lot 514 |
| 4/3.5 office 2-car 2,800 sf | standard · 0 err, 0 warn · → 4/3.5 g2 2,804 sf (100%) · circ 7.4% · hall 29.8 · triangle 21 · 2-car 16' · driveway 57 ft, 1 slab 1,031 sf | garage-forward · 0 err, 0 warn · → 4/3.5 g2 2,829 sf (101%) · circ 7.6% · hall 30.5 · triangle 20 · 2-car 16' · driveway 31 ft, 558 sf | narrow · 0 err, 0 warn · → 4/2 g2 2,202 sf (what the narrow plan holds: no office, no half bath) · circ 11.6% · hall 21.4 · triangle 19 · 2-car 16' · driveway 35 ft, 630 sf | garage-forward · 0 err, 0 warn · → 4/3.5 g2 2,829 sf (101%) · as McAllen |
| 5/4 3-car 3,500 sf | standard · 0 err, 0 warn · → 5/4 g3 3,521 sf (101%) · circ 6.9% · hall 33.5 · triangle 21 · 3-car 16' + 9' · driveway 59 ft, 1,067 sf | garage-forward · 0 err, 2 warn (triangle, hall-long) · → 5/4 g3 3,509 sf (100%) · circ 7.1% · hall 39.8 · triangle 22 · 3-car 16' + 9' · driveway 32 ft, 568 sf | narrow · 0 err, 0 warn · → 4/2 g2 2,202 sf (what the narrow plan holds) | garage-forward · 0 err, 1 warn (jog) · → 5/4 g3 **2,562 sf, at 2,550** · circ 7.2% · hall 29.3 · triangle 18 · 3-car 16' + 9' · driveway 32 ft, 567 sf |
| Garza sample | standard · 0 err, 0 warn · 3/3.5 + mini primary → 4/3.5 g0 2,556 sf (101%) · circ 7.7% · hall 28.5 · triangle 19 · no garage | same | narrow · 0 err, 0 warn · → 3/2 g0 2,002 sf (what the narrow plan holds) · circ 11.6% · hall 21.6 | same as Lot 514 |

What the table says plainly:

- **Every cell passes with 0 errors**, and 13 of 16 with 0 warnings. The `hall-long` warning is gone from the standard plan (the wing is double-loaded); it stays on the McAllen 5/4 3-car, where the garage-forward plan's dining room sits where the across-the-hall bedroom would go, so the wing grows west (39.8 ft).
- **The garage-forward plan gives the 100 ft lots their full size**: 2,829 and 3,509 sf on McAllen with 31–32 ft driveways and one slab (round 5: 2,356 and 2,566 sf with 76–99 ft lanes down the side yard). The corner 4/3.5 keeps its office.
- **The corner 5/4 3-car is the one short cell**: 2,562 sf on the 84 ft envelope (the 3-car and the side-street setback together). The rooms step names it and offers it.
- **The narrow lot** takes the narrow plan at the size it holds: 4/2 2-car at 2,202 sf for the 4/3.5 and the 5/4 asks (round 5's 2,351 came with a 39.5 ft hall and no rear door), the 3/2 at its 1,850 floor.

## 10 requests in sequence

On the default draft (4/3.5, 2-car, 2,800 sf), Lot 514: **10 of 10** applied and pass; after all ten 0 errors, 3 warnings, 3,319 sf, circulation 6.6%, 3-car 16' + 9' (the table is in `docs/fix-round-6/tables.md`).

On the Garza sample, Lot 514:

| # | request | outcome | audit after |
|---|---|---|---|
| 1 | make the kitchen 2 feet wider | applied | passes (1 warn) |
| 2 | make the living room 3 feet deeper | applied | passes (2 warn) |
| 3 | make the dining room bigger | applied | passes (2 warn) |
| 4 | make the primary bedroom bigger | applied | passes (2 warn) |
| 5 | make the garage 3 cars | refused: "There is no room for a garage against the laundry on this plan." → one tap on *Make it a 2-car garage instead?* | passes (2 warn) |
| 6 | make the primary closet bigger | applied | passes (3 warn) |
| 7 | add a bedroom | applied | passes (4 warn) |
| 8 | add a porch on the back | refused: "The plan already has a rear porch." (nothing to offer) | — |
| 9 | make the pantry smaller | applied | passes (4 warn) |
| 10 | make bedroom 2 bigger | applied | passes (5 warn) |

**9 of 10** applied and pass (8 as typed, the 9th with one tap on the offered fix); after all ten: 0 errors, 5 warnings, 3,135 sf, circulation 6.7%, 2-car 16'. On a fresh Garza sample "make the garage 3 cars" applies as typed.

## The chat size ladder (default draft, Lot 514)

| asked | answer |
|---|---|
| 2,000 sf | refused: "At 2,000 sf the rooms fall under their minimums; the smallest this plan goes with these rooms is about 2,300 sf." → fix *Make it 2,300 sf*, which applies (2,299 sf) |
| 2,200 sf | re-drafted, 2,299 sf |
| 2,400 sf | re-drafted, 2,417 sf |
| 2,600 sf | re-drafted, 2,641 sf |
| 2,700 sf | stretched in place, 2,689 sf |
| 3,000 sf | re-drafted, 3,025 sf |
| 3,200 sf | re-drafted, 3,222 sf |

Every applied size passes the audit with 0 errors; each answer comes in under 200 ms with no model call (`test/round6-chat.test.mjs` runs the ladder).

## HTTP owner-view re-check

Against the office API run for the screenshots (local sign-in): the owner's list, detail, and what update and rollback return carry none of override, overrideNote, drafterId, confirmedBy, confirmNote or the errors an override covered (list 514 bytes, detail 90,615 bytes). The override path itself is exercised by `test/accounts.test.mjs` (after an override approval, no owner view carries the override note…), which passes.

## Screenshots (`docs/fix-round-6/`, 1440 × 900, a true 390 × 844, and 430 × 932)

Before pictures are round 5's, in `docs/fix-round-5/`.

| what | before (round 5) | after |
|---|---|---|
| the McAllen 4/3.5 first draft on the garage-forward plan: the site plan with its 31 ft driveway | `fix-round-5/desktop-01-site-plan.png` (99 ft lane down the side yard, 2,356 sf) | `desktop-01-site-plan.png`, `site-mcallen-4-35.png`, `plan-mcallen.png`; `phone390-01…`, `phone430-01…` |
| McAllen 5/4 3-car, corner 4/3.5: plans and sites | — | `plan-mcallen54.png`, `site-mcallen-5-4-3car.png`, `site-corner-4-35.png` |
| the default draft and the 5/4 on Lot 514 with the double-loaded wing | `fix-round-5/desktop-03-plan-3-car.png` (45.8 ft hall) | `plan-default.png`, `plan-five.png` |
| the narrow plan: the dining room's pair to the yard, Bath 2 beside Bedroom 3, Bedroom 3 cut to size | `fix-round-5/crop-narrow-plan-rear.png` | `plan-narrow32.png` (3/2 1,800), `plan-narrow42.png` (4/2), `desktop-09-narrow-lot-plan.png`, `desktop-10-narrow-lot-site.png`, `crop-narrow-plan-rear.png`; `phone390-09/10…`, **`phone430-09-narrow-lot-plan.png`, `phone430-10-narrow-lot-site.png`** |
| the compact 3/2 with no garage: the mud room's door out | — | `plan-compact0.png` |
| the chat: "make the garage 3 cars" refused on the garage-forward plan with *Re-draft the house with a 3-car garage*, tapped, the 3-car drawn | `fix-round-5/desktop-03-plan-3-car.png` | `desktop-03-plan-3-car.png`, `desktop-04-3d-3-car.png`; `phone390-02-phone-chat.png`, `phone430-02-phone-chat.png` |
| the options, a thumbnail opened, the wing options; Send with the flatwork line | `fix-round-5/desktop-05…08` | `desktop-05-options-garage.png`, `desktop-06-option-full-size.png`, `desktop-07-options-wing.png`, `desktop-08-send.png`; the phones' `05…08` |
| Review: the audit panel, at 430 too | `fix-round-5/desktop-11-review-audit.png` | `desktop-11-review-audit.png`, `phone390-11…`, **`phone430-11-review-audit.png`** |
| the PDFs (Arch D at 1/4", tabloid at 1/8", the summary) | `fix-round-5/desktop-pdf-*.png` | `desktop-pdf-archd-1.png`, `desktop-pdf-tabloid-1.png`, `desktop-pdf-summary-1.png`, `desktop-pdf-baths-zoom-1.png`; the files `desktop-plan-24x36.pdf`, `desktop-plan-11x17.pdf`, `desktop-summary.pdf` |

`scripts/shot-round-6.mjs <outDir> [appUrl]` makes them (API on 8787, `vite preview` on 4173, local sign-in); `notes.txt` beside them records what the script measured (the chat rows, the PDF fonts and label words, each typed phrase's answer and the fix tapped). The plan and site renders (`plan-*.png`, `site-*.png`) come straight from `planSVG` / the site plan of the first draft.

## Not done, and things to know

- **Item 4, second half**: one open living / kitchen / dining room for the compact plan at 1,300 sf is not re-planned; the mud room door and the pocket door are.
- **The corner 5/4 3-car** drafts at 2,562 sf: the garage-forward plan with a 3-car fits the 84 ft envelope only that small, and the standard plan has no drivable garage there. The rooms step offers it; a side-load on the side street would be the designer's answer and is not drawn.
- **The McAllen 5/4 3-car** carries two warnings on the garage-forward plan: a 39.8 ft hall (the dining room takes the across-the-hall slot) and a 22.0 ft triangle (at the mark).
- **A 6-bed wing** is still a 48 ft hall and warned; the split option shortens the 6/5 only (to 48 ft from 55).
- **The narrow plan's range**: 4/2 up to 2,200 sf; the 3/2 floor is about 1,850 sf (the audit test allows 6% there, said in the test).
- **The 3/2 1,800 on wide lots** draws the standard plan at its 1,850 floor (1,871 sf), as in round 5.
- **Item 7's charge**: the office charges a request once when any part applies; the reply says the charge is for what was done. A refusal is not charged.
- **Item 16**: no worker; the picker yields between candidates so the spinner paints. The candidates themselves still run on the main thread, one at a time.
- **Flatwork with a program alone** (the rooms step, before a plan exists) is a stand-in: a 30 ft drive the garage's width and a 4 ft walk.
- **The fallback's clause split** reads "and", "then", "also", commas and semicolons; a swap ("the office and the dining room") is kept whole. With the Claude key, the model's own multi-op diff is applied part by part when the whole fails.
- **The round-6 audit on the round-5 plans** finds one new error on most of them, `swing-small` (the pantry door swinging into a 18–25 sf pantry), which this round's kits fix.

## Open questions for Rolando

Carried over:

1. **Price rates** (`src/draft/lib/pricing.js`): $115–120/sf Hidalgo and Starr; $120–130 Cameron and Willacy; $130–145 Jim Wells, Nueces, Kleberg and San Patricio; the style multipliers; the garage at $45–55/sf and porches at $35–45/sf. All placeholders until you confirm them.
2. **The drafter's name and photo** for the trust block (`src/draft/lib/trust.js`), the built-homes gallery link, and the "what happens next" timings (1 and 5 business days).
3. **The primary bath and primary closet doors** and the suite / pantry / dining as re-planned in round 5 (the gallery, the half bath off it) against the real Garza set.
4. Is the Garza sample meant to have no garage (it drafts as 0-car)? And does its mini primary count as a bedroom on the summary (it does: "4 bed")?
5. The rule changes from PR #2: plumbing distance 40 ft and the 2 × 3 closet minimum. OK to keep them? (Round 5 added 30" in front of every door and the swing checks; this round adds no door swinging into a room under 25 sf.)
6. On 100 ft lots: a side-yard driveway to a side-load garage does not fit with the 25 ft apron. The garage-forward plan answers this round; is a side-load still wanted there?
7. The office PC must run `worker/revit/build_model.py` on a design and send back `report.json` before the Revit sheet item can be called done.

New this round:

8. **Flatwork $/sf**: $6–9/sf for a 4" broom-finish driveway and walk is a placeholder (`RATES.flatworkPerSf`). What does STB pay, and does the price include the apron and the walk to the porch?
9. **The garage-forward plan**: is a garage face at the front setback with a 31 ft driveway acceptable in your subdivisions (McAllen, Palmview, Pharr), and is there an HOA or city rule on garage-forward elevations we should draw to? Should it be the first choice on 70–100 ft lots or only when the courtyard garage does not fit (today: only when the standard plan has no garage or fits under 97%)?
10. **Tandem**: do you sell a tandem third bay (one bay two cars deep) as a "3-car"? The app says "3-car (tandem: one bay two cars deep)" everywhere; if you would rather not offer it, the option and the fallback come off in one place (`options.js`, `attachGarage`).
11. **The corner 5/4 3-car at 2,562 sf**: should that lot get a side-load from the side street instead of a smaller house?
