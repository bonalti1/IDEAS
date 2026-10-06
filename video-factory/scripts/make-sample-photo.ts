// Generates a synthetic "house with old driveway" photo for demos and tests.
// Usage: npx tsx scripts/make-sample-photo.ts [out.jpg] [--rotated]
import fs from 'node:fs'
import sharp from 'sharp'

export async function samplePhoto(o: { rotated?: boolean } = {}) {
  const w = 1600
  const h = 1200
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ec5ff"/><stop offset="1" stop-color="#dbeafe"/></linearGradient></defs>
  <rect width="${w}" height="${h * 0.45}" fill="url(#sky)"/>
  <rect y="${h * 0.45}" width="${w}" height="${h * 0.55}" fill="#5f8f3e"/>
  <polygon points="300,330 800,120 1300,330" fill="#7c2d12"/>
  <rect x="340" y="330" width="920" height="300" fill="#e7e5e4"/>
  <rect x="420" y="400" width="140" height="110" fill="#60a5fa" stroke="#fff" stroke-width="8"/>
  <rect x="1060" y="400" width="140" height="110" fill="#60a5fa" stroke="#fff" stroke-width="8"/>
  <rect x="640" y="420" width="340" height="210" fill="#a8a29e" stroke="#78716c" stroke-width="6"/>
  <polygon points="640,630 980,630 1340,1200 280,1200" fill="#57534e"/>
  <path d="M700 760 L760 900 M1000 820 L960 1000 M560 1050 L640 1120" stroke="#292524" stroke-width="6"/>
  <rect y="${h - 40}" width="${w}" height="40" fill="#9ca3af"/>
  <circle cx="200" cy="560" r="90" fill="#3f6212"/><circle cx="1420" cy="560" r="90" fill="#3f6212"/>
</svg>`
  let img = sharp(Buffer.from(svg))
  if (o.rotated) {
    // Store pixels rotated and tag EXIF orientation 6 so a correct viewer shows it upright.
    img = sharp(await img.rotate(-90).png().toBuffer()).withMetadata({ orientation: 6 })
  }
  return img.jpeg({ quality: 90 }).toBuffer()
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] ?? 'sample-driveway.jpg'
  fs.writeFileSync(out, await samplePhoto({ rotated: process.argv.includes('--rotated') }))
  console.log('wrote', out)
}
