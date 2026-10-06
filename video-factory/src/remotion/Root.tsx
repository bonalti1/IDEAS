import { Composition, registerRoot } from 'remotion'
import { BrandCard, type BrandCardProps } from './BrandCard.tsx'

type CardInput = BrandCardProps & { seconds?: number; w?: number; h?: number }

const defaults: CardInput = { title: 'Alto Pro', subtitle: 'Concrete driveway', kicker: 'ALTO PRO' }

const Root: React.FC = () => (
  <Composition
    id="BrandCard"
    component={BrandCard}
    durationInFrames={90}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={defaults}
    calculateMetadata={({ props }) => {
      const p = props as unknown as CardInput
      return { durationInFrames: Math.max(15, Math.round((p.seconds ?? 3) * 30)), width: p.w ?? 1920, height: p.h ?? 1080 }
    }}
  />
)

registerRoot(Root)
