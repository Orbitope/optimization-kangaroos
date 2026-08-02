import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SURFACES,
  SURFACES_BY_NAME,
  ackley,
  domainDiagonal,
  eggholder,
  griewank,
  himmelblau,
  inDomain,
  magnitude,
  mulberry32,
  normalize,
  schwefel,
  shubert,
  uniform,
  type Surface,
} from '../dist/index.js'

const rng = () => mulberry32(20250802)

function samplePoints(s: Surface, n: number) {
  const r = rng()
  return Array.from({ length: n }, () => ({
    x: uniform(r, s.domain.xMin, s.domain.xMax),
    y: uniform(r, s.domain.yMin, s.domain.yMax),
  }))
}

test('every surface is finite across its domain', () => {
  for (const s of SURFACES) {
    for (const p of samplePoints(s, 500)) {
      const v = s.height(p.x, p.y)
      assert.ok(Number.isFinite(v), `${s.name} returned ${v} at (${p.x}, ${p.y})`)
      const g = s.gradient(p.x, p.y)
      assert.ok(
        Number.isFinite(g.x) && Number.isFinite(g.y),
        `${s.name} gradient was (${g.x}, ${g.y}) at (${p.x}, ${p.y})`,
      )
    }
  }
})

test('declared global optima have the height they claim', () => {
  for (const s of SURFACES) {
    if (!s.globalOptimum) continue
    const { x, y, height } = s.globalOptimum
    const actual = s.height(x, y)
    assert.ok(
      Math.abs(actual - height) < 1e-3,
      `${s.name}: declared ${height} at (${x}, ${y}), measured ${actual}`,
    )
  }
})

test('nothing in the domain beats the declared global optimum', () => {
  // Cheap guard against a sign error: after the maximization flip, a surface
  // that is secretly still being minimized will fail this immediately.
  for (const s of SURFACES) {
    if (!s.globalOptimum) continue
    for (const p of samplePoints(s, 20_000)) {
      assert.ok(
        s.height(p.x, p.y) <= s.globalOptimum.height + 1e-6,
        `${s.name}: found ${s.height(p.x, p.y)} at (${p.x}, ${p.y}), ` +
          `above the declared optimum ${s.globalOptimum.height}`,
      )
    }
  }
})

test('analytic gradients agree with central differences', () => {
  for (const s of SURFACES) {
    const h = domainDiagonal(s.domain) * 1e-6
    for (const p of samplePoints(s, 200)) {
      // Stay clear of the domain edge so the probe stays in bounds.
      if (!inDomain(s.domain, p.x - h, p.y - h) || !inDomain(s.domain, p.x + h, p.y + h)) continue

      const analytic = s.gradient(p.x, p.y)
      const numeric = {
        x: (s.height(p.x + h, p.y) - s.height(p.x - h, p.y)) / (2 * h),
        y: (s.height(p.x, p.y + h) - s.height(p.x, p.y - h)) / (2 * h),
      }
      const scale = Math.max(1, magnitude(analytic), magnitude(numeric))
      const err = Math.hypot(analytic.x - numeric.x, analytic.y - numeric.y) / scale
      assert.ok(
        err < 1e-3,
        `${s.name} at (${p.x}, ${p.y}): analytic (${analytic.x}, ${analytic.y}) ` +
          `vs numeric (${numeric.x}, ${numeric.y}), relative error ${err}`,
      )
    }
  }
})

test('the gradient actually points uphill', () => {
  // Only true in the limit. Over a finite stride h the second-order term is
  // O(h^2 * curvature), so it swamps the O(h * |g|) gain wherever the gradient
  // is near zero — Griewank's ripples cross a critical point every few units.
  // Take a small stride and skip near-critical points; the margin between the
  // two effects is then several orders of magnitude.
  for (const s of SURFACES) {
    const stride = domainDiagonal(s.domain) * 1e-7
    let checked = 0
    for (const p of samplePoints(s, 300)) {
      const g = s.gradient(p.x, p.y)
      if (magnitude(g) < 1e-3) continue

      const u = normalize(g)
      const ahead = { x: p.x + u.x * stride, y: p.y + u.y * stride }
      if (!inDomain(s.domain, ahead.x, ahead.y)) continue

      const here = s.height(p.x, p.y)
      const there = s.height(ahead.x, ahead.y)
      const noise = Math.max(1, Math.abs(here)) * 1e-12
      assert.ok(
        there - here > -noise,
        `${s.name}: stepping along the gradient at (${p.x}, ${p.y}) lost ` +
          `${here - there} of altitude (|g| = ${magnitude(g)})`,
      )
      checked++
    }
    assert.ok(checked > 50, `${s.name}: only ${checked} usable samples`)
  }
})

test('gradient vanishes at smooth interior optima', () => {
  for (const s of [himmelblau, griewank]) {
    const { x, y } = s.globalOptimum!
    assert.ok(
      magnitude(s.gradient(x, y)) < 1e-6,
      `${s.name} has a non-zero gradient at its own summit`,
    )
  }
})

test('Ackley reports a flat summit rather than NaN at the origin', () => {
  // The exponential term has a genuine kink there; the one-sided limits differ.
  const g = ackley.gradient(0, 0)
  assert.ok(Number.isFinite(g.x) && Number.isFinite(g.y))
  assert.equal(magnitude(g), 0)
})

test('Himmelblau has four equal maxima, not one', () => {
  const optima = [
    { x: 3, y: 2 },
    { x: -2.805118, y: 3.131312 },
    { x: -3.77931, y: -3.283186 },
    { x: 3.584428, y: -1.848126 },
  ]
  for (const o of optima) {
    assert.ok(
      Math.abs(himmelblau.height(o.x, o.y)) < 1e-4,
      `(${o.x}, ${o.y}) should be a maximum of 0, got ${himmelblau.height(o.x, o.y)}`,
    )
  }
})

test('Griewank multiplies its cosines rather than summing them', () => {
  // The sum form is a different function; f(0, y) would be flat in y under it.
  const viaProduct = -((0 + 4) / 4000 - Math.cos(0) * Math.cos(2 / Math.SQRT2) + 1)
  assert.ok(Math.abs(griewank.height(0, 2) - viaProduct) < 1e-12)
  assert.ok(
    Math.abs(griewank.height(0, 2) - griewank.height(0, 3)) > 1e-6,
    'Griewank should vary with y at x = 0',
  )
})

test('Schwefel puts its summit far from the origin', () => {
  // The point of Schwefel: local slope near the middle leads away from the top.
  assert.ok(schwefel.height(420.9687, 420.9687) > schwefel.height(0, 0))
  assert.ok(schwefel.height(420.9687, 420.9687) > schwefel.height(-420.9687, -420.9687))
})

test('Eggholder peaks at the documented corner', () => {
  const peak = eggholder.height(512, 404.2319)
  assert.ok(Math.abs(peak - 959.6407) < 1e-3, `expected 959.6407, got ${peak}`)
})

test('Shubert declines to name one global optimum', () => {
  // Eighteen are tied; picking one would be arbitrary.
  assert.equal(shubert.globalOptimum, undefined)
  let seen = 0
  for (const p of samplePoints(shubert, 50_000)) {
    if (shubert.height(p.x, p.y) > 186) seen++
  }
  assert.ok(seen > 0, 'should find points near the known maximum of ~186.73')
})

test('surfaces are registered under their own names', () => {
  for (const s of SURFACES) {
    assert.equal(SURFACES_BY_NAME[s.name], s)
  }
  assert.equal(SURFACES.length, 6)
})
