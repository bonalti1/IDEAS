# Draft House fix round 11: the zoning block holds, curved frontages, the proxy chain, and the small-screen leftovers

Branch `claude/fix-round-11`, on top of `claude/fix-round-10` @1bf059b. Pictures in `docs/fix-round-11/`.

One sentence: a homeowner can no longer clear the zoning block (the server reads the zoning itself), a curved frontage is front on all of its chords (2002 Kiskadee Ln: six chords, 49.92 ft), the per-address limit can no longer be shared by every visitor, and a FEMA outage no longer fails the live test.

**Rules kept.** No money in the client app (the no-money suite passes, 7 of 7, with the internet on). 10 free changes per plan, the office grants more. No owner data in fixtures, logs or tests: the four new recordings keep only ids, legal, situs and acres (owner strings in kept columns: 0 in each), and the daily check stores owner and mailing as yes or no.

**Live.** Everything marked "live" was run from this box on Nov 19, 2026. The RGV911 map server (Hidalgo and Willacy) did not answer for part of the day; it came back and items 2 and 6 were then verified live.

## P1

| # | Item | What changed | Test (fails before, passes after) | Picture | Status |
|---|------|--------------|-----------------------------------|---------|--------|
| 1 | A homeowner can clear the zoning block on a confirmed parcel lot | `server/projects.mjs`: `ownerLot()` drops `zoning` (and `confirmedBy`, `confirmedAt`, `confirmNote`) from whatever the browser sends, for every kind of lot. For a parcel lot the server reads the zoning itself in `readZoning()`: the cached parcel record, its interior point, `zoning.lookup()` (cached). When the outline is unchanged (same kind, same calls, same parcel id) the stored zoning and the stored confirmation stay. `confirmLot()` reads the zoning again when a drafter confirms and stamps it `confirmedBy` and `confirmedAt`. A lookup the save needs counts against the lookup limit only when it is not already cached. | `test/round11.test.mjs` "1: the five steps of the review…": the same five steps over HTTP on 118 S Cage Blvd, Pharr (C-2). Step 4 (PUT with `zoning: { district: 'R-1', residential: true }`) answers 200 and the lot keeps C-2; step 5 (Send) is **409**. Also: a project created with no zoning, or a forged one, is stored C-2; a swapped parcel id on the same outline loses the confirmation; Kerria (R-1) is not blocked. Before: step 5 was 200 (the review's run). | none (HTTP) | Done |
| 2 | A curved frontage is front on only 2 of its 6 chords | `server/parcels.mjs` `frontFromRoads()`: the front grows from the chosen edge along its neighbours, both ways. A neighbour joins while it is under 25 ft, turns less than 30° from the last front chord, and faces the same road (cos > 0) within 30 ft of the nearest front distance (see "Different from the brief": 20 ft kept four of the six). `frontWidthFt` is the sum and `frontChords` the count. The Lot card says it once: "street side (Kiskadee Ln) 49.92' along the curve, in 6 pieces". Kiskadee is recorded (`test/fixtures/parcels/kiskadee-2002-mission.json`) and is in the acceptance set, the daily check and the live test. | "2: a curved frontage is front on all six chords…" (a built pie lot, plus a two-piece frontage and an edge that turns more than 60°), and "2 and 6 on the live recordings…": edges 0–4 and 10 are front, 49.92 ft, `buildLot` gives six front edges. `test/lot-front.test.mjs` reads the card on screen at 1440 and 390 px. Live acceptance asserts six chords and ≥ 45 ft. Before, on round 10's code with the same recording: front on 2 edges, 16.63 ft. | `lot-kiskadee-1440.png`, `lot-kiskadee-390.png` | Done, verified live |
| 3 | `TRUST_PROXY_HOPS=1` is probably wrong on Render | `server/net.mjs`: `proxyChain()` and `proxyChainLine()`; `server/index.mjs` logs one line at the first request, and once more at the first request that carries `CF-Connecting-IP`: `proxy chain: X-Forwarded-For has 3 entries; CF-Connecting-IP is entry 3 from the right; TRUST_PROXY_HOPS is 3 (right)` or `… (set it to N)`. Positions only, never an address. `render.yaml` now sets 3. Fail safe: `isSharedAddress()` (private ranges, carrier NAT 100.64/10, loopback, link-local, Cloudflare's published v4 and v6 ranges, and anything that is not an address) leaves the per-address key out, and the per-user key stays. `docs/DEPLOY.md` replaces "look for your address" with the log line. | "3: an address every visitor shares is never a limiter key…" and "3 over HTTP…": with a limit of 1 lookup per user and 3 per address, five users behind one Cloudflare address each get their lookup (on round 10 the fourth was refused), five behind one public address get 3 and then 429, each user still has their own limit, and the log has the chain line ("… entry 2 from the right; TRUST_PROXY_HOPS is 1 (set it to 2)") with no address in it. | none | Done; the value 3 is **not verified** until the office reads the line on Render (question 1) |

## P2

| # | Item | What changed | Test (fails before, passes after) | Picture | Status |
|---|------|--------------|-----------------------------------|---------|--------|
| 4 | The live acceptance test fails on a FEMA outage | `server/lots.mjs`: each FEMA call gets two more tries after a wait of 1 s, then 3 s (`FEMA_BACKOFF_MS`), 8 s per try. Layers 3 and 28 go first, side by side; layer 0 only when both are empty, then 1 and 34, and those three are one try each and never fail the lookup. `test/live-acceptance.test.mjs`: `FEMA_DOWN` on the flood step is a skip with a note ("FEMA did not answer for N of 14 addresses"), not a failure. | "4: FEMA gets two more tries with a wait…": on a dead FEMA, three tries on each of layers 3 and 28 and not one call to 0, 1 or 34, with nothing cached; on a live one, 3 and 28 first, then the soft layers; a soft layer that fails costs one call and does not fail the lookup; and a source check that the live test skips on `FEMA_DOWN`. | none | Done |
| 5 | The daily check does not check what round 10 fixed | `dailyCheck()`: per address the street side's width within 1 ft of the recorded one, the corner flag, the number of front pieces where recorded, and owner and mailing presence as booleans (never the values). `failedDays` is counted per address, and the email goes out when an address fails two runs in a row. The Sources page shows the reason and the run count. | "5: the daily check covers the street side, the corner and owner presence…": a made-up owner passes, no owner fails with "no owner came back", no email on the first failed run and one on the second, a width that drifts with TIGERweb down is named, recovery resets the count. | none | Done |
| 6 | Willacy: an address-point mismatch falls through to "none" | `server/parcels.mjs`: `situsNear()` (same street, house number off by 1 to 9). When the address point's parcel is listed that way and the point lies inside the parcel, it is kept; if the situs search then finds nothing, it is the answer, marked `confidence: 'near'` with `listedAs`, and the disagreement is still logged for the Sources page. The Lot card tells the homeowner: "the appraisal district lists it as 329 11TH. Check that it is your lot; the drafter checks it too." | "6: an address point whose parcel is listed a few numbers off…" (six off is taken, thirty off and another street are not, Pharr is unchanged) and "2 and 6 on the live recordings…": 323 N 11th St is parcel 11327, near, front 50.18 ft. Before, on round 10's code with the same recording: `none`. | `lot-n-11th-near-1440.png` | Done, verified live |
| 7a | 390 px: the north arrow's "N" is clipped under the header | The top view is always north-up, so its north mark is now a fixed mark in the corner of the picture (`.compass` in `HouseScene.jsx`), outside the 3D canvas; the arrow drawn in the scene stays for the turning 3D views. | `test/lot-front.test.mjs`: the mark's box lies inside the picture for every lot at 1440 and 390 px. (My first version put it 124 px off the left edge; this check caught it.) | `address-check-w-nolana-390.png` | Done |
| 7b | The Draft step shows "10 changes left" twice | The card's line is gone; the header pill stays and turns to the "low" colour at 2 or fewer. | `test/no-money.test.mjs`: "changes left" appears once on the Draft step at both widths. | `phone-04-draft.png` | Done |
| 7c | 3D: the roofs are still overlapping gables on the 2,800 sf default | `src/draft/lib/roof.js`: a ridge end is one of three things. A listed gable stays a gable. A ridge that meets a roof as high or higher within 20 ft runs into it and stops there, clipped to the plan of the other masses, with a wall triangle where it shows above the lower roof. Any other end closes with a hip at its own wall. No roof sheet runs over open ground past its wall any more. | "7: a roof runs on past its wall only under a higher roof…": on the default plan the left wing has its hip, the garage roof covers no open ground, and the wall triangle sits at the back wall. | `desktop-04-draft.png`, `phone-04-draft.png` | Done as a massing model: see "Not met" |

### The 14 addresses, live from this box

| Address | Parcel | Street side | Flood | Zoning | Matched by |
|---|---|---|---|---|---|
| 1201 Kerria Ave, McAllen | 255056 | 79.75 ft on Kerria Ave (corner: N 12th St) | no digital FIRM | R-1 | address point |
| 36 Melissa Dr, Brownsville | 144311 | 63.53 ft on Melissa Dr | X, 48061C | R-1 | situs |
| 5435 Curtis Clark Dr, Corpus Christi | 236866 | 31.15 ft on Curtis Clark Dr | X, 48355C | SF-6 | situs |
| 3305 N 27th St, McAllen | 177413 | 65.23 ft on N 27th St | no digital FIRM | R-1 | situs near the point |
| 1534 Armagoza Dr, Edinburg | 634314 | 67.43 ft on N Armagoza Dr | no digital FIRM | RP | address point |
| 3013 Yvonne St, Edinburg | 121595 | 54.9 ft on E Yvonne St | no digital FIRM | RP | address point |
| 2218 Royal Palm Dr, Mission | 273291 | 80.28 ft on Royal Palm Dr (corner: E Griffin Pkwy) | no digital FIRM | no layer | address point |
| 2454 E 30th St, Brownsville | 52374 | 50.17 ft on E 30th St | X, 48061C | R-2 | situs |
| 4175 Sierra Madre Dr, Brownsville | 42520 | 50.04 ft on Sierra Madre Dr | X, 48061C | R-2 | situs |
| 118 S Cage Blvd, Pharr | 259430 | 256.69 ft on S Cage Blvd (corner: W Caffery St) | no digital FIRM | C-2 | situs |
| **2002 Kiskadee Ln, Mission** | 707917 | **49.92 ft in 6 pieces** on Kiskadee Ln | no digital FIRM | no layer | address point |
| **323 N 11th St, Raymondville** | 11327 | 50.18 ft on N 11th St | flood hazard area, 48489C | no layer | address point, **near** (listed as 329 11TH) |
| **510 W Harris Ave, Raymondville** | 15848 | 74.87 ft on W Harris Ave (corner: S 4th St) | flood hazard area, 48489C | no layer | address point |
| **344 SE 3rd St, Premont** | 34725 | 49.92 ft on SE 3rd St | X, 48249C | no layer | situs |

The four in bold are new this round. Owner and mailing came back for all 14 (checked as present, never printed).

## Found on the way and fixed

- **A pie lot lost half its buildable area.** The picture of Kiskadee showed it: the envelope was a 1,614 sf triangle on a 5,881 sf lot (1,627 sf on round 10, so not new). The setback line of each chord of a street side that curves into the lot, run on across the lot, cut off what its neighbours left. `envelopeOf()` (`src/draft/lib/lot.js`) now also tries one line for a run of gently turning edges with the same setback: square to the run's mean direction, the setback behind the run's deepest point. It keeps whichever leaves more room. Kiskadee is 3,026 sf (the true inset of the curve is about 3,200). It is still the safe side: test "2 (found on the way)…" checks on all 14 recorded lots that no corner of the envelope is nearer a lot line than that line's setback.
- **The street-side setback line of a curved frontage was labelled "SIDE".** Only one chord carries the street's name; the others now take it too ("20' — KISKADEE LN").
- **The house faced the first chord of a curved frontage.** It now faces the middle of the curve (the length-weighted mean of the front pieces). A lot with one front edge is unchanged.
- **A swapped parcel id kept the confirmation.** "Same outline" compared only the calls. It now needs the same parcel id too, so a homeowner cannot keep a drafter's confirmation while pointing the lot at another parcel.
- **Saving a lot spent a lookup.** The server's own zoning read used the homeowner's lookup allowance even when the parcel was already cached. It now counts only a real call to the county.
- **Willacy and Jim Wells had no recordings and no daily check.** Three recordings (323 N 11th St, 510 W Harris Ave, 344 SE 3rd St) and all three addresses are now in the acceptance set, so both counties' column mappings are tested in CI, daily and live.
- **The recorder did not replay the street side's width.** It now records and replays `frontWidthFt`, `frontChords` and the match confidence, and fails if the replay differs from the live answer.
- **A frontage drawn in pieces of exactly 25 ft** would have lost its second piece under the new "under 25 ft" rule. A neighbour of any length still joins when it faces the road squarely at about the same distance (round 10's rule, now only along the chain).
- **The Lot card listed a curved street side six times.** It is one line with the total.
- **The Sources page showed "missing" for every daily-check failure.** It now shows the reason ("street side 16.6 ft, recorded 49.92 ft", "no owner came back") and how many runs it has failed.

## Verification

| Check | Result |
|-------|--------|
| `npm test` (fixtures, guard on, internet on, Postgres up) | 376 tests, 370 pass, 0 fail, 6 skipped (3 `LIVE`, 3 dormant billing) |
| `LIVE=1 node --test test/live-acceptance.test.mjs` | 2 of 2 pass, twice: 14 addresses, FEMA answered for all 14 on both runs |
| The no-money suite with the internet on | 7 of 7 |
| `vite build` | clean |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Recorder | 4 new recordings; each replays the live answer; owner strings in kept columns 0 of 12, 0 of 11, 0 of 10, 0 of 13 parcels |

Before, on round 10's code: `test/round11.test.mjs` does not load (the functions do not exist). With the new recordings on round 10's code, Kiskadee is front on 2 edges (16.63 ft) and 323 N 11th St answers `none`.

FEMA dropped two of the four recordings on the first try (the same outage the review saw); the second try recorded both.

## Not met, or different from the brief

- **"Within 20 ft of the nearest front distance."** Measured live, the six Kiskadee chords are 44.0, 50.5, 56.2, 60.7, 64.1 and 66.1 ft from the TIGERweb centreline, because the line stops short of the middle of the bulb. 20 ft keeps four chords (33.27 ft). The code uses 30 ft, which keeps all six; the other three conditions (short, turning under 30°, facing the road) are as written. If TIGERweb redraws that cul-de-sac the daily check will say so.
- **The envelope of a curved lot is still a straight-sided under-estimate** (3,026 sf against about 3,200 on Kiskadee). Following the curve exactly needs the house-fit check to handle a notched envelope; today it tests corners, which is only right for a shape with no notches. Left for a round of its own.
- **`TRUST_PROXY_HOPS`.** Set to 3 as the review expects, but I cannot see Render's log from here. Until someone reads the "proxy chain:" line it is a best estimate. A wrong value no longer locks anyone out.
- **The roofs** are a massing model: valleys, hips and run-ins are now consistent, and nothing overhangs open ground. They are not a framed roof plan (no crickets, no plate-height changes). The drafter's set draws the real roof.
- **"Render ranges."** Render does not publish its load balancers' addresses. The fail safe covers private ranges (which is what Render's balancer shows as) and Cloudflare's published ranges.

## Questions for the office

1. After the next deploy, read the "proxy chain:" line in the Render log and confirm it ends "(right)". If it says "(set it to N)", set `TRUST_PROXY_HOPS` to N.
2. The daily check now runs 14 addresses (14 county lookups and 14 road lookups a day) and emails only after two failed runs of the same address. Fine?
3. A "near" match (the county lists the lot a few numbers off) is offered to the homeowner with a warning and still needs the drafter's confirmation. Keep, or hold those for the office only?
