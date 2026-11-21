// Fix round 15, office decision 1: the owner names on the sample plat are blacked out, in the test file and in the
// one committed screenshot that showed its page. A small PNG reader checks that every pixel of each box is black,
// so the names cannot be read (a person checked the pictures in docs/fix-round-15/d1-*.png too).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import zlib from 'node:zlib'

/** RGB(A) pixels of a non-interlaced 8-bit PNG. */
function readPng(file) {
  const b = fs.readFileSync(file)
  let p = 8
  let w, h, type
  const idat = []
  while (p < b.length) {
    const len = b.readUInt32BE(p)
    const kind = b.toString('latin1', p + 4, p + 8)
    const data = b.subarray(p + 8, p + 8 + len)
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      assert.equal(data[8], 8, '8-bit')
      type = data[9]
      assert.equal(data[12], 0, 'not interlaced')
    } else if (kind === 'IDAT') idat.push(data)
    p += 12 + len
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : null
  assert.ok(bpp, `colour type ${type}`)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const out = Buffer.alloc(w * h * bpp)
  const stride = w * bpp
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]
      const a = x >= bpp ? out[y * stride + x - bpp] : 0
      const up = y ? out[(y - 1) * stride + x] : 0
      const c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0
      const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c)
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? up : c
      out[y * stride + x] = (v + pred) & 255
    }
  }
  return { w, h, bpp, px: (x, y) => [...out.subarray((y * w + x) * bpp, (y * w + x) * bpp + 3)] }
}
const allBlack = (img, [x0, y0, x1, y1]) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (img.px(x, y).some((v) => v > 8)) return `pixel ${x},${y} is ${img.px(x, y)}`
  return null
}

test('D1: the owner names on the sample plat are a solid black box', () => {
  const img = readPng('test/fixtures/garza-site-plan.png')
  assert.deepEqual([img.w, img.h], [2520, 1681])
  // the box covers where the names were printed (x 2346 to 2380, y 678 to 1160 on the 2520 by 1681 sheet)
  assert.equal(allBlack(img, [2340, 670, 2390, 1168]), null)
  // and only that: the address line beside it is still there (light lettering on the navy panel)
  let light = 0
  for (let y = 680; y < 1160; y++) for (let x = 2398; x < 2420; x++) if (img.px(x, y)[0] > 150) light++
  assert.ok(light > 200, `the site address beside it is untouched (${light} light pixels)`)
})

test('D1: the one committed screenshot that showed the plat page has the names blacked out too', () => {
  const img = readPng('docs/launch-check/plat/04-lot.png')
  assert.equal(allBlack(img, [1005, 340, 1026, 550]), null)
})
