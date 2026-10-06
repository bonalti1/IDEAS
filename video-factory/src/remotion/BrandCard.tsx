import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'

export type BrandCardProps = {
  title: string
  subtitle: string
  kicker: string
}

/** Animated Alto Pro title card used for the intro and outro. */
export const BrandCard: React.FC<BrandCardProps> = ({ title, subtitle, kicker }) => {
  const frame = useCurrentFrame()
  const { fps, durationInFrames, width, height } = useVideoConfig()
  const s = Math.min(width, height)
  const enter = spring({ frame, fps, config: { damping: 200 } })
  const fadeOut = interpolate(frame, [durationInFrames - fps * 0.5, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const bar = interpolate(frame, [fps * 0.2, fps * 0.8], [0, s * 0.14], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ background: '#0f1720', fontFamily: 'Inter, DejaVu Sans, sans-serif', opacity: fadeOut }}>
      <div style={{ position: 'absolute', left: width * 0.08, top: height * 0.5 - s * 0.14, transform: `translateY(${(1 - enter) * s * 0.04}px)`, opacity: enter }}>
        <div style={{ color: '#fff', fontSize: s * 0.075, fontWeight: 700, lineHeight: 1.1 }}>{title}</div>
        <div style={{ height: s * 0.008, width: bar, background: '#f59e0b', margin: `${s * 0.025}px 0` }} />
        <div style={{ color: '#cbd5e1', fontSize: s * 0.04 }}>{subtitle}</div>
      </div>
      <div style={{ position: 'absolute', right: width * 0.08, bottom: height * 0.08, color: '#f59e0b', fontWeight: 700, fontSize: s * 0.03, letterSpacing: s * 0.004 }}>
        {kicker}
      </div>
    </AbsoluteFill>
  )
}
