// Door and window widths are catalog sizes, and design.json, the door schedule and the IFC carry the
// same number for every opening, on the 4 lots x 4 programs matrix. The IFC also carries the types,
// materials, property sets, quantities and marks a drafter needs in Revit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateRooms, kitFor } from '../src/draft/lib/layout.js'
import { fitsLot } from '../src/draft/lib/fit.js'
import { buildDesign } from '../src/draft/lib/contract.js'
import { toIFC } from '../src/draft/lib/ifc.js'
import { doorSchedule, windowSchedule } from '../src/draft/lib/takeoff.js'
import { STYLES } from '../src/draft/lib/styles.js'
import { LOTS, PROGRAMS, draftable } from './helpers.mjs'

const style = STYLES.find((s) => s.id === 'farmhouse')
const kit = kitFor(style)
const IN = 1 / 0.0254 // metres → inches

/** Doors and windows in an IFC text: { tag, name, widthIn } */
function ifcOpenings(ifc) {
  const out = { doors: [], windows: [] }
  for (const line of ifc.split('\n')) {
    const d = line.match(/^#\d+=IFCDOOR\('[^']*',#\d+,'([^']*)','[^']*',\$,#\d+,#\d+,'([^']*)',([\d.]+),([\d.]+),/)
    if (d) out.doors.push({ name: d[1], tag: d[2], heightIn: +d[3] * IN, widthIn: +d[4] * IN })
    const w = line.match(/^#\d+=IFCWINDOW\('[^']*',#\d+,'([^']*)','[^']*',\$,#\d+,#\d+,'([^']*)',([\d.]+),([\d.]+),/)
    if (w) out.windows.push({ name: w[1], tag: w[2], heightIn: +w[3] * IN, widthIn: +w[4] * IN })
  }
  return out
}

const cases = Object.entries(LOTS).flatMap(([lotName, lot]) => Object.entries(PROGRAMS).map(([progName, program]) => [lotName, lot, progName, program]))

for (const [lotName, lot, progName, program] of cases) {
  test(`opening widths agree: ${progName} on ${lotName}`, () => {
    const drafted = draftable(program, lot)
    assert.ok(drafted)
    const rooms = generateRooms(drafted, style, lot)
    const design = buildDesign({ rooms, program: drafted, style, lot, client: 'Test' })
    const ifc = ifcOpenings(toIFC({ rooms, program: drafted, kit, style, lot }))
    const schedule = doorSchedule(rooms, kit)
    const doorWidths = new Set(Object.values(kit.doors).filter((d) => d.w).flatMap((d) => [d.w, d.w * 2]))
    design.doors.filter((d) => !d.cased).forEach((d) => {
      const drawn = Math.round(d.width * 12 * 2) / 2
      assert.ok(doorWidths.has(drawn), `${d.tag} ${d.id}: ${drawn}" is not a catalog door`)
      const row = schedule.find((r) => r.key === d.size && !!r.pair === !!d.pair)
      assert.ok(row, `${d.tag} ${d.size}${d.pair ? ' pair' : ''} is on the schedule`)
      assert.ok(Math.abs(row.widthIn - d.width * 12) <= 0.5, `${d.tag}: schedule ${row.widthIn}" vs design ${d.width * 12}"`)
      const inIfc = ifc.doors.find((x) => x.tag === d.tag)
      assert.ok(inIfc, `${d.tag} is in the IFC`)
      assert.ok(Math.abs(inIfc.widthIn - d.width * 12) <= 0.5, `${d.tag}: IFC ${inIfc.widthIn.toFixed(1)}" vs design ${d.width * 12}"`)
      assert.ok(!/\s$/.test(inIfc.name), `no trailing space in "${inIfc.name}"`)
      // heights agree too: the catalog (French pairs 96", overhead 84", the rest 80"), design.json, the schedule and the IFC
      assert.ok(Math.abs(row.h - d.height * 12) <= 0.5, `${d.tag}: schedule ${row.h}" high vs design ${Math.round(d.height * 12)}"`)
      assert.ok(Math.abs(inIfc.heightIn - d.height * 12) <= 0.5, `${d.tag}: IFC ${inIfc.heightIn.toFixed(1)}" high vs design ${Math.round(d.height * 12)}"`)
      assert.equal(Math.round(d.height * 12), kit.doors[d.size].h, `${d.tag} ${d.size}: ${Math.round(d.height * 12)}" is the catalog height`)
    })
    const winWidths = new Set(Object.values(kit.windows).flatMap((w) => [w.w, w.w * 2]))
    design.windows.forEach((w) => {
      assert.ok(winWidths.has(Math.round(w.width * 12)), `${w.tag}: ${Math.round(w.width * 12)}" is not a catalog window`)
      const inIfc = ifc.windows.find((x) => x.tag === w.tag)
      assert.ok(inIfc, `${w.tag} is in the IFC`)
      assert.ok(Math.abs(inIfc.widthIn - w.width * 12) <= 0.5, `${w.tag}: IFC ${inIfc.widthIn.toFixed(1)}" vs design ${w.width * 12}"`)
    })
    assert.equal(design.doors.filter((d) => !d.cased).length, ifc.doors.length, 'every door is in the IFC')
    assert.equal(design.windows.length, ifc.windows.length, 'every window is in the IFC')
  })
}

test('door heights still agree after chat edits (a bedroom added, the garage made 3 cars, a rear porch)', async () => {
  const { interpretRequest } = await import('../src/draft/lib/interpret.js')
  const { DEFAULT_PROGRAM } = await import('../src/draft/lib/layout.js')
  const offline = async () => { throw new Error('no api') }
  const lot = LOTS['reference (Lot 514)']
  let rooms = generateRooms(DEFAULT_PROGRAM, style, lot)
  for (const t of ['add a bedroom', 'make the garage 3 cars', 'add a porch on the back']) {
    const r = await interpretRequest(t, rooms, DEFAULT_PROGRAM, style, { lot, interpreter: offline })
    assert.equal(r.applied, true, `${t}: ${r.reply}`)
    rooms = r.rooms
  }
  const design = buildDesign({ rooms, program: DEFAULT_PROGRAM, style, lot, client: 'Test' })
  const ifc = ifcOpenings(toIFC({ rooms, program: DEFAULT_PROGRAM, kit, style, lot }))
  const schedule = doorSchedule(rooms, kit)
  assert.ok(design.doors.some((d) => /^bed-/.test(d.room)) && design.doors.some((d) => d.size === 'overheadSingle'), 'the new rooms brought doors')
  design.doors.filter((d) => !d.cased).forEach((d) => {
    const row = schedule.find((r) => r.key === d.size && !!r.pair === !!d.pair)
    const inIfc = ifc.doors.find((x) => x.tag === d.tag)
    assert.ok(row && inIfc, `${d.tag} ${d.size} on the schedule and in the IFC`)
    assert.equal(Math.round(d.height * 12), kit.doors[d.size].h, `${d.tag} ${d.size}: ${Math.round(d.height * 12)}" is the catalog height`)
    assert.ok(Math.abs(row.h - d.height * 12) <= 0.5 && Math.abs(inIfc.heightIn - d.height * 12) <= 0.5, `${d.tag}: ${row.h}" / ${inIfc.heightIn.toFixed(1)}" / ${Math.round(d.height * 12)}"`)
  })
})

test('the IFC carries wall, door and window types, materials, Pset_WallCommon, Pset_SpaceCommon, an area for every space, and marks', () => {
  const program = PROGRAMS['4/3.5 office 2-car 2,800 sf']
  const rooms = generateRooms(program, style, LOTS['McAllen 100 x 150'])
  const ifc = toIFC({ rooms, program, kit, style, lot: LOTS['McAllen 100 x 150'] })
  const count = (re) => (ifc.match(re) || []).length
  assert.equal(count(/=IFCWALLTYPE\(/g), 3, 'exterior, interior and plumbing wall types')
  assert.ok(count(/=IFCDOORTYPE\(/g) >= 4, 'door types')
  assert.ok(count(/=IFCWINDOWTYPE\(/g) >= 2, 'window types')
  assert.ok(count(/=IFCMATERIALLAYERSET\(/g) === 3 && count(/=IFCMATERIAL\(/g) >= 6, 'material layer sets')
  assert.ok(ifc.includes(`'${kit.revit.wallTypes.exterior}'`) && ifc.includes(`'${kit.revit.doors.interior}'`) && ifc.includes(`'${kit.revit.windows.A}'`), 'types named as in kit.revit')
  assert.ok(count(/'Pset_WallCommon'/g) >= 2 && ifc.includes("IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(.T.),$)"), 'Pset_WallCommon.IsExternal')
  const spaces = [...ifc.matchAll(/^#(\d+)=IFCSPACE\('[^']*',#\d+,'(\d+)','[^']*',\$,#\d+,#\d+,'([^']*)',/gm)]
  assert.ok(spaces.length >= 20, 'spaces')
  spaces.forEach(([, sid, number, longName]) => {
    assert.ok(longName.length > 0, `space ${number} has a LongName`)
    const rel = ifc.match(new RegExp(`IFCRELDEFINESBYPROPERTIES\\('[^']*',#\\d+,\\$,\\$,\\(#${sid}\\),#(\\d+)\\)`, 'g')) || []
    const ids = rel.map((r) => r.match(/#(\d+)\)$/)[1])
    const hasQty = ids.some((qid) => new RegExp(`^#${qid}=IFCELEMENTQUANTITY\\('[^']*',#\\d+,'Qto_SpaceBaseQuantities'`, 'm').test(ifc))
    const hasPset = ids.some((pid) => new RegExp(`^#${pid}=IFCPROPERTYSET\\('[^']*',#\\d+,'Pset_SpaceCommon'`, 'm').test(ifc))
    assert.ok(hasQty && hasPset, `space ${number} (${longName}) has Pset_SpaceCommon and a NetFloorArea`)
  })
  assert.ok(count(/IFCQUANTITYAREA\('NetFloorArea',\$,\$,[0-9.]+,\$\)/g) >= spaces.length)
  assert.ok(/IFCDOOR\([^\n]*'D01'/.test(ifc) && /IFCWINDOW\([^\n]*'W01'/.test(ifc), 'door and window marks')
  assert.ok(!/'[^']* '/.test(ifc.split('\n').filter((l) => /IFCDOOR\(|IFCWINDOW\(|IFCSPACE\(/.test(l)).join('\n')), 'no trailing spaces in names')
  assert.ok(ifc.includes("'Pset_DoorCommon'") && ifc.includes("'Pset_WindowCommon'") && ifc.includes("'ThermalTransmittance'"))
})

test('the window schedule carries U-factor and SHGC (IECC 2021 zone 2) or a CONFIRM flag', () => {
  const rooms = generateRooms(PROGRAMS['3/2 at 1,800 sf'], style, LOTS['McAllen 100 x 150'])
  const sched = windowSchedule(rooms, kit)
  assert.ok(sched.length >= 2)
  sched.forEach((w) => {
    const ok = w.uFactor <= 0.4 && w.shgc <= 0.25
    assert.ok(ok || w.energy === 'CONFIRM', `${w.mark}: U ${w.uFactor} SHGC ${w.shgc} ${w.energy || ''}`)
  })
  const code = kit.energyCode || kit.windows.energyCode
  assert.ok(code?.maxU === 0.4 && code?.maxShgc === 0.25)
})
