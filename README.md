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

## What the backend phase replaces

- Survey parsing and city setback lookup (`screens/Start.jsx`, `screens/Lot.jsx`)
- Style kits and the layout solver (`draft/lib/styles.js`, `draft/lib/layout.js`)
- The change interpreter and rules engine (`applyRequest` in `layout.js`)
- Credits, accounts, saved versions, and IFC export for Revit
