import assert from 'node:assert/strict'
import test from 'node:test'

import { projectToNdc, solveFraming, type FramingRequest } from '../dist/framing.js'

/** The article's own world box: domain normalized to ±1, terrain 0..0.35. */
const WORLD = {
  halfExtents: [1, 0.175, 1] as const,
  centre: [0, 0.175, 0] as const,
}

const BASE: FramingRequest = {
  ...WORLD,
  azimuth: 45,
  elevation: 28,
  fill: 0.94,
  fov: 42,
  // A 960x420 figure plate, which is what the article actually draws.
  aspect: 960 / 420,
}

/** Screen bounding box of the eight corners, in NDC. */
function projectedBounds(req: FramingRequest) {
  const framing = solveFraming(req)
  const [hx, hy, hz] = req.halfExtents
  const [cx, cy, cz] = req.centre

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const p = projectToNdc(
          [cx + sx * hx, cy + sy * hy, cz + sz * hz],
          framing,
          req.fov,
          req.aspect,
        )
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        minY = Math.min(minY, p.y)
        maxY = Math.max(maxY, p.y)
      }
    }
  }
  return { framing, minX, maxX, minY, maxY }
}

// ── the two things a framing has to do ─────────────────────────────────────

test('the box lands centred on screen', () => {
  const b = projectedBounds(BASE)
  // Half a percent of the half-frame, which at 960px is two pixels.
  assert.ok(Math.abs(b.minX + b.maxX) / 2 < 0.005, `x centre ${(b.minX + b.maxX) / 2}`)
  assert.ok(Math.abs(b.minY + b.maxY) / 2 < 0.005, `y centre ${(b.minY + b.maxY) / 2}`)
})

test('the box fills the frame to the requested fraction, and no more', () => {
  const b = projectedBounds(BASE)
  const used = Math.max((b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2)
  assert.ok(Math.abs(used - BASE.fill) < 0.01, `filled ${used}, wanted ${BASE.fill}`)
  // Nothing clipped: NDC beyond 1 is off the edge of the canvas.
  for (const n of [b.minX, b.maxX, b.minY, b.maxY]) assert.ok(Math.abs(n) <= 1)
})

/**
 * The regression the solver exists for. Fitting the frustum planes rather than
 * the projection put the near corner at 92% of the half-height below centre
 * and the far one 32% above it — 62% of the frame used, sagging low. Both
 * numbers are what the closed form produced on this exact box.
 */
test('it beats fitting the frustum planes, which is what it replaced', () => {
  const b = projectedBounds(BASE)
  const height = (b.maxY - b.minY) / 2
  assert.ok(height > 0.85, `vertical fill ${height} — the frustum fit managed 0.62`)
  assert.ok(Math.abs((b.minY + b.maxY) / 2) < 0.02, 'and it should not sag')
})

// ── it has to hold across shapes, not just the one it was tuned on ─────────

test('every aspect from a phone to a cinema strip centres and fills', () => {
  for (const aspect of [0.75, 1, 1.4, 16 / 9, 960 / 420, 3.2]) {
    const b = projectedBounds({ ...BASE, aspect })
    const used = Math.max((b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2)
    assert.ok(Math.abs(used - BASE.fill) < 0.01, `aspect ${aspect}: filled ${used}`)
    assert.ok(Math.abs(b.minX + b.maxX) / 2 < 0.005, `aspect ${aspect}: off-centre in x`)
    assert.ok(Math.abs(b.minY + b.maxY) / 2 < 0.005, `aspect ${aspect}: off-centre in y`)
  }
})

test('every viewing direction centres and fills', () => {
  for (const azimuth of [0, 30, 45, 90, 135, 200, 315]) {
    for (const elevation of [10, 28, 45, 70, 89]) {
      const b = projectedBounds({ ...BASE, azimuth, elevation })
      const used = Math.max((b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2)
      assert.ok(
        Math.abs(used - BASE.fill) < 0.01,
        `az ${azimuth} el ${elevation}: filled ${used}`,
      )
      assert.ok(
        Math.hypot(b.minX + b.maxX, b.minY + b.maxY) / 2 < 0.01,
        `az ${azimuth} el ${elevation}: off-centre`,
      )
    }
  }
})

test('straight down does not produce a degenerate basis', () => {
  const b = projectedBounds({ ...BASE, elevation: 90 })
  const used = Math.max((b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2)
  assert.ok(Number.isFinite(used) && Math.abs(used - BASE.fill) < 0.01)
  // Looking down the +Y axis at a box centred on the origin: the camera is
  // directly above it.
  const f = solveFraming({ ...BASE, elevation: 90 })
  assert.ok(Math.hypot(f.position.x, f.position.z) < 1e-6)
  assert.ok(f.position.y > 0)
})

// ── the camera itself has to be usable ─────────────────────────────────────

test('the camera stays outside the box it is framing', () => {
  for (const elevation of [10, 28, 60]) {
    const f = solveFraming({ ...BASE, elevation })
    const [hx, hy, hz] = WORLD.halfExtents
    const outside =
      Math.abs(f.position.x) > hx ||
      Math.abs(f.position.y - WORLD.centre[1]) > hy ||
      Math.abs(f.position.z) > hz
    assert.ok(outside, `elevation ${elevation} put the camera inside the terrain`)
  }
})

test('a taller box is framed from further away', () => {
  const flat = solveFraming({ ...BASE, halfExtents: [1, 0.05, 1], centre: [0, 0.05, 0] })
  const tall = solveFraming({ ...BASE, halfExtents: [1, 0.6, 1], centre: [0, 0.6, 0] })
  assert.ok(tall.distance > flat.distance)
})

test('distance scales with the box, so units do not matter', () => {
  const small = solveFraming(BASE)
  const big = solveFraming({
    ...BASE,
    halfExtents: [100, 17.5, 100],
    centre: [0, 17.5, 0],
  })
  // Same shape, 100x the size, so 100x the distance and the same framing.
  assert.ok(Math.abs(big.distance / small.distance - 100) < 0.01)
})
