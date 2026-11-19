import { Text } from '@react-three/drei'
import { useLang, groundWords } from '../draft/lib/i18n.js'

/**
 * Text lying flat on the ground plane, plat-style. Sizes are world feet.
 * `angle` = ground direction in radians (atan2(dz, dx)); text is auto-flipped
 * so it never reads upside-down in top (north-up) view.
 */
// bundled locally — troika's default font is a CDN fetch, which we can't rely on
export const FONT_REGULAR = '/fonts/LiberationMono-Regular.ttf'
export const FONT_BOLD = '/fonts/LiberationMono-Bold.ttf'

export function FlatLabel({
  x,
  z,
  y = 0.4,
  angle = 0,
  size = 6,
  color = '#1c1e21',
  letterSpacing = 0.12,
  bold = false,
  children,
}) {
  let a = angle
  if (a > Math.PI / 2 || a < -Math.PI / 2) a += Math.PI
  // round 13: the words on the ground in the homeowner's language ("SCALE IN FEET", "10' — REAR"); English is untouched
  const { lang } = useLang()
  const words = lang === 'en' ? children : groundWords(Array.isArray(children) ? children.join('') : children, lang)
  return (
    <Text
      position={[x, y, z]}
      rotation={[-Math.PI / 2, 0, -a]}
      font={bold ? FONT_BOLD : FONT_REGULAR}
      fontSize={size}
      color={color}
      anchorX="center"
      anchorY="middle"
      letterSpacing={letterSpacing}
    >
      {words}
    </Text>
  )
}
