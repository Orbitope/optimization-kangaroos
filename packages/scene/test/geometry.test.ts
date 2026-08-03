import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ackley,
  collect,
  createSampledSurface,
  createSceneTransform,
  createTrueSurface,
  hillClimber,
  himmelblau,
  mulberry32,
  schwefel,
} from '@kangaroos/core'

import {
  buildArrowField,
  buildMaxTerrainGeometry,
  buildTerrainGeometry,
  buildTrailGeometry,
  elevationLutLinear,
  statesToWorld,
} from '../dist/geometry.js'

const transform = (s = himmelblau) => createSceneTransform(s, { probeResolution: 64 })

// ── elevation LUT ──────────────────────────────────────────────────────────

test('the LUT is linear-space and ordered dark to bright', () => {
  const lut = elevationLutLinear(64)
  assert.equal(lut.length, 64 * 3)
  for (let i = 0; i < lut.length; i++) {
    assert.ok(lut[i]! >= 0 && lut[i]! <= 1, `entry ${i} is out of range: ${lut[i]}`)
  }
  const lum = (i: number) =>
    0.2126 * lut[i * 3]! + 0.7152 * lut[i * 3 + 1]! + 0.0722 * lut[i * 3 + 2]!
  assert.ok(lum(63) > lum(0) * 4, 'the summit should be far brighter than the ocean floor')
})

test('the LUT is genuinely linear, not sRGB', () => {
  // A linear ramp reads much darker at the dark end than its sRGB counterpart.
  // Getting this wrong washes the terrain out in a way that looks like a
  // lighting bug rather than a colour-space bug.
  const lut = elevationLutLinear(256)
  assert.ok(lut[0]! < 0.05, `ocean floor red channel was ${lut[0]}, too bright to be linear`)
})

// ── terrain ────────────────────────────────────────────────────────────────

test('terrain geometry has consistent buffer sizes', () => {
  const n = 32
  const g = buildTerrainGeometry(himmelblau, transform(), n)
  assert.equal(g.positions.length, n * n * 3)
  assert.equal(g.normals.length, n * n * 3)
  assert.equal(g.colors.length, n * n * 3)
  assert.equal(g.indices.length, (n - 1) * (n - 1) * 6)
  assert.equal(g.resolution, n)
})

test('every terrain value is finite', () => {
  for (const s of [himmelblau, ackley, schwefel]) {
    const g = buildTerrainGeometry(s, transform(s), 24)
    for (const buf of [g.positions, g.normals, g.colors]) {
      for (let i = 0; i < buf.length; i++) {
        assert.ok(Number.isFinite(buf[i]!), `${s.name}: non-finite at index ${i}`)
      }
    }
  }
})

test('terrain fills the world box exactly', () => {
  const g = buildTerrainGeometry(himmelblau, transform(), 32)
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < g.positions.length; i += 3) {
    minX = Math.min(minX, g.positions[i]!)
    maxX = Math.max(maxX, g.positions[i]!)
    minZ = Math.min(minZ, g.positions[i + 2]!)
    maxZ = Math.max(maxZ, g.positions[i + 2]!)
  }
  assert.ok(Math.abs(minX + 1) < 1e-6 && Math.abs(maxX - 1) < 1e-6, `x spanned ${minX}..${maxX}`)
  assert.ok(Math.abs(minZ + 1) < 1e-6 && Math.abs(maxZ - 1) < 1e-6, `z spanned ${minZ}..${maxZ}`)
})

test('terrain normals are unit length and face upward', () => {
  const g = buildTerrainGeometry(schwefel, transform(schwefel), 24)
  for (let i = 0; i < g.normals.length; i += 3) {
    const len = Math.hypot(g.normals[i]!, g.normals[i + 1]!, g.normals[i + 2]!)
    assert.ok(Math.abs(len - 1) < 1e-6, `normal ${i / 3} had length ${len}`)
    assert.ok(g.normals[i + 1]! > 0, `normal ${i / 3} pointed downward`)
  }
})

test('every index is in range and every vertex is used', () => {
  const n = 16
  const g = buildTerrainGeometry(himmelblau, transform(), n)
  const used = new Set<number>()
  for (const idx of g.indices) {
    assert.ok(idx < n * n, `index ${idx} exceeds the vertex count`)
    used.add(idx)
  }
  assert.equal(used.size, n * n, 'some vertices are unreferenced')
})

test('triangles wind counter-clockwise seen from above', () => {
  // Backwards winding renders the terrain invisible from the default camera,
  // which is a confusing failure to debug visually.
  const g = buildTerrainGeometry(himmelblau, transform(), 8)
  const at = (i: number) => [g.positions[i * 3]!, g.positions[i * 3 + 2]!] as const

  let checked = 0
  for (let t = 0; t < g.indices.length; t += 3) {
    const [ax, az] = at(g.indices[t]!)
    const [bx, bz] = at(g.indices[t + 1]!)
    const [cx, cz] = at(g.indices[t + 2]!)
    // Projected onto XZ and viewed down -Y, front faces have negative cross.
    const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax)
    assert.ok(cross < 0, `triangle ${t / 3} is wound backwards`)
    checked++
  }
  assert.ok(checked > 0)
})

test('the highest vertex gets the brightest colour', () => {
  const g = buildTerrainGeometry(himmelblau, transform(), 48)
  let peak = 0
  let trough = 0
  for (let i = 1; i < g.positions.length / 3; i++) {
    if (g.positions[i * 3 + 1]! > g.positions[peak * 3 + 1]!) peak = i
    if (g.positions[i * 3 + 1]! < g.positions[trough * 3 + 1]!) trough = i
  }
  const lum = (i: number) =>
    0.2126 * g.colors[i * 3]! + 0.7152 * g.colors[i * 3 + 1]! + 0.0722 * g.colors[i * 3 + 2]!
  assert.ok(lum(peak) > lum(trough), 'the summit should be brighter than the lowest point')
})

// ── trails ─────────────────────────────────────────────────────────────────

test('trail progress runs 0 to 1 and never goes backwards', () => {
  const states = collect(hillClimber(himmelblau, mulberry32(4), { maxSteps: 30 }))
  const trail = buildTrailGeometry(statesToWorld(states, transform()), 8)

  assert.ok(trail.pointCount > 0)
  assert.equal(trail.positions.length, trail.pointCount * 3)
  assert.equal(trail.progress[0], 0)
  assert.ok(Math.abs(trail.progress[trail.pointCount - 1]! - 1) < 1e-9)
  for (let i = 1; i < trail.pointCount; i++) {
    assert.ok(trail.progress[i]! > trail.progress[i - 1]!, `progress stalled at ${i}`)
  }
})

test('consecutive hops share an endpoint, so the trail has no seam', () => {
  const points = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 0.2, z: 0 },
    { x: 2, y: 0.1, z: 1 },
  ]
  const samples = 4
  const trail = buildTrailGeometry(points, samples)
  // Two hops: (samples + 1) + samples points.
  assert.equal(trail.pointCount, samples + 1 + samples)

  // The junction vertex should be exactly the shared waypoint, once.
  const j = samples
  assert.ok(Math.abs(trail.positions[j * 3]! - 1) < 1e-9)
  assert.ok(Math.abs(trail.positions[j * 3 + 2]!) < 1e-9)
})

test('a trail with fewer than two points is empty rather than broken', () => {
  assert.equal(buildTrailGeometry([], 8).pointCount, 0)
  assert.equal(buildTrailGeometry([{ x: 0, y: 0, z: 0 }], 8).pointCount, 0)
})

test('trail points stay inside the world box', () => {
  const states = collect(hillClimber(schwefel, mulberry32(11)))
  const t = transform(schwefel)
  const trail = buildTrailGeometry(statesToWorld(states, t), 12)
  for (let i = 0; i < trail.pointCount; i++) {
    assert.ok(Math.abs(trail.positions[i * 3]!) <= 1.001, 'x escaped the box')
    assert.ok(Math.abs(trail.positions[i * 3 + 2]!) <= 1.001, 'z escaped the box')
  }
})

// ── arrows ─────────────────────────────────────────────────────────────────

test('arrow fields are sized correctly and finite', () => {
  const f = buildArrowField(himmelblau, transform(), 12)
  assert.equal(f.count, 144)
  assert.equal(f.positions.length, 144 * 3)
  for (let i = 0; i < f.count; i++) {
    assert.ok(Number.isFinite(f.headings[i]!), `heading ${i}`)
    assert.ok(f.strengths[i]! >= 0 && f.strengths[i]! <= 1, `strength ${i} = ${f.strengths[i]}`)
  }
  assert.throws(() => buildArrowField(himmelblau, transform(), 1), />= 2/)
})

test('arrows sit inside the domain, never on its edge', () => {
  const f = buildArrowField(himmelblau, transform(), 8)
  for (let i = 0; i < f.count; i++) {
    assert.ok(Math.abs(f.positions[i * 3]!) < 1, 'an arrow landed on the x boundary')
    assert.ok(Math.abs(f.positions[i * 3 + 2]!) < 1, 'an arrow landed on the z boundary')
  }
})

test('arrow headings point uphill in world space', () => {
  const t = transform()
  const f = buildArrowField(himmelblau, t, 10)

  for (let i = 0; i < f.count; i++) {
    if (f.strengths[i]! < 0.2) continue

    const base = { x: f.positions[i * 3]!, z: f.positions[i * 3 + 2]! }
    const step = 0.02
    const ahead = {
      x: base.x + Math.sin(f.headings[i]!) * step,
      z: base.z + Math.cos(f.headings[i]!) * step,
    }
    if (Math.abs(ahead.x) > 1 || Math.abs(ahead.z) > 1) continue

    const here = t.fromWorldXZ(base.x, base.z)
    const there = t.fromWorldXZ(ahead.x, ahead.z)
    assert.ok(
      himmelblau.height(there.x, there.y) > himmelblau.height(here.x, here.y),
      `arrow ${i} pointed downhill`,
    )
  }
})

test('strength normalizes against a quantile, not one cliff', () => {
  // Eggholder-like surfaces have isolated near-vertical spots. Normalizing by
  // the raw maximum would crush every other arrow to invisibility.
  const f = buildArrowField(schwefel, transform(schwefel), 16)
  const saturated = Array.from(f.strengths).filter((s) => s >= 1).length
  const visible = Array.from(f.strengths).filter((s) => s > 0.1).length
  assert.ok(saturated >= 1, 'nothing reached full strength')
  assert.ok(visible > f.count * 0.5, `only ${visible}/${f.count} arrows are visible`)
})

// ── max surface ────────────────────────────────────────────────────────────

test('the max surface takes the tallest of its inputs at every point', () => {
  const draws = [8, 9, 10].map((seed) => createSampledSurface({ count: 25, seed }))
  const t = createSceneTransform(createTrueSurface(), { probeResolution: 48 })
  const g = buildMaxTerrainGeometry(draws, ['#ff0000', '#00ff00', '#0000ff'], t, 24)

  const d = draws[0]!.domain
  for (let j = 0; j < 24; j++) {
    const y = d.yMin + ((d.yMax - d.yMin) * j) / 23
    for (let i = 0; i < 24; i++) {
      const x = d.xMin + ((d.xMax - d.xMin) * i) / 23
      const expected = t.toWorldY(Math.max(...draws.map((s) => s.height(x, y))))
      assert.ok(
        Math.abs(g.positions[(j * 24 + i) * 3 + 1]! - expected) < 1e-6,
        `at (${x}, ${y}) the surface was not the maximum`,
      )
    }
  }
})

test('the max surface is never below any single input', () => {
  const draws = [1, 2, 3, 4].map((seed) => createSampledSurface({ count: 30, seed }))
  const t = createSceneTransform(createTrueSurface(), { probeResolution: 48 })
  const g = buildMaxTerrainGeometry(draws, draws.map(() => '#ffffff'), t, 20)
  for (const single of draws) {
    const s = buildTerrainGeometry(single, t, 20)
    for (let k = 0; k < 400; k++) {
      // Float32 slack, not algorithmic slack. buildTerrainGeometry rounds each
      // height into a Float32Array before transforming it; the max builder
      // keeps full precision until the end. Where the two agree exactly in
      // f64 they can still land on adjacent f32 values, about 1.5e-8 apart.
      assert.ok(g.positions[k * 3 + 1]! >= s.positions[k * 3 + 1]! - 1e-6)
    }
  }
})

test('each vertex is painted in the winning draw hue', () => {
  // Two draws far apart in colour; every vertex must be one or the other.
  const draws = [5, 6].map((seed) => createSampledSurface({ count: 20, seed }))
  const t = createSceneTransform(createTrueSurface(), { probeResolution: 48 })
  const g = buildMaxTerrainGeometry(draws, ['#ff0000', '#0000ff'], t, 24)
  for (let k = 0; k < 24 * 24; k++) {
    const [r, , bl] = [g.colors[k * 3]!, g.colors[k * 3 + 1]!, g.colors[k * 3 + 2]!]
    assert.ok(r > 1e-6 !== bl > 1e-6, `vertex ${k} is neither purely red nor purely blue`)
  }
})

test('margin fade desaturates where draws agree and not where they differ', () => {
  const t = createSceneTransform(createTrueSurface(), { probeResolution: 48 })
  const saturation = (count: number, marginFade: number) => {
    const draws = [11, 12, 13, 14, 15].map((seed) => createSampledSurface({ count, seed }))
    const colors = draws.map((_, i) => ['#C49A3C', '#6B7A8D', '#7D9A6A', '#9A7AB0', '#C47A5A'][i]!)
    const g = buildMaxTerrainGeometry(draws, colors, t, 40, marginFade)
    let total = 0
    for (let k = 0; k < 40 * 40; k++) {
      const c = [g.colors[k * 3]!, g.colors[k * 3 + 1]!, g.colors[k * 3 + 2]!]
      const mean = (c[0]! + c[1]! + c[2]!) / 3
      total += mean === 0 ? 0 : Math.max(...c.map((v) => Math.abs(v - mean))) / mean
    }
    return total / (40 * 40)
  }
  // Plain argmax cannot tell the two apart; margin fade must.
  assert.ok(saturation(10, 0.08) > saturation(400, 0.08) * 1.5, 'fade did not respond to agreement')
  assert.ok(saturation(400, 0) > saturation(400, 0.08), 'fade did not desaturate a converged set')
})

test('a max surface needs at least one input', () => {
  const t = createSceneTransform(createTrueSurface(), { probeResolution: 48 })
  assert.throws(() => buildMaxTerrainGeometry([], [], t, 8), /at least one surface/)
  assert.throws(
    () => buildMaxTerrainGeometry([createTrueSurface()], ['#fff000'], t, 1),
    />= 2/,
  )
})
