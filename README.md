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
