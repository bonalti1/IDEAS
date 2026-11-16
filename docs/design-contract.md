# Design contract, version 1

The one JSON document the app sends when a client approves. The office worker
builds the Revit model from it. Built by `src/draft/lib/contract.js`.

| Field | What it holds |
|---|---|
| `contract` | 1. The worker refuses other versions. |
| `client`, `lot`, `style`, `program` | Who, where, which kit, how many rooms. |
| `frame` | Local feet: x along the front, z toward the street, y up, origin at the plan centre. The worker maps to Revit X east, Y north, Z up. |
| `rooms[]` | id, kind, name, centre x z, w d, plate height, open (porch), plumbing. |
| `walls[]` | endpoints a b, thickness in inches, plate, base (dormer faces), exterior, plumbing, `revitType` from the kit mapping. |
| `doors[]` | centre, axis, width, height, swing, hinge, pair, cased, exterior, `revitFamily`. |
| `windows[]` | centre, axis, width, sill, head, mark, `revitFamily`. |
| `fixtures[]` | kind, name, room, footprint, height, `revitFamily`. |
| `roof` | masses from the kit (plan feet about `centre`, scaled by `scale`), clipped `panels` with 3D rings, dormers, pitch, overhang. |
| `footprint`, `footprints` | The slab outline(s): the union of the solid rooms, grown 0.4 ft so wall-thick gaps close, as rings in frame feet, largest first. One floor per ring. |
| `revit` | The kit's Revit names (`kit.revit`): wall, floor and roof types, door and window families, fixtures, title block, view templates. The worker maps them through `worker/kit.revit.json`. |
| `sheets`, `titleBlock` | The sheet list and title block text from the kit. |
| `takeoff`, `livingSf` | The cover sheet numbers, for the drafter to compare. |
| `changes[]` | Every plain-language change the client made, in order. |

Revit names (`revitType`, `revitFamily`, template, title block) come from
`kit.revit` in `src/kits/modern-farmhouse.js`. A name that is not in the
template makes the worker fall back to the template default and log a warning
that shows on the job in the dashboard.
