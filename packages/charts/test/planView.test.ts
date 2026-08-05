import assert from 'node:assert/strict'
import test from 'node:test'

import { SURFACES_BY_NAME, square, type Surface } from '@kangaroos/core'

import { createCoverage, stampCoverage } from '@kangaroos/core'

import { applyFog, rasteriseSurface, toPlanPixel } from '../dist/index.js'

/** Node has no canvas, so the raster gets a plain-object ImageData. */
const makeImageData = (w: number, h: number): ImageData =>
  ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: 'srgb' }) as ImageData

const bowl: Surface = {
  name: 'bowl',
  domain: square(-4, 4),
  height: (x, y) => -(x * x + y * y),
  gradient: (x, y) => ({ x: -2 * x, y: -2 * y }),
  globalOptimum: { x: 0, y: 0, height: 0 },
}

test('the raster is the requested size and fully opaque', () => {
  const r = rasteriseSurface(bowl, 32, makeImageData)
  assert.equal(r.width, 32)
  assert.equal(r.heights.length, 32 * 32)
  for (let k = 0; k < 32 * 32; k++) assert.equal(r.image.data[k * 4 + 3], 255)
  assert.throws(() => rasteriseSurface(bowl, 1, makeImageData), />= 2/)
})

test('north is up — the summit of a bowl lands in the middle, not a corner', () => {
  const r = rasteriseSurface(bowl, 33, makeImageData)
  let bestK = 0
  for (let k = 1; k < r.heights.length; k++) if (r.heights[k]! > r.heights[bestK]!) bestK = k
  assert.equal(Math.floor(bestK / 33), 16)
  assert.equal(bestK % 33, 16)
})

test('row order is flipped relative to the domain', () => {
  // The bug this catches renders every plan view upside down, which on a
  // symmetric test surface is invisible — hence an asymmetric one.
  const ramp: Surface = {
    name: 'ramp',
    domain: square(-1, 1),
    height: (_x, y) => y,
    gradient: () => ({ x: 0, y: 1 }),
  }
  const r = rasteriseSurface(ramp, 8, makeImageData)
  assert.ok(r.heights[0]! > r.heights[7 * 8]!, 'the top row must be the high one')
})

test('toPlanPixel puts the domain corners in the right screen corners', () => {
  const view = { x: 10, y: 20, size: 100 }
  const topLeft = toPlanPixel(bowl, { x: -4, y: 4 }, view)
  assert.deepEqual(topLeft, { x: 10, y: 20 })
  const bottomRight = toPlanPixel(bowl, { x: 4, y: -4 }, view)
  assert.deepEqual(bottomRight, { x: 110, y: 120 })
})

test('fog darkens unseen ground and leaves seen ground alone', () => {
  const size = 24
  const r = rasteriseSurface(bowl, size, makeImageData)
  const coverage = createCoverage(size)
  stampCoverage(coverage, bowl, { x: 0, y: 0 }, { radius: 1, feather: 0 })

  const out = makeImageData(size, size)
  applyFog(out, r.image, coverage)

  const centre = (12 * size + 12) * 4
  assert.equal(out.data[centre], r.image.data[centre], 'fully seen ground must be untouched')

  const corner = 0
  assert.ok(coverage.data[0] === 0, 'precondition: the corner is unseen')
  // Unseen ground goes to the void colour, whatever that is.
  assert.ok(
    Math.abs(out.data[corner]! - 0x11) <= 1 &&
      Math.abs(out.data[corner + 1]! - 0x10) <= 1 &&
      Math.abs(out.data[corner + 2]! - 0x09) <= 1,
    `unseen corner should be the void colour, got ${out.data[corner]},${out.data[corner + 1]},${out.data[corner + 2]}`,
  )
})

test('partial strength leaves unseen ground visible but dimmed', () => {
  const size = 16
  const r = rasteriseSurface(SURFACES_BY_NAME.Himmelblau!, size, makeImageData)
  const coverage = createCoverage(size)
  const out = makeImageData(size, size)
  applyFog(out, r.image, coverage, { strength: 0.5 })

  for (let k = 0; k < size * size; k++) {
    const src = r.image.data[k * 4]!
    const dst = out.data[k * 4]!
    assert.ok(dst <= src + 1, 'fog must never brighten')
    if (src > 40) assert.ok(dst > 0, 'half strength must not go fully black')
  }
})
