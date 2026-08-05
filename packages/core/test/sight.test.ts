import assert from 'node:assert/strict'
import test from 'node:test'

import {
  clearCoverage,
  coverageFraction,
  coverageToBytes,
  createCoverage,
  square,
  stampCoverage,
  type Surface,
} from '../dist/index.js'

const bowl: Surface = {
  name: 'bowl',
  domain: square(-4, 4),
  height: (x, y) => -(x * x + y * y),
  gradient: (x, y) => ({ x: -2 * x, y: -2 * y }),
}

test('coverage starts dark and only ever brightens', () => {
  const c = createCoverage(40)
  assert.equal(coverageFraction(c), 0)

  stampCoverage(c, bowl, { x: 0, y: 0 }, { radius: 1 })
  const after1 = coverageFraction(c)
  assert.ok(after1 > 0 && after1 < 1, `covered ${after1}`)

  const snapshot = Float32Array.from(c.data)
  stampCoverage(c, bowl, { x: 2, y: 2 }, { radius: 1 })
  for (let k = 0; k < c.data.length; k++) {
    assert.ok(c.data[k]! >= snapshot[k]!, `coverage fell at ${k} — she forgot a hillside`)
  }
  assert.ok(coverageFraction(c) > after1)
})

test('a stamp is centred where it was asked for', () => {
  const c = createCoverage(41)
  stampCoverage(c, bowl, { x: 0, y: 0 }, { radius: 1, feather: 0 })
  assert.equal(c.data[20 * 41 + 20], 1)
  assert.equal(c.data[0], 0)
})

test('row 0 is the northern edge, matching the raster convention', () => {
  // Off-by-a-flip here puts the fog on the wrong half of the map, which is
  // invisible on a symmetric surface and wrong on every real one.
  const c = createCoverage(21)
  stampCoverage(c, bowl, { x: 0, y: 3.9 }, { radius: 0.5, feather: 0 })
  assert.ok(c.data[0 * 21 + 10]! > 0, 'the north edge should light the top row')
  assert.equal(c.data[20 * 21 + 10], 0)
})

test('a stamp at the edge does not wrap or crash', () => {
  const c = createCoverage(32)
  for (const p of [
    { x: -4, y: -4 },
    { x: 4, y: 4 },
    { x: -4, y: 4 },
    { x: 40, y: 40 },
  ]) {
    stampCoverage(c, bowl, p, { radius: 1.5 })
  }
  assert.ok(Array.from(c.data).every((v) => v >= 0 && v <= 1))

  const corner = createCoverage(32)
  stampCoverage(corner, bowl, { x: -4, y: -4 }, { radius: 1, feather: 0 })
  assert.equal(corner.data[0 * 32 + 31], 0, 'wrapped to the far side')
})

test('clearing resets it', () => {
  const c = createCoverage(16)
  stampCoverage(c, bowl, { x: 0, y: 0 }, { radius: 2 })
  assert.ok(coverageFraction(c) > 0)
  clearCoverage(c)
  assert.equal(coverageFraction(c), 0)
})

test('byte conversion spans the full range and reuses its buffer', () => {
  const c = createCoverage(8)
  stampCoverage(c, bowl, { x: 0, y: 0 }, { radius: 8, feather: 0 })
  const bytes = coverageToBytes(c)
  assert.equal(bytes.length, 64)
  assert.ok(bytes.every((b) => b === 255))

  const reused = new Uint8Array(64)
  assert.equal(coverageToBytes(c, reused), reused)
})

test('a bad size throws rather than allocating nonsense', () => {
  assert.throws(() => createCoverage(1), />= 2/)
  assert.throws(() => createCoverage(8.5), /integer/)
})
