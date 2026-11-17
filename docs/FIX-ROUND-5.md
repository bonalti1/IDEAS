# Fix round 5

From the strict review of PR #4. Branch `claude/fix-round-5`, branched from `claude/fix-round-4` (PR #4 was open and unmerged when this round started), so the PR for this round is stacked on PR #4.

Commits, in order:

| commit | what |
|---|---|
| 5019727 | The driveway is a real path, owners get one view, and the PDF libraries are patched (P0 items 1, 2, 3) |
| 9734502 | Plans an STB designer would sign: swings, the guests' bath, the suite entry, the kitchen, the halls, the narrow plan's rear, a compact 3/2 (P1 items 4–10) |
| 902c640 | Drawings, phone, chat: the PDF's sans font, labels clear of fixtures, tabloid at 1/8", real options, whole-house size and swaps, the IFC program and the inbox cache, the Render check step, 3D door panels (P1 items 11–16, P2 items 17, 18) |
| 3e6ea2b | Chat and offers that hold up: a swap grows the room to its minimum, a whole-house size answers in seconds, a garage never lands on a room, an offer drafts the plan it names, thumbnails open on a phone (what the browser run and the tables turned up) |
| bd28663 | A fit offer names the plan nearest the ask (the 5/4 on the 50 ft lot gets the narrow plan, not the compact); the screenshot script shows the whole chat bubble and trims its crops |
| f5e8688 | A whole-house size the plan is already at is said so ("already about 2,356 sf"), not offered as a fix that would fail |

Tests: `npm test` → **{{TESTS}}** (the two skipped are the `LIVE=1` tests: a Stripe Checkout session in test mode, which needs `STRIPE_SECRET_KEY`, and Claude reading the Garza site plan with the FEMA lookup, which needs the key and the internet). `npm run build` clean. Every item below has a test that failed before its fix and passes after it, except the three that are only visible in a browser (12, 13, 18), which the screenshot script checks and the notes record, and 17, which cannot be measured from here.

`npm audit --omit=dev`:

```
found 0 vulnerabilities
```

## Item by item

### P0

| # | item | status | tests |
|---|---|---|---|
| 1 | Courtyard garage: a drivable path | done (5019727). `lib/site.js` lays the driveway as slabs: the apron at the overhead door, a leg across the rear yard, a 10 ft lane down the side yard to the street, with a 20 ft turning pocket; `drivewayProblem()` says when a slab leaves the lot, narrows under 10 ft, or runs through a room; the audit's `garage-street` check uses it and `measures.driveway` carries the length. `attachGarage()` only keeps a candidate whose driveway has no problem, so the first draft never draws a lane through a closet (the round-4 McAllen 2-car did: "the driveway lane runs through the closet", 160 ft). The site plan and the PDF draw the same slabs | `test/site.test.mjs`: the courtyard garage on the McAllen lot drives down the side yard; the audit refuses a driveway through a room, one that leaves the lot, and a turn with no 20 ft pocket. `test/garage.test.mjs` every cell |
| 2 | ownerView on every owner endpoint | done (5019727). One `ownerView()` in `server/projects.mjs`, applied to the list, the detail, and what update, change, fix, rollback and send return; no owner response carries the audit, the office questions, an override note, the errors it covered or the drafter id | `test/accounts.test.mjs`: after an override approval, no owner view carries the override note…; GET /api/projects goes through the owner view |
| 3 | jsPDF advisories | done (5019727). jsPDF 4.2.1 and svg2pdf.js 2.9.0; the PDF code moved to the 4.x API (`useFont`, `addFileToVFS`). A test runs `npm audit --omit=dev` and fails on any high or critical advisory in the shipped dependencies | `test/deps.test.mjs` |

### P1 plan

| # | item | status | tests |
|---|---|---|---|
| 4 | Mud room swings and approaches | done (9734502). Audit errors `swing-swing` (two doors hit each other open), `swing-fixture` (a door swings into a fixture) and `door-approach` (a fixture in the 30" in front of a door), on every room; `CLEAR.approachIn = 30`. The kitchen–mud door is a pocket door (`pocket: true`: no swing, drawn dashed, a sliding operation in the IFC, a flat leaf in 3D); the bench sits on a wall with no door; the fridge and the counter are clear of the door fronts (`settleKitchen`). On the round-4 plans the new checks found 7 errors on the default draft, 6 on the Garza sample, 13 on the 5/4 (the baths, the kitchen's mud door, the closets' doors) | `test/plan-r5.test.mjs`: the audit catches a door swinging into another door…; the default draft, the Garza sample and a 3/2: no swing meets another or a fixture, 30" clear in front of every door… |
| 5 | Half bath off a public space | done (9734502). The standard plan has a gallery (`mhall`, cased opening from the dining room) with the half bath and the pantry off it; the mud room and laundry are behind. Audit warning `powder-reach`: a half bath reached only through the mud room, laundry or garage | `test/plan-r5.test.mjs` (the two above) |
| 6 | Suite entry away from the kitchen | done (9734502). The primary suite is entered from the gallery, not through the kitchen's work zone. Audit warning `suite-kitchen` (the path from the front door to the primary door crosses the work triangle) | `test/plan-r5.test.mjs` |
| 7 | Kitchen triangle 15–22 ft | done (9734502). Range at 50.5–53, fridge at 54.5–57, sink on the island: default 20.3 ft (was 25.6), Garza 19.4 (was 24.9), 5/4 21.4 (was 23.4); `triangle` warns over 22 (`CLEAR.triangleGoodFt`) | `test/plan-r5.test.mjs` (triangle 15–22 on the three) |
| 8 | Hall over 35 ft warned; the 5-bed wing | done (9734502). `measures.halls[].lengthFt`; warning `hall-long` over 35 ft (`CLEAR.hallLongFt`). `extendWing()` puts the second bath across the hall from the bedrooms (east, behind the porch line) when the wing would grow past half a room: the 5/4 hall is 55.8 ft (was 61.5) with rooms on both sides at its end. **Still warned**: the standard plan's single-loaded wing is 45.8 ft with four bedrooms and the narrow plan's hall 41–60 ft; the warning says so on every such draft (see the matrix). A double-loaded wing for the standard plan is a re-plan of the kit, not done | `test/plan-r5.test.mjs`: a hall over 35 ft is warned: the 5-bed wing has one, the 3/2 does not; the 5-bed wing puts the second bath across the hall… |
| 9 | Narrow plan: rear door and the hall bath | done (9734502). `farmhouse-narrow.js`: Bath 2 between Bedrooms 3 and 4, the dining room with a door to the yard, the laundry and a drop zone off a short cross hall; warning `rear-door` (no door from the living room, kitchen or dining room to the back yard) | `test/plan-r5.test.mjs`: the narrow plan… |
| 10 | Compact 3/2, 1,300–1,600 sf | done (9734502, 3e6ea2b). `src/kits/farmhouse-compact.js`, 37.5 ft wide, 1,450 sf drawn, chosen for asks under 1,750 sf; drafts 1,308 / 1,471 / 1,593 sf for 1,300 / 1,450 / 1,600 with a 2-car garage or none, on the 50 ft and the 100 ft lots, 0 errors. Asks of 1,750–1,850 sf land on the standard plan's floor (1,871 sf, up to 7% over, said on the rooms step). A fit offer now drafts on the plan it names (at the top of the compact range the next plan was drawn instead), and when the ask is outside every plan's range the plan nearest the ask is offered first (the 5/4 3,500 sf on the 50 ft lot gets the narrow plan's 4/2 2-car at 2,350 sf, not the compact 3/2) | `test/plan-r5.test.mjs`: the compact plan… within 3%…; a fit offer drafts on the plan it names |

### P1 drawings, phone, chat

| # | item | status | tests |
|---|---|---|---|
| 11 | PDF font, labels, tabloid | done (902c640). Liberation Sans Regular and Bold embedded in every PDF (`public/fonts/`, `useFont()`); the SVG uses the same family. Labels are placed inside the room clear of its fixtures (`spotFor`), with a leader when the room is too small. Tabloid is always 1/8" = 1'-0": a plan that runs past one 11 × 17 sheet goes on two (A-200, A-201) with match lines; a plan that fits goes on one. The PDF file itself is checked in the screenshot run with `pdffonts` and `pdftotext` (the notes say "Liberation Sans embedded: yes" and list the label words found) | `test/plan-svg.test.mjs`: labels never cross a fixture and sit inside their room, on the 4 × 4; `test/site.test.mjs`: tabloid is always 1/8"… split in two |
| 12 | Site tab title clipped at 1440 | done (902c640). The drawing's title and subtitle are fitted to the width the sheet gives them (`fitFont`, on the floor plan and the site plan), so the long McAllen title no longer runs past the view at 1440; the stats row under the drawing wraps | `docs/fix-round-5/desktop-01-site-plan.png` |
| 13 | Phone at 390 | done (902c640). The user bubble and the price note are their own rows; the Plan / Site / 3D bar is its own row under the drawing (`.viewport-stage`, `.viewport-views`); every step of the flow is screenshotted at a true 390 × 844 and at 430 × 932, and the script measures the rows (notes: "user bubble y 570–610, price note y 508–564 → separate rows"; "Plan/Site/3D bar y 483–523 vs the drawing y 135–483 → its own row") | `docs/fix-round-5/phone390-*.png`, `phone430-*.png`, `notes.txt` |
| 14 | Real options | done (902c640, 3e6ea2b). `lib/options.js`: the garage as front-load, side-load, a tandem third bay, one bay more or fewer, none; the rear porch at 8, 10 or 12 ft; the next bedroom in line or across the hall, a bath across the hall; up to four, each applied to a copy and run through the rules and the audit, duplicates dropped. On Lot 514 the default draft gets front, side-load and tandem; on the 100 × 150 McAllen lot the side-load's 25 ft apron does not fit and the 3-car is already a tandem, so the picker offers 2-car and none (the notes say so). Thumbnails open full size on a tap, on a phone too (a disabled pick button was swallowing the taps inside it) | `test/options.test.mjs`: the garage options offer a side-load and a tandem third bay where the lot takes them; the wing options offer the next bedroom in line or across the hall; screenshots `*-05-options-garage.png`, `*-06-option-full-size.png`, `*-07-options-wing.png` |
| 15 | Chat: "make the house 3000 sf", "swap the office and the dining room", "show me options for the garage" | done (902c640, 3e6ea2b). `scale` op (the living area within the plan's range, service rooms kept, 4 s; it was 35–100 s with the roof clipped at every search step) and `swap` op (two rooms trade rectangles, doors and windows, get fixtures for their new kind; a room landing under its new kind's minimum grows to it in the same change). The server's schema and prompt know both; the regex fallback reads the three phrases. On a lot that cannot take the size, the reply names the largest that fits and offers it as the fix; when the house is already at that size it says so instead (the McAllen flow, drafted at 2,356 sf: "the largest it fits here with these rooms is about 2,350 sf, which is about where it is now"). **To know**: on a plan the fit already trimmed to its lot, a smaller size hits the room minimums (the service rooms keep their size, so the public rooms take the whole cut: "make the house 2,200 sf" on the McAllen draft refuses with the kitchen under 9 ft); the sizes work on a plan with room to move (Lot 514: 2,650, 3,000 sf apply with 0 errors) | `test/options.test.mjs`: typed in chat: "make the house 3,000 sf" scales the plan…; "swap the office and the dining room" on the default draft applies…; `test/accounts.test.mjs`: with no Claude key the office answers a change in under a second |
| 16 | IFC program; inbox as-built | done (902c640). The IFC's `Program` property comes from `programOf(rooms)` (5 bed, 3-car after the chat changes, not the first ask); the drafter inbox caches the as-built program per project version | `test/widths.test.mjs`: the IFC property set says the program as drawn; `test/accounts.test.mjs`: …the drafter does, cached per version |

### P2

| # | item | status | tests |
|---|---|---|---|
| 17 | Render fallback timing | partly. `scripts/launch-check.mjs` has a step "fallback timing: /api/interpret and a chat change under 1 s (no Claude key)" that runs against the deployed URL. Locally, with no Claude key, a chat change answers in well under a second (the accounts test asserts it); with the key the office answers the three round-5 phrases in 2–6 s, the model call included. **Not measured on Render from here** (no route out of this sandbox); run `node scripts/launch-check.mjs <url>` after the deploy | `test/accounts.test.mjs` (under a second, locally) |
| 18 | 3D garage door panels; labels by zoom | done (902c640). Overhead doors are drawn as a white sectional slab set into the garage wall with four panel lines; room tags shrink as the camera pulls back and are hidden past 400 ft (small past 260, tiny past 160) | `docs/fix-round-5/desktop-04-3d-3-car.png` |

## Before and after, by the round-5 audit

The round-4 plans (branch `claude/fix-round-4`) and this round's plans, both judged by this round's audit. Numbers from `scripts`-style runs in the sandbox (the script is in the session scratchpad; the matrix below is reproducible with `node test/plan-r5.test.mjs`).

| plan | before (round 4) | after (round 5) |
|---|---|---|
| default draft 4/3.5 2-car 2,800, Lot 514 | 7 errors, 4 warnings · triangle 25.6 ft · hall 45.8 ft · driveway 56 ft | 0 errors, 1 warning (hall-long 45.8 ft) · triangle 20.3 ft · driveway 56 ft |
| Garza sample, Lot 514 | 6 errors, 3 warnings · triangle 24.9 ft | 0 errors, 0 warnings · triangle 19.4 ft |
| 5/4 3-car 3,500, Lot 514 | 13 errors, 3 warnings (at 2,800 sf, the largest that fit) · hall 61.5 ft · triangle 23.4 ft | 0 errors, 1 warning (hall-long 55.8 ft) · 3,555 sf · triangle 21.4 ft · driveway 48 ft |
| 4/3.5 2-car 2,800, McAllen 100 × 150 | 8 errors, 4 warnings · 2,805 sf · **the driveway lane runs through the closet** (160 ft) | 0 errors, 1 warning (hall-long 41.8 ft) · 2,356 sf (the largest with a real driveway) · driveway 99 ft, crosses no room |
| narrow plan 4/2 2-car 2,350, 50 × 120 | 5 errors, 2 warnings (no rear door) · hall 59.5 ft | 0 errors, 1 warning (hall-long 59.5 ft) · driveway 35 ft |
| 3/2 2-car 1,450, 50 × 120 | 5 errors, 2 warnings · drafted at the plan's smallest, 1,862 sf | 0 errors, 0 warnings · 1,471 sf (compact plan) · hall 32.3 ft · driveway 58 ft |

The round-4 errors were the ones the new checks catch: bath doors swinging into the water closet or the shower, the mud room's doors hitting each other, the counter and the range in front of the kitchen–mud door, the bench in front of the half bath door, the primary closet's door into the shower, and the half bath reached only through the mud room.

## 4 lots × 4 programs (after)

Each cell: errors, warnings (ids) · the program as asked → as drafted, with the living sf · circulation % · garage doors · driveway path length and whether it crosses a room. Produced by the round-5 tables script (in the session scratchpad); the same 16 cells run in `test/audit.test.mjs` and `test/garage.test.mjs`.

| program | Lot 514 | McAllen 100 × 150 | narrow 50 × 120 | corner 110 × 140 |
|---|---|---|---|---|
| 3/2 1,800 sf | 0 err, 0 warn · asked 3/2 g0 1,800 → 3/2 g0 1,871 sf (the plan's smallest, 1,850) · circ 10% · no garage · no driveway | same | 0 err, 1 warn (hall-long) · 3/2 g0 → 3/2 g0 1,811 sf · circ 10.6% · no garage | same as Lot 514 |
| 4/3.5 office 2-car 2,800 sf | 0 err, 1 warn (hall-long) · 4/3.5 g2 → 4/3.5 g2 2,801 sf · circ 9.8% · 2-car 16' · driveway 56 ft, crosses no room | 0 err, 1 warn (hall-long) · → 4/3.5 g2 2,356 sf (at 2,350, the largest that fits) · circ 10.1% · 2-car 16' · driveway 99 ft, crosses no room | 0 err, 1 warn (hall-long) · → 4/2 g2 2,351 sf (what the narrow plan holds: no office, no half bath) · circ 11.3% · 2-car 16' · driveway 35 ft, crosses no room | 0 err, 1 warn (hall-long) · → 4/3.5 g2 2,166 sf, without the office · circ 10.9% · 2-car 16' · driveway 95 ft, crosses no room |
| 5/4 3-car 3,500 sf | 0 err, 1 warn (hall-long) · 5/4 g3 → 5/4 g3 3,555 sf · circ 9.7% · 3-car 16' + 9' · driveway 48 ft, crosses no room | 0 err, 1 warn (hall-long) · → 5/4 g3 2,566 sf (at 2,550) · circ 10% · 3-car tandem 16' · driveway 76 ft, crosses no room | 0 err, 1 warn (hall-long) · → 4/2 g2 2,351 sf (what the narrow plan holds) · circ 11.3% · 2-car 16' · driveway 35 ft, crosses no room | 0 err, 1 warn (hall-long) · → 5/4 g0 3,555 sf, without the garage · circ 9.7% · no garage |
| Garza sample | 0 err, 0 warn · 3/3.5 + mini primary → 4/3.5 g0 2,556 sf · circ 7.7% · no garage | same | 0 err, 1 warn (hall-long) · → 3/2 g0 2,005 sf (what the narrow plan holds) · circ 10.3% · no garage | same as Lot 514 |

What the table says plainly:

- **Every cell passes with 0 errors.** The one recurring warning is `hall-long`: the standard plan's bedroom wing is a single-loaded hall (45.8 ft with four bedrooms) and the narrow plan's is 41–60 ft. The warning is the audit telling the truth about the kit; a double-loaded wing for the standard plan is a kit re-plan.
- **A real driveway costs living area on the 100 ft lots.** The 4/3.5 2-car on McAllen drafts at 2,350 sf (round 4 drew 2,805 with the lane through a closet). The 3-car on McAllen and the corner lot is a 22 × 44 tandem; the 33 ft wide garage does not fit beside the house with a drivable apron.
- **The narrow lot** takes the narrow plan (4 bed, 2 bath, 2-car, no office, no half bath) for the 4/3.5 and the 5/4 asks, at 2,350 sf, the largest that fits its depth.
- **Side-load garages** fit only Lot 514: the 25 ft apron to the side lot line leaves the 100–110 ft lots.
- The Garza sample's mini primary counts as a bedroom in `programOf`, hence "4 bed" on the Garza rows (an open question below).

## 10 requests in sequence

On the default draft (4/3.5, 2-car, 2,800 sf), Lot 514:

| # | request | outcome | audit after |
|---|---|---|---|
| 1 | make the kitchen 2 feet wider | applied | passes (1 warn) |
| 2 | make the living room 3 feet deeper | applied | passes (2 warn) |
| 3 | make the dining room bigger | applied | passes (2 warn) |
| 4 | make the primary bedroom bigger | applied | passes (2 warn) |
| 5 | make the garage 3 cars | applied | passes (2 warn) |
| 6 | make the primary closet bigger | applied | passes (3 warn) |
| 7 | add a bedroom | applied | passes (3 warn) |
| 8 | add a porch on the back | applied | passes (3 warn) |
| 9 | make the pantry smaller | applied | passes (3 warn) |
| 10 | make bedroom 2 bigger | applied | passes (3 warn) |

10 of 10 applied and pass; after all ten: 0 errors, 3 warnings (hall-long, area 16% over the ask, a jog), 3,249 sf, circulation 8.3%, 3-car 16' + 9'.

On the Garza sample, Lot 514:

| # | request | outcome | audit after |
|---|---|---|---|
| 1 | make the kitchen 2 feet wider | applied | passes (1 warn) |
| 2 | make the living room 3 feet deeper | applied | passes (2 warn) |
| 3 | make the dining room bigger | applied | passes (2 warn) |
| 4 | make the primary bedroom bigger | applied | passes (2 warn) |
| 5 | make the garage 3 cars | refused: there is no free wall at the laundry for a garage | — |
| 6 | make the primary closet bigger | applied | passes (3 warn) |
| 7 | add a bedroom | applied | passes (4 warn) |
| 8 | add a porch on the back | refused: the plan already has a rear porch | — |
| 9 | make the pantry smaller | applied | passes (4 warn) |
| 10 | make bedroom 2 bigger | applied | passes (5 warn) |

8 of 10 applied and pass; after all ten: 0 errors, 5 warnings, 3,051 sf, circulation 8%, no garage. The fifth is new this round and honest: after the primary bedroom grew (step 4) a 33 ft wide 3-car garage beside the laundry would push the house past the lot, and the tandem the round-4 code fell back to ran through the primary bedroom (the rules refused it with "would run into"). A garage never lands on a room now; on the fresh Garza sample "make the garage 3 cars" still applies (33 × 22, 0 errors).

## Screenshots (`docs/fix-round-5/`, 1440 × 900, a true 390 × 844, and 430 × 932)

Before pictures are round 4's, in `docs/fix-round-4/`.

| what | before (round 4) | after, desktop | after, phone |
|---|---|---|---|
| the McAllen 100 × 150 site plan with the driveway (apron, lane down the side yard, to the street) | `fix-round-4/desktop-01-site-plan.png` (the lane through the closet) | `desktop-01-site-plan.png` | `phone390-01-site-plan.png`, `phone430-01-site-plan.png` |
| the mud room zoomed (pocket door to the kitchen, bench on a wall with no door, the half bath off the gallery) | — | `crop-mud-room-zoom.png` | — |
| the narrow plan's rear (Bath 2 by Bedrooms 3 and 4, the dining room's door to the yard, the laundry and drop zone off the cross hall) | `fix-round-4/desktop-06-narrow-lot-plan.png` | `crop-narrow-plan-rear.png`, `desktop-09-narrow-lot-plan.png`, `desktop-10-narrow-lot-site.png` | `phone390-09-narrow-lot-plan.png`, `phone390-10-narrow-lot-site.png` |
| the PDF page zoomed on the baths (Liberation Sans, labels clear of the fixtures) | `fix-round-4/pdf-24x36-page-1-floor-plan.png` | `desktop-pdf-baths-zoom-1.png`; the sheets `desktop-pdf-archd-1.png`, `desktop-pdf-tabloid-1.png`, `desktop-pdf-summary-1.png`; the files `desktop-plan-24x36.pdf`, `desktop-plan-11x17.pdf`, `desktop-summary.pdf` | — |
| the phone chat after "make the garage 3 cars": the user bubble, the price note and the Plan / Site / 3D bar each on their own row | `fix-round-4/phone-02-plan-3-car.png` | — | `phone390-02-phone-chat.png`, `phone430-02-phone-chat.png` |
| every step at 390 and 430: start, lot, style, rooms | — | — | `phone390-00a-start.png` … `phone390-00d-rooms.png`, `phone430-00a…00d` |
| the plan and 3D with the 3-car (door panels in 3D) | `fix-round-4/desktop-02-plan-3-car.png`, `desktop-03-3d-3-car.png` | `desktop-03-plan-3-car.png`, `desktop-04-3d-3-car.png` | `phone390-03-…`, `phone390-04-…`, `phone430-03-…`, `phone430-04-…` |
| the new options: "show me options for the garage", a thumbnail opened full size, "show me options for the bedrooms" | `fix-round-4/desktop-04-options-picker.png` | `desktop-05-options-garage.png`, `desktop-06-option-full-size.png`, `desktop-07-options-wing.png` | `phone390-05…07`, `phone430-05…07` |
| Send after the changes | `fix-round-4/desktop-05-send-counts.png` | `desktop-08-send.png` | `phone390-08-send.png`, `phone430-08-send.png` |
| Review: the audit panel | `fix-round-4/desktop-08-review-counts-audit.png` | `desktop-11-review-audit.png` | `phone390-11-review-audit.png` |

`scripts/shot-round-5.mjs <outDir> [appUrl]` makes them (API on 8787, `vite preview` on 4173, local sign-in); `notes.txt` beside them records what the script measured (the chat rows, the PDF fonts and label words, each typed phrase's answer).

## Not done, and things to know

- **Render timing (17)**: the launch-check step exists; the number on Render is not measured from this sandbox.
- **`hall-long` on the standard plan with four or more bedrooms and on the narrow plan**: the warning is right; a double-loaded wing for the standard kit is a re-plan, not done this round. The 5-bed wing is shorter (55.8 ft, was 61.5) and double-loaded at its end.
- **Side-load garages** draft only where the 25 ft apron fits (Lot 514 of the four).
- **The 3-car on 100 ft lots** is a tandem (22 × 44); the wide 33 ft garage does not fit with a drivable apron.
- **The McAllen 4/3.5 2-car drafts at 2,350 sf**, not 2,800: that is what fits with a real driveway. The rooms step says so and offers it.
- **The compact plan** covers 1,200–1,750 sf asks; 1,750–1,850 land on the standard plan's floor (1,871 sf, said on the rooms step).
- **"swap the office and the dining room"** on the default draft now applies by growing the dining room to 9 × 9 in the office's spot (the office's 10.25 × 7.25 was under the dining minimum, which is why the first run refused it).
- **The PDF label test** on the PDF file itself runs in the screenshot script (`pdffonts`, `pdftotext`), not in `npm test`: jsPDF needs a browser. The SVG side is in `npm test`.
- **The tabloid split** happens only when the plan runs past one 11 × 17 sheet at 1/8" (the 5/4 3-car does; the McAllen 2,350 sf flow's plan fits on one, so its tabloid PDF has two pages: the plan and the site).

## Open questions for Rolando (unchanged)

1. **Price rates** (`src/draft/lib/pricing.js`): $115–120/sf Hidalgo and Starr; $120–130 Cameron and Willacy; $130–145 Jim Wells, Nueces, Kleberg and San Patricio; the style multipliers; the garage at $45–55/sf and porches at $35–45/sf. All placeholders until you confirm them.
2. **The drafter's name and photo** for the trust block (`src/draft/lib/trust.js`), the built-homes gallery link, and the "what happens next" timings (1 and 5 business days).
3. **The primary bath and primary closet doors** (`d-mbath`, `d-mwic`) and the suite / pantry / dining as re-planned this round (the gallery, the half bath off it) against the real Garza set.
4. Is the Garza sample meant to have no garage (it drafts as 0-car)? And does its mini primary count as a bedroom on the summary (it does now: "4 bed")?
5. The rule changes from PR #2: plumbing distance 40 ft and the 2 × 3 closet minimum. OK to keep them? (This round adds 30" in front of every door and the swing checks on top.)
6. On 100 ft lots: a side-yard driveway to a side-load garage does not fit with the 25 ft apron. Is a narrower apron acceptable in your builds, or should those lots always be front-load?
7. The office PC must run `worker/revit/build_model.py` on a design and send back `report.json` before the Revit sheet item can be called done.
