# Draft House fix round 13: Spanish, the browser's Back, the phone, and what the review of round 12 found

Branch `claude/fix-round-13`, on top of `claude/fix-round-12` @04bbcee. Pictures in `docs/fix-round-13/`; the walkthrough's step sheets in `docs/fix-round-13/walkthrough/`.

Sources: the customer test addendum of Nov 19 (items 1 to 7) and the review of PR #12 (M1, M2, G1 to G3, and its own customer walkthrough's must-fix and should-fix lists).

One sentence: the homeowner's app now speaks Spanish as well as English, on the screens and in the chat; every step has its own address so Back, Forward and reload stay in the homeowner's flow; the whole flow passes a phone audit at 390 px in both languages; and an outline the county could not check is never confirmed on trust.

**Rules kept.** No money in the client app, in either language (the no-money suite passes; the walkthrough scanned every screen for a `$` amount). 10 free changes per plan, the office grants more; refusals, offers, undo and "send my lot to the drafter" use none. No owner names or mailing addresses in code, logs, tests or pictures. No secret is committed or logged. Nothing was merged; Render was not touched.

**Waiting on the office, not done:** G1 (a plan drawn for pie lots) and G3 (the west end of the roof). Both need an answer first; see the questions at the end.

**The machine restarted mid-round.** Nothing committed was lost. Two helpers' unfinished files were on disk and were resumed from there.

## Must fix

| # | Item | What changed | Test (fails before, passes after) | Picture | Status |
|---|------|--------------|-----------------------------------|---------|--------|
| M1 | An outline the server could not check gets confirmed without a warning | A parcel number the county does not have is refused when the lot is saved: 400, "The county has no parcel number 99999999. Look the address up again, or type the lot in." When the county only does not answer, the lot is kept as unchecked. The drafter's card says in red "Lot outline not checked against the county (county did not answer). Check it before confirming.", and the queue card carries "Outline not checked". Confirm asks the county again: with the county back, the outline is replaced by the county's and the line goes; while it stays down, Confirm is 409 until the drafter ticks "I checked the outline myself", which is logged under their name. | `test/round13.test.mjs`, three M1 tests over HTTP: the made-up number is 400 and nothing is saved; with the county stubbed to fail the lot is unchecked, Confirm without the tick is 409 and Send stays blocked, and after a restart with the county answering Confirm stores the county's outline; the ticked confirm is logged. `test/round13-review.test.mjs` "screens M1": the red line, the queue mark, the tick. | `m1-drafter-card-unchecked-1440.png`, `m1-drafter-card-county-still-down-1440.png`, `m1-drafter-queue-marks-1440.png` | Done |
| M2 | needsCustom stores the browser's `program` as sent | One cleaner (`cleanProgram` in `server/projects.mjs`) for every place the office stores the rooms asked for: create, update and "Send my lot to the drafter". Known fields only, each of its own type; a count outside the widest range any plan draws is refused in plain words. | `test/round13.test.mjs` "M2": `{program:{beds:999,foo:'x'}}` is 400 ("the bedrooms asked for must be between 1 and 8"); `{beds:5,foo:'x'}` is stored with no `foo`; create and update drop unknown fields too. | n/a | Done |
| 1 | Spanish | **Screens:** an ES/EN switch, picked from the browser's language and remembered once tapped; every homeowner string goes through one dictionary (578 entries, 497 places). English is unchanged. **Chat:** casual Spanish is read in both modes (counts, add and remove, bigger and smaller, patio, garage, size, more open, cost, undo), with or without accents; replies, refusals, offers and button labels come back in Spanish (`src/draft/lib/es.js`). The screen's language rides along with each request, so an English request on a Spanish screen is answered in Spanish. | `test/round13-chat-es.test.mjs`, 22 tests: the 20 requests by the basic rules, over HTTP with no key, and with Claude stubbed. `test/round13-chat-es-live.test.mjs` (LIVE only), run: the same 20 through the real model, 2 of 2. `test/round13-i18n.test.mjs`, 16 tests: both dictionaries complete, no `$`, "precio" or "setback" in Spanish, no bare English left in the screen files. `test/round13-i18n-screens.test.mjs`: a browser set to es-MX walks every step in Spanish at 1440 and 390 px. | `es-1440.jpg`, `es-390.jpg`, `es-1440-07-draft.png`, `es-390-07-draft.png` | Done, with what is still English listed under "Not met" |
| 2 | Browser Back breaks the app | Every step has its own address (`#/lot`, `#/style/<house>`, `#/rooms/<house>`, `#/draft/<house>`, `#/send/<house>`). Back and Forward move between the homeowner's steps. A reload opens the same step: a saved house comes from the office, an earlier step from what the tab kept. A homeowner on an office address is taken to their own first screen, and that address is replaced so Back cannot return to it. | `test/round13-route.test.mjs`: each step's address, Back twice and Forward twice, reload on Lot, Rooms and Draft, `#/review` as a homeowner, an address for a house that is not theirs. | `2-reload-on-draft-1440.png`, `2-office-address-sends-home-1440.png` | Done |
| 3 | The phone, whole flow at 390 px | The first screen starts from the top when it does not fit (the title was cut off above the screen). Lot, Draft and Send scroll as one page (the panel used to scroll on its own, sliding its words under the lot map). The lot picture is 52% of the screen's height. Everything tapped is at least 40 px tall. The chat box is scrolled back into view when the keyboard opens. | `test/round13-phone.test.mjs` with `test/phone-audit.mjs`: every step at 390 x 844 is checked for a page wider than the screen, anything off the side, words cut off, a control under another, two controls sharing a patch, a title cut off above, and a button under 40 px. It found 54 faults on the round 12 layout, and none now, in English and in Spanish. | `phone-390-en.jpg`, `phone-390-es.jpg` | Done; the keyboard itself cannot be tested in a headless browser (see "Not met") |
| W1 | Saved but not findable after signing out | The address typed is saved as the homeowner's house before a lot is taken ("Address saved, lot not chosen yet"), so signing out on the lot step loses nothing. "Your houses" lists the house after sign-in and one click opens the step that was left: Lot, Rooms or Draft. | `test/round13.test.mjs` "houses" over HTTP. `test/round13-review.test.mjs`: sign out on the lot step, the rooms step and the draft; each time the house is on the first screen and one click lands on that step. | `houses-signed-out-on-lot-step-1440.png` | Done |
| W2 | "Send my lot to the drafter" is not visible on Kiskadee | A lot our plans only just fit (the house turned, or cut down to a smaller start) shows "A tight lot for our ready plans" with the button "Send my lot to the drafter" on the rooms step. The chat takes "send my lot", "have the drafter design it" and the Spanish for both, and uses no change. | `test/round13-review.test.mjs`: the button on Kiskadee's rooms step; "have the drafter design it" in the chat puts the lot in the drafter's queue with 10 changes still left. | `tight-lot-send-to-drafter-button-1440.png`, `tight-lot-chat-send-my-lot-1440.png` | Done; the button is on the rooms step, not the lot step (see "Not met") |
| W3 | Lot sides shown as surveyor bearings | The parcel card says "Front (Kiskadee Ln): about 50 ft, curved", "Left side: about 100 ft", "Right side", "Back of the lot", in whole feet, left and right as seen from the street. The bearings stay on the drafter's card. | `test/lot-front.test.mjs` on five lots at both sizes: the four lines, and no bearing on the card. | Walkthrough sheets, step `02-lot-found` | Done |

## Should fix

| # | Item | What changed | Test (fails before, passes after) | Picture | Status |
|---|------|--------------|-----------------------------------|---------|--------|
| 4 | Typed undo | "undo", "undo that", "go back to how it was", "put it back", "deshaz eso", "regresa como estaba", "quita el último cambio" do what the Undo button does and give the change back. With nothing to undo it says so. Typing it twice no longer brought the undone change back. | `test/round13-chat-es.test.mjs`, four "2" tests: every phrasing in both languages, over HTTP with no key and with Claude stubbed. | Walkthrough sheets, step `10-chat-3` | Done |
| 5 | Contradictory or vague requests | "Make the house smaller but add 2 bedrooms" explains the trade-off and offers one button that applies on that lot. "asdf", "make it nicer" and "hmm" get "I did not catch that" and three example requests as buttons that fit the plan as it is. None uses a change. | `test/round13-chat-es.test.mjs`, five "3" tests, in both modes and both languages; every offered button is tapped and checked against the rules. | Walkthrough sheets, steps `10-chat-6` and `10-chat-7` | Done |
| 6 | A typo in the address shows 6 parcels | Before an address is compared or searched: a bare street number gets its ending (27 is 27TH), a spelled-out or shortened suffix is the short one (Street, Av), and a city, state or ZIP typed after the suffix is not part of the street's name ("Mc Allen" too). "3305 N 27 street mcallen" finds its one parcel with no question first. A different street, number or direction still asks. | `test/round13.test.mjs`, three "6" tests, with a list of roads that must not change (County Rd 12, Loop 499, Ave B, FM 495). Checked live as well. | Walkthrough sheets, the "typo" lot | Done |
| 7 | Explain the changes counter | Under the Draft step's heading: "10 free changes; a failed request doesn't use one. Only a change the chat makes to your plan uses one. Choosing your lot and rooms, your first draft and undo are free." The number is the plan's own allowance. | `test/round13-i18n-screens.test.mjs` and `test/round13-review.test.mjs`. | `es-1440-07-draft.png` | Done; it sits under the heading, not inside the header (see "Not met") |
| G2 | The "more open" buttons are only room resizes | The buttons say what they do ("Make the living room bigger", "Make the kitchen 1 ft longer"); none says "open plan". Tapping one answers with the room and the square feet. | The walkthrough taps the first button on every lot and records the reply (table below). | Walkthrough sheets, step `10-chat-5b-tapped` | Done |
| W7 | Drafter queue cards wrap awkwardly; a near match needs one clear label | Each queue card keeps its marks on one line each, and carries one labelled mark where there is something to check: "Near match: check the address", "Outline not checked", "Parcel picked by hand". | `test/round13-review.test.mjs` "screens M1". | `m1-drafter-queue-marks-1440.png` | Done |
| G1 | No compact plan was drawn | Not started: the review asks for the office's answer first. | n/a | n/a | Waiting on the office |
| G3 | The west end of the roof | Not started: the review asks for the office's answer first. | n/a | n/a | Waiting on the office |

## The customer walkthrough

`scripts/walkthrough.mjs` starts the PR build (the built client and the office API, live county, FEMA and zoning lookups, billing off, no email, an empty data folder) and drives a real Chromium like a customer. Homeowners sign in as `drafthouse.test+customerN@example.com`, the drafter as `drafter.test@drafthouse.local`. Four full runs on the final build: English and Spanish, each with the basic chat rules and with the real Claude key (model claude-opus-5-5).

Each homeowner session: sign in, type the address, take the lot, pick the style, choose rooms, draft, look at the plan and the 3D view, seven chat requests (the four of round 12, then typed undo, the contradictory request and "asdf"), tap the first "more open" button, press the browser's Back and Forward, reload on the draft, go to Send. The drafter then opens every lot to confirm, reads the card and confirms, and the homeowners send. Signing out and back in mid-way is done on the normal lot at 1440 px and on the curved lot at 390 px. Every screen's text is scanned for "setback", "NaN", "undefined", a `$` amount and "could not send", and in the Spanish runs for English left on the screen.

| Lot | English, basic | English, Claude key | Spanish, basic | Spanish, Claude key |
|---|---|---|---|---|
| Normal: 1201 Kerria Ave, McAllen | sent, both sizes | sent, both sizes | sent, both sizes | sent, both sizes |
| Curved: 2002 Kiskadee Ln, Mission | sent, both sizes | sent, both sizes | sent, both sizes | sent, both sizes |
| Near match: 323 N 11th St, Raymondville | sent, both sizes | sent, both sizes | not walked | not walked |
| C-2: 118 S Cage Blvd, Pharr | blocked by the zoning, both sizes | blocked, both sizes | blocked, both sizes | blocked, both sizes |
| W/E mismatch: 1300 W Nolana Ave | asked "is that right?", sent | asked, sent | not walked | not walked |
| Typed with a slip: "3305 N 27 street mcallen" | found with no question, sent | found with no question, sent | not walked | not walked |

Totals: 36 homeowner sessions and 692 screens. 28 plans sent, 8 correctly blocked by the C-2 zoning, 32 lots confirmed by the drafter. Page errors: 0. Words that must not appear: 0. English left on a Spanish screen: 0. Failed steps: 0. In all 36 sessions Back went to the rooms step, Forward and a reload came back to the draft with the same number of changes left, and no office page appeared.

**What the customer saw in the chat** (normal lot; the other lots are in the report files):

| Request | English | Spanish |
|---|---|---|
| I want 4 bedrooms / quiero 4 recámaras | "This plan already has 4 bedrooms. No change was used." | "Este plano ya tiene 4 recámaras. No se usó ningún cambio." |
| Add a covered patio in the back / quiero un porche atrás | added, 1 change used | "Agregué un porche atrás." 1 change used |
| undo that / deshaz eso | "Back to version 1. 1 change returned." 10 changes left again | "De vuelta a la versión 1. Se te devolvió 1 cambio." |
| Make the kitchen bigger / la cocina más grande | refused with the reason; button "Make the kitchen 1 ft longer" | the same in Spanish; button "Hacer la cocina 1 pie más de largo" |
| Make it feel more open / que se sienta más abierta | what is already open; buttons "Make the kitchen 1 ft longer", "Make the living room bigger" | the same in Spanish |
| (tap the first button, G2) | "Kitchen is now 14' by 16.25' (was 14' by 15.25'). same size · 1 change used" | "La cocina ahora mide 14 por 16.25 pies (antes 14 por 15.25). mismo tamaño · 1 cambio usado" |
| make the house smaller but add 2 bedrooms | the trade-off in plain words; one button "Keep the house about this size, with 5 bedrooms" | the same; "Dejar la casa más o menos de este tamaño, con 5 recámaras" |
| asdf | "I did not catch that…" and three buttons: "Add a porch on the back", "Make the garage 3 cars", "Add a bedroom" | "No le entendí…" and three buttons |

On Kiskadee the contradictory request offers "Make the house smaller, about 1,350 sf, and keep 3 bedrooms", and "asdf" offers the one change that fits there. With the Claude key the outcomes are the same; an applied change is described in the model's own sentence ("I added a covered patio across the back of the house." / "Agregamos un porche en la parte de atrás de su casa.").

**How long things took** (headless Chromium with software 3D, slower than a real phone or laptop): the lot found in 3.4 to 7.2 s; the first draft in about 4.5 s; a chat answer typically 1.2 to 1.3 s with the basic rules and 2.4 to 2.6 s with the Claude key, 5.5 s at most; a reload back on the draft in 3.4 to 4.6 s; the drafter's confirmation in 1.5 s.

**Ratings.** Mine, from reading the screens of these runs. The review's own walkthrough of round 12 gave desktop 6, Kiskadee 7, phone 6, the messy session 6 and the drafter 7.5.

- **Homeowner, desktop: 8.5 of 10.** Back, reload and sign-out no longer lose anything; typed undo, the contradictory request and nonsense all get a useful answer; the lot's sides read like a person wrote them. Held back by: the suggestion buttons under the chat still offer "Make the kitchen bigger" right after that was refused, and the W/E mismatch answered No still ends in typing a lot size.
- **Homeowner, phone: 7.5 of 10.** Every step passes the audit and reads cleanly in both languages. Held back by: the plan is small in its frame on a narrow lot, the page is long on the Lot step, and the keyboard was not seen on a real phone.
- **Homeowner in Spanish: 7.5 of 10.** The whole flow and the chat are Spanish with nothing English left on the screens walked. Held back by: tú on the screens and usted in the chat, the drawings and PDFs still English, and no native read yet.
- **Drafter: 8.5 of 10.** An unchecked outline cannot be missed or confirmed by accident; the queue says what needs a look before a card is opened. Held back by: cities with no zoning layer are still typed by hand, and the queue shows the address as the homeowner typed it ("3305 N 27 street mcallen"), not as the county lists it.

**Pictures.** One sheet per session with every step in order, in `docs/fix-round-13/walkthrough/` (36 sheets, for example `walk-claude-es-390-curved.jpg`), plus four sheets of the drafter's cards before and after confirming. What each screen said, every chat reply and its timing are in `walkthrough-basic.json`, `walkthrough-basic-es.json`, `walkthrough-claude.json` and `walkthrough-claude-es.json` beside them. The full-size frames are not committed; `NODE_USE_ENV_PROXY=1 OUT=<folder> node scripts/walkthrough.mjs basic` makes them again (`WALK_LANG=es` for Spanish).

## Found on the way and fixed

- **Two changes were given back by typing undo twice.** The second "undo that" re-applied the change that had just been undone, at no cost. It now says there is nothing to undo.
- **A homeowner on `#/review` saw "Not a drafter account"** with no way on but signing out. They are now taken to their own first screen.
- **The create and update routes stored any `program` object too**, not only the custom-lot route. All three use the cleaner.
- **A queue card for a first draft with unchecked lot** had no mark at all; the marks above cover it.
- **"Make the house bigger" with no size** fell into "I did not catch that". It now asks for the size.
- **The Claude schema is unchanged**; only the prompt grew by two rules (read Spanish, answer in the client's language). A model sentence that carries English on a Spanish request is replaced by the plan code's Spanish.

## Verification

- `npm test` (Postgres up): 486 tests, 476 pass, 0 fail, 10 skipped. The 10 are the LIVE-only tests and the dormant billing tests. The IFC tests ran and passed.
- Live Claude chat (`LIVE=1`): `round13-chat-es-live` and `round12-chat-live`, 4 of 4, on the merged branch.
- Live acceptance (`LIVE=1 node --test test/live-acceptance.test.mjs`): 2 of 2 on 14 addresses.
- The phone audit at 390 x 844: clean in English and in Spanish.
- The walkthrough, live, in both chat modes and both languages: above.
- `npx vite build`: clean. `npm audit`: 0 vulnerabilities.

One existing assertion changed for a reason: `test/interpret.test.mjs` expected "make it nicer" to return the model's own question; the addendum names that sentence as one that must get "I did not catch that" with three buttons. The model's question still stands for "make the bedroom nicer", and the test says so. `test/lot-front.test.mjs` now expects the sides in plain words instead of bearings (W3).

## Not met, or different from the brief

- **Still English for a Spanish reader.** The summary PDF and the plan PDFs; the words inside the floor plan and site plan drawings (room names, notes); street names, bearings and "AC" on the ground of the 3D view; lines the office API writes with changing parts (a zoning or flood note, the plat reader's notes, a Revit job step); emails; the pictures on the first screen; the county's own names and legal descriptions. Chat and rule sentences with no Spanish template are shown as written, never dropped.
- **tú and usted are mixed.** The screens address the homeowner as tú ("Te quedan 10 cambios"); the chat's plan-written replies use usted ("Ya usó los cambios…"). Two people wrote them. It needs one choice (see the questions).
- **The Spanish was not read by a native Valley speaker.**
- **With the Claude key, an applied change is described by the model in its own Spanish sentence.** The live test checked 19 such sentences for money words and "setback"; there is no template guarantee as there is for plan-written sentences.
- **Language is detected from a word list** when the screen's language is not sent. An English request with a word like "casa" in it would be answered in Spanish.
- **7: the line is under the "Shape it" heading**, not inside the header beside the pill: the header has no room for it at 390 px.
- **W2: the button is on the rooms step.** The review asks for it on the lot screen "whenever the fit is tight". Whether a lot is tight is known only once a style's plans are tried on it, which is the rooms step. The chat request works from the Draft step.
- **3: the keyboard.** The page declares that the keyboard resizes it, and the chat box is scrolled into view on focus. A headless browser has no keyboard, so this was not seen working on a real phone.
- **2: the step in the address, and `p.stage`.** Opening a house from "Your houses" lands on the stage saved on the project. A reload lands on the step in the address, held back to what the house has (no draft without rooms). The two agree in every case I tried; the address wins when they do not.
- **W1: every address typed becomes a saved house.** A homeowner who types three addresses and takes none has three "Address saved" entries. There is no way to delete one from the app yet.
- **Typed undo goes one step further than the button on the office side:** typed again after two changes it takes off the earlier one too. In the app both are the same one step.
- **The walkthrough in Spanish covers three of the six lots** (normal, curved, C-2) at both sizes, in both chat modes; the English walk covers all six.
- **The drafter's queue shows the address as typed** ("3305 N 27 street mcallen"), not as the county lists it. Found on the walkthrough, not changed.
- **Not verified:** the plat upload and the returned, approved and built Send states in Spanish in a browser; a real phone; an allowance other than 10 on screen.

## Questions for the office

1. **tú or usted?** Which one should the whole app use in Spanish?
2. **A native read of the Spanish.** Can someone in the office read the Spanish screens (`es-1440.jpg`, `es-390.jpg`) and the chat replies in the walkthrough report, and mark what sounds wrong?
3. **G1, the pie-lot plan.** Do you want one compact plan drawn for wedge lots (about 40 x 40 ft, 3 bed, 2 bath, about 1,400 sf, no garage)?
4. **G3, the west end of the roof.** One hip at the west end, or the current form with a note in the drafter's checklist?
5. **Saved addresses.** Should an address typed and never taken be dropped after some days, or stay until the homeowner removes it?
6. **Still open from round 12:** the homeowner's "your lot is confirmed" email (needs the mail key on Render), an email to the office when a lot needs a house designed, and what to do when a homeowner says the address we found is not theirs.
