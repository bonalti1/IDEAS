import type { PlanStageInput, TradeId } from './types.ts'

export interface TradeWorkflow {
  id: TradeId
  label: string
  defaultResult: string
  workAreaHint: string // what the segmenter / analyst should treat as the work area
  stages: PlanStageInput[]
  // Applied to every stage prompt.
  globalRules: string[]
}

export const TRADES: Record<TradeId, TradeWorkflow> = {
  concrete_driveway: {
    id: 'concrete_driveway',
    label: 'Concrete driveway',
    defaultResult: 'A new broom-finished concrete driveway with clean edges and control joints.',
    workAreaHint: 'the existing driveway / ground surface between the street and the garage or house',
    globalRules: [
      'Photorealistic construction-site photograph.',
      'Same camera position, lens, framing, time of day, weather and lighting as the original photo.',
      'Change only the work area; everything else stays pixel-consistent with the original.',
      'No people, no vehicles moving, no text, no logos, no watermarks.',
    ],
    stages: [
      {
        title: 'Prepared base',
        description:
          'Old surface removed. The driveway area is excavated, graded and covered with a compacted crushed-stone base. Straight, cut edges along the existing borders.',
        checklist: ['old paving removed', 'compacted gravel base', 'graded level surface', 'clean cut edges'],
        motionHint: 'old surface breaks up and clears away, gravel base spreads and settles',
      },
      {
        title: 'Forms and rebar',
        description:
          'Wooden or steel forms are staked along the full perimeter of the driveway. A rebar grid sits on chairs above the gravel base.',
        checklist: ['forms along every edge', 'stakes outside the forms', 'rebar grid on chairs', 'gravel visible below the grid'],
        motionHint: 'forms rise along the edges and the rebar grid assembles across the base',
      },
      {
        title: 'Concrete placement',
        description:
          'Fresh wet grey concrete fills the forms and has been screeded flat; the surface looks wet and smooth. Forms still in place.',
        checklist: ['wet concrete fills the forms', 'flat screeded surface', 'forms still in place', 'no rebar visible on top'],
        motionHint: 'concrete flows in from the street side and levels across the forms',
      },
      {
        title: 'Finished driveway',
        description:
          'Cured light-grey concrete driveway with a uniform broom finish, saw-cut control joints, and forms removed. Edges are clean and backfilled.',
        checklist: ['cured light-grey concrete', 'broom finish texture', 'control joints', 'forms removed, clean edges'],
        motionHint: 'surface dries and lightens, forms disappear, control joints appear',
      },
    ],
  },
}

export function getTrade(id: TradeId): TradeWorkflow {
  const t = TRADES[id]
  if (!t) throw new Error(`Unknown trade: ${id}`)
  return t
}
