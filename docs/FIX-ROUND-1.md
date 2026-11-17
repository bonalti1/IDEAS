# Fix round 1 (from the live test of drafthouse.netlify.app)

Every item from the round, what was done, and where. Verified on 2026-11-17 with `npm test` (81 tests, 79 pass, 2 skipped live tests, 0 fail, with Postgres), `vite build` (clean), the IfcOpenShell check on a fresh Garza export (IFC4, 322 products, geometry for all 318 that carry any, 0 failures), `scripts/shot-flow.mjs` (the full client, drafter and office walk, 18 screenshots) and `scripts/shot-fix-round.mjs` (this round's screens at 1440 and 390 px, before and after).

Before screenshots come from a build of `main` as it was; after screenshots from this branch. Both in `docs/fix-round-1/`.

## P0: the app was blocked

| # | Item | Done | Commit | Notes |
|---|---|---|---|---|
| 1 | The starter draft breaks its own setback rule | yes | 2615de2 | The garage and extra bedrooms are now added the way a client's "add" is (door, egress window, against the house, never on a porch), the house is shifted and, if needed, trimmed to the setback envelope, and the plan never shrinks under the kit's minimum room sizes. The rooms step runs the real rules before "Draft my house" and offers the largest size that fits, a smaller program that fits, or says how wide this style's smallest plan is against the lot. `test/starter.test.mjs`: every city preset on the 100 x 150 default lot, Lot 514, a corner lot, five programs each. |
| 2 | Explain refusals and offer a fix | yes | 2615de2 | Every problem is listed in plain words; a problem the plan already had is named as such ("the plan also has a problem from before" / "the change itself is fine, but…"). Up to two fixes to click, each checked against the rules first: a smaller version of the resize ("Make the primary bedroom 19.25' by 18.25' instead?") or a nudge ("Move the garage 1 ft west?"). A clicked fix is one change, one credit. |
| 3 | Send listed refused requests | yes | 2615de2 | Only applied, not-undone changes are listed (from the saved versions, or the chat pairs when not signed in). A plan that breaks a rule cannot be sent: the screen lists the reasons and disables the button, and the office refuses it too (409 with the reasons, lot rebuilt from its spec). |
| 4 | Drafter view public | yes | 2615de2 | `#/lot514` sits behind the office sign-in (drafter or admin). Office and Drafter view links show only to staff. `docs/fix-round-1/after/gate-lot514.png`. |

## P1: the basic rules fallback

| # | Item | Done | Commit | Notes |
|---|---|---|---|---|
| 5 | Six requests | yes | 2615de2 | "make the garage 3 cars", "move the laundry next to the garage", "add a porch on the back", "make the kitchen 2 feet wider", "remove the rear porch", "add a half bath": each tested through the fallback and through a fake Claude diff (`test/interpret.test.mjs`). Also: sizes stated outright ("14 feet wide", "12 by 16"), moves by distance ("10 feet toward the street"), and a question back when a porch has no side. The starter draft puts the garage against the laundry, so "move the laundry next to the garage" answers that it already is; the move goes through once the garage is elsewhere. |
| 6 | Hide "assistant offline", fallback under 1 s | yes | 2615de2 | The tag is gone from the homeowner's chat; the Office health page has the interpreter row. Locally the fallback answers in under 50 ms (asserted in the tests). The 3 to 5 s seen on the live site is the browser waiting on the office before falling back; the client now remembers for five minutes that the office has no interpreter and answers at once. I could not measure the live site from here; if it is still slow after deploy, the office itself is slow to answer (a sleeping free-plan instance, for example). |

## P2: the lot step

| # | Item | Done | Commit | Notes |
|---|---|---|---|---|
| 7 | Austin became Hidalgo County | yes | bf62af7 | `GET /api/lot/geocode` asks the Census geocoder, with county and incorporated place. The step shows what was found, picks the city when we have its rules, and says plainly when the address is in Hidalgo County without city rules, outside the area, or not found. The 100 x 150 lot is marked as an assumption the client must confirm (checkbox) before going on. |
| 8 | Panel scrolled sideways, Depth cut off, Front street empty | yes | bf62af7, 81d9df5 | Inputs fit their column; the front street is filled from the geocoded street name. |

## P3: readability and polish

| # | Item | Done | Commit | Notes |
|---|---|---|---|---|
| 9 | 2D plan | yes | 81d9df5 | Plan view frames the house; every room labelled with name and size (above walls and furniture, sized to the room); scroll zooms, drag pans, rotation off in plan; "Fit" re-frames the plan, "Reset" the 3D camera. |
| 10 | Chat panel | yes | 81d9df5 | Wider panel, credits pill never wraps, placeholder fits, chips follow the plan, each applied change shows square feet, dollars and credit, Undo and History always visible. |
| 11 | Rooms step | yes | 2615de2, 81d9df5 | Rear porch not pre-selected; the fit line comes from the rules ("Passes the setback, size and coverage rules" / "Fits once trimmed about 6%" / "Does not fit: … The largest this plan fits here is 2,350 sf"). Stories are limited to what the kit can draft (one, for the farmhouse). |
| 12 | Style step | yes | 81d9df5 | Styles without a kit are marked coming soon and cannot be picked; the step says which style is ready and the Next button says "Pick a style to continue". |
| 13 | First screen | yes | 81d9df5 | 3D and plan previews, one line on what is free and what costs, a real "Try it without an account" button, email field styled like the name field, sign-in button always live with a plain message for a bad email, the repeated line removed (also from the office sign-in). |
| 14 | 390 px | yes | 81d9df5 | Every step checked at 390 px (`docs/fix-round-1/after/phone-*.png`): header wraps, panels stack, inputs and buttons fit, tables shrink. |

## Rules that changed, on purpose

- The kit's plumbing-distance rule went from 20 to 40 ft: the traced Garza plan's bed-wing baths sit 31 to 35 ft from the kitchen, so the old number only ever passed thanks to a second bath. 40 ft still catches a bath at the far end of a garage.
- The closet minimum went from 3 x 3 to 2 x 3 ft (a reach-in closet is 2 ft deep); at 3 ft the plan could not shrink at all.
- The rooms step no longer offers two stories for the farmhouse: the kit is a one-story plan, and "two stories" only shrank every room by a third.

## Could not do here

- Measure the live site's response time or run against it (the sandbox cannot reach netlify.app). Everything above ran on a production build locally with the live interpreter.
- A real Supabase sign-in, real Stripe, real Revit: unchanged from `docs/LAUNCH-CHECK.md`.

## Screenshots

- `docs/fix-round-1/before/`: first screen, lot, first draft, three refused changes, refusal text, plan, send.
- `docs/fix-round-1/after/`: first screen, lot, style, rooms, first draft, three applied changes, refusal with fixes, fix applied, plan with labels, send, the lot514 gate, and the phone views.
