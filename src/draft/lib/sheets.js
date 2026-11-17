// The sheet set: which views, schedules and tags go on which sheet, from the kit's sheet list and
// the design. One plan for the dry run (scripts/sheets-dry-run.mjs), for design.json (sheetPlan)
// and for the Revit worker (worker/revit/build_model.py reads design.sheetPlan).

/**
 * @param {object} design  design.json (contract 1): rooms, doors, windows, roof, lot, sheets
 * @returns {Array<{ no, title, views: Array<{kind, name, tags?, dimensions?}>, schedules: string[], notes: string[] }>}
 */
export function sheetPlan(design) {
  const sheets = design.sheets || []
  const doors = design.doors || []
  const windows = design.windows || []
  const rooms = design.rooms || []
  const hasRoof = !!(design.roof && (design.roof.masses || []).length)
  const hasLot = !!(design.lot && (design.lot.envelope || []).length)
  const garage = rooms.find((r) => r.kind === 'garage')
  const plan = sheets.map((s) => {
    const no = String(s.no)
    const out = { no, title: s.title, views: [], schedules: [], notes: [] }
    if (no === 'CVR') {
      out.views.push({ kind: 'rendering', name: '3D view, front' })
      out.schedules.push('Sheet index')
      out.schedules.push('Building area')
      out.notes.push('material takeoff and door and window counts from design.takeoff')
    } else if (no === '99') {
      out.views.push({ kind: 'site', name: 'Site Plan', scale: 20, contents: ['lot boundary', 'setback lines', garage ? 'driveway from the overhead door to the street' : 'front walk'] })
      if (!hasLot) out.notes.push('no lot boundary in the design: the site plan shows the house only')
    } else if (no === '100') {
      out.views.push({ kind: 'roof', name: 'Roof Plan', scale: 8, contents: ['ridges', 'pitches', 'overhangs'] })
      if (!hasRoof) out.notes.push('no roof masses in the design')
    } else if (no === '101') {
      out.views.push({ kind: 'foundation', name: 'Foundation Plan', scale: 8 })
      out.notes.push('beams, plumbing drops and details A-N are drawn by the drafter')
    } else if (no === '200') {
      out.views.push({ kind: 'plan', name: 'Floor Plan', scale: 4, tags: { doors: doors.filter((d) => !d.cased).length, windows: windows.length, rooms: rooms.length }, dimensions: 'exterior strings and room sizes' })
      out.schedules.push('Door Schedule')
      out.schedules.push('Window Schedule')
      out.notes.push('shower niche detail and notes are drawn by the drafter')
    } else if (no === '300') {
      out.views.push({ kind: 'elevation', name: 'Front Elevation', direction: 'south' })
      out.views.push({ kind: 'elevation', name: 'Rear Elevation', direction: 'north' })
      out.notes.push('typical wall section is drawn by the drafter')
    } else if (no === '301') {
      out.views.push({ kind: 'elevation', name: 'Left Elevation', direction: 'west' })
      out.views.push({ kind: 'elevation', name: 'Right Elevation', direction: 'east' })
    } else if (no === '400') {
      out.views.push({ kind: 'plan', name: 'Electrical Plan', scale: 4 })
      out.notes.push('fixtures, outlets and circuits are drawn by the drafter')
    } else if (no === '500') {
      out.views.push({ kind: 'plan', name: 'Code Review Plan', scale: 4 })
      out.notes.push('IRC keynotes are drawn by the drafter')
    }
    return out
  })
  return plan
}

/** Plain text of the plan, one line per sheet, for the dry run and the report. */
export function describeSheetPlan(plan) {
  return plan
    .map((s) => {
      const views = s.views.map((v) => `${v.name}${v.tags ? ` (${v.tags.doors} door tags, ${v.tags.windows} window tags, ${v.tags.rooms} room tags, ${v.dimensions})` : ''}${v.direction ? ` (${v.direction})` : ''}`)
      const parts = [...views, ...s.schedules.map((x) => `${x} [schedule]`)]
      return `${s.no.padEnd(4)} ${s.title.padEnd(30)} ${parts.join('; ')}${s.notes.length ? `  — ${s.notes.join('; ')}` : ''}`
    })
    .join('\n')
}
