import type { TradeWorkflow } from '../../shared/trades.ts'
import type { SceneAnalysis, Stage, Transition } from '../../shared/types.ts'

const bullet = (xs: string[]) => xs.filter(Boolean).map((x) => `- ${x}`).join('\n')

/**
 * Deterministic stage prompt. Used directly when no LLM is configured, and
 * handed to the analyst as the baseline it must preserve when it refines.
 */
export function templateStagePrompt(o: {
  trade: TradeWorkflow
  scene: SceneAnalysis
  stage: Stage
  stages: Stage[]
  hasPrevious: boolean
}): string {
  const { scene, stage, trade } = o
  const prior = o.stages.filter((s) => s.index < stage.index).map((s) => s.title)
  return [
    `Edit the provided photo of a ${trade.label.toLowerCase()} project to show the construction stage "${stage.title}" (stage ${stage.index + 1} of ${o.stages.length}).`,
    o.hasPrevious
      ? `The first image is the approved previous stage (${prior.at(-1)}); continue from it. The original site photo is supplied as a reference for everything that must stay unchanged.`
      : 'The first image is the original site photo.',
    `Work area: ${scene.workArea.description}. Only modify pixels inside the white region of the mask image.`,
    '',
    `Show in the work area: ${stage.description}`,
    'Required visible details:',
    bullet(stage.checklist),
    '',
    'Keep exactly as in the original photo:',
    bullet([
      `camera position and framing: ${scene.cameraPosition}`,
      `lighting: ${scene.lighting}`,
      ...scene.mustRemainUnchanged,
    ]),
    '',
    bullet(trade.globalRules),
  ].join('\n')
}

export function templateTransitionPrompt(o: { scene: SceneAnalysis; fromTitle: string; toStage: Stage }): string {
  return [
    `Static locked-off camera, no camera movement, no zoom. Time-lapse of construction work on ${o.scene.workArea.description}.`,
    `Transition from "${o.fromTitle}" to "${o.toStage.title}": ${o.toStage.motionHint}.`,
    'Everything outside the work area stays still and unchanged. No people appear, no text, smooth continuous motion, photorealistic.',
  ].join(' ')
}

export function transitionLabel(t: Pick<Transition, 'index'>, fromTitle: string, toTitle: string) {
  return `Clip ${t.index + 1}: ${fromTitle} → ${toTitle}`
}
