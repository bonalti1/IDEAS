# Draft House

Client-facing flow for designing a custom home on a real lot, finished by our drafters.
Name is provisional. Brand tokens live in `src/brand/`.

## Run

```
npm install
npm run dev          # http://localhost:5173
npm run build
node scripts/shot-flow.mjs shots/flow   # screenshots of every step (dev server running)
```

## Flow (all mocked, no backend yet)

1. **Start** – address or survey upload.
2. **Lot** – plat drawn in 3D with setbacks and buildable area (Lot 514 data for now).
3. **Style** – ten style cards.
4. **Rooms** – beds, baths, garage, stories, square footage, with lot fit and a rough estimate.
5. **Draft** – generated house massing on the lot, plain-language edits, credit counter.
6. **Send** – summary and change log, handoff to drafters.

`#/lot514` opens the original drafter-side site plan review.

## Office pipeline

```
client app  →  office API (server/)  →  job queue  →  office computer with Revit (worker/)  →  model.rvt, sheets.pdf, model.ifc  →  drafters
                      ↑ heartbeats, health checks, dashboard at #/admin
```

- `server/index.mjs`: the office API. Job queue, file store, worker heartbeats, health, dashboard data. No dependencies. `node server/index.mjs`
- `worker/`: runs on the Windows machine with Revit. `draft_house_worker.py` polls the queue and runs `revit/build_model.py` through the pyRevit CLI. See `worker/INSTALL.md`.
- `#/admin` in the app: the office dashboard. Every connected piece and its health, the queue, jobs with logs, activity.
- `scripts/fake-worker.mjs`: a pretend office computer for demos.
- `docs/design-contract.md`: the JSON the app sends.

Demo: `node server/index.mjs` in one terminal, `node scripts/fake-worker.mjs` in another, `npm run dev`, approve a design, open `#/admin`.

## IFC export

The Send step's drafter package has a **Download IFC** button. The file is IFC4
with walls (exterior, interior, plumbing thickness from the kit), floor slabs,
and every room as an IfcSpace, placed on the lot and rotated to it. A property
set on the building carries the style, kit, program, roof, plates, and
foundation notes. Verified with IfcOpenShell: all elements build geometry.

To check the export outside the browser:

```
node scripts/export-ifc.mjs draft.ifc
python3.13 scripts/ifc-to-obj.py draft.ifc public/ifc-preview.obj   # pip install ifcopenshell
npm run dev && node scripts/shot-ifc.mjs ifc.png                     # renders ifc-preview.html
```

Style kits live in `src/kits/`. Only Modern Farmhouse is extracted so far.

## What the backend phase replaces

- Survey parsing and city setback lookup (`screens/Start.jsx`, `screens/Lot.jsx`)
- Style kits and the layout solver (`draft/lib/styles.js`, `draft/lib/layout.js`)
- The change interpreter and rules engine (`applyRequest` in `layout.js`)
- Credits, accounts, saved versions, and IFC export for Revit
