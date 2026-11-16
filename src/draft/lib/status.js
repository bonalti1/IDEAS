// What a project's status means to the client, in order.
export const STATUS = {
  drafting: { label: 'Drafting', tone: 'wait', step: 0 },
  returned: { label: 'Back to you', tone: 'warn', step: 0 },
  in_review: { label: 'In review', tone: 'wait', step: 1 },
  approved: { label: 'Approved', tone: 'good', step: 2 },
  built: { label: 'Revit model ready', tone: 'good', step: 3 },
}
export const STEPS = ['Drafting', 'In review', 'Approved', 'Revit model ready']
export const EDITABLE = ['drafting', 'returned']

/** Chat history rebuilt from a project's saved versions. */
export function historyFrom(versions = []) {
  const h = []
  for (const v of versions) {
    if (v.kind === 'change') {
      h.push({ who: 'you', text: v.text })
      h.push({ who: 'house', text: v.reply || 'Done.', source: v.source, applied: true })
    } else if (v.kind === 'rollback') h.push({ who: 'house', text: `${v.text}.`, applied: true, source: 'undo' })
    else if (v.kind === 'program') h.push({ who: 'house', text: 'Rooms changed, here is the new draft.', applied: true, source: 'undo' })
  }
  return h
}
