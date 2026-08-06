import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SURFACES,
  ackley,
  createSceneTransform,
  eggholder,
  griewank,
  himmelblau,
  hopArc,
  hopAt,
  hopDuration,
  hopPose,
  sampleGradientGrid,
  sampleHeightGrid,
  schwefel,
  type Surface,
} from '../dist/index.js'

// ── the hop ────────────────────────────────────────────────────────────────

const A = { x: 0, y: 0, z: 0 }
const B = { x: 3, y: 1, z: 4 } // horizontal distance exactly 5

test('a hop starts and ends exactly on its endpoints', () => {
  const start = hopPose(A, B, 0)
  const end = hopPose(A, B, 1)
  assert.deepEqual(start.position, A)
  assert.equal(end.position.x, B.x)
  assert.equal(end.position.z, B.z)
  assert.ok(Math.abs(end.position.y - B.y) < 1e-12)
})

test('the arc rises above the straight line and peaks in the middle', () => {
  const chord = (t: number) => A.y + (B.y - A.y) * t
  let peakT = 0
  let peak = -Infinity
  for (let i = 0; i <= 100; i++) {
    const t = i / 100
    const lift = hopPose(A, B, t).position.y - chord(t)
    assert.ok(lift >= -1e-12, `dipped below the chord at t=${t}`)
    if (lift > peak) {
      peak = lift
      peakT = t
    }
  }
  assert.ok(Math.abs(peakT - 0.5) < 1e-9, `apex at t=${peakT}`)
})

test('apex scales linearly with step distance and is not clamped', () => {
  // The whole point: a step twice as long launches twice as high. Clamping
  // would make a wild overshoot look like an ordinary hop.
  const apex = (to: { x: number; y: number; z: number }) =>
    hopPose(A, to, 0.5, { minApex: 0 }).position.y - (A.y + (to.y - A.y) * 0.5)

  const near = apex({ x: 1, y: 0, z: 0 })
  const far = apex({ x: 2, y: 0, z: 0 })
  const wild = apex({ x: 100, y: 0, z: 0 })

  assert.ok(Math.abs(far / near - 2) < 1e-9, `doubling distance gave ${far / near}x apex`)
  assert.ok(Math.abs(wild / near - 100) < 1e-6, 'a huge step should give a huge arc')
})

test('horizontal speed is constant through the hop', () => {
  // Projectile motion, not an eased tween. Uneven horizontal speed would read
  // as the kangaroo hesitating mid-air.
  let previous = 0
  for (let i = 1; i <= 20; i++) {
    const p = hopPose(A, B, i / 20).position
    const travelled = Math.hypot(p.x - A.x, p.z - A.z)
    const delta = travelled - previous
    if (i > 1) assert.ok(Math.abs(delta - 0.25) < 1e-9, `step ${i} advanced ${delta}`)
    previous = travelled
  }
})

test('squash and stretch conserves volume', () => {
  for (let i = 0; i <= 20; i++) {
    const { scale } = hopPose(A, B, i / 20)
    const volume = scale.x * scale.y * scale.z
    assert.ok(Math.abs(volume - 1) < 1e-9, `volume was ${volume} at t=${i / 20}`)
  }
})

test('the kangaroo crouches on the ground and stretches at the apex', () => {
  assert.ok(hopPose(A, B, 0).scale.y < 0.75, 'should be crouched at takeoff')
  assert.ok(hopPose(A, B, 1).scale.y < 0.75, 'should be crouched on landing')
  assert.ok(hopPose(A, B, 0.5).scale.y > 1.1, 'should be stretched at the apex')
})

test('heading faces the direction of travel', () => {
  assert.ok(Math.abs(hopPose(A, { x: 0, y: 0, z: 5 }, 0.5).heading - 0) < 1e-9)
  assert.ok(Math.abs(hopPose(A, { x: 5, y: 0, z: 0 }, 0.5).heading - Math.PI / 2) < 1e-9)
})

test('a rejected hop keeps the previous heading instead of snapping', () => {
  const held = hopPose(A, { ...A }, 0.5, {}, 1.234)
  assert.equal(held.heading, 1.234)
})

test('hopPose survives nonsense t values', () => {
  for (const t of [-5, 2, NaN, Infinity]) {
    const p = hopPose(A, B, t)
    assert.ok(Number.isFinite(p.position.x) && Number.isFinite(p.position.y))
    assert.ok(p.t >= 0 && p.t <= 1)
  }
})

test('hopAt walks a run and then reports finished', () => {
  // 4 states = 3 hops, 10 frames each.
  assert.deepEqual(hopAt(4, 0, 10), { index: 0, t: 0, finished: false })
  assert.deepEqual(hopAt(4, 5, 10), { index: 0, t: 0.5, finished: false })
  assert.deepEqual(hopAt(4, 10, 10), { index: 1, t: 0, finished: false })
  assert.deepEqual(hopAt(4, 25, 10), { index: 2, t: 0.5, finished: false })
  assert.deepEqual(hopAt(4, 30, 10), { index: 2, t: 1, finished: true })
  assert.deepEqual(hopAt(4, 9999, 10), { index: 2, t: 1, finished: true })
})

test('hopAt handles degenerate runs and negative frames', () => {
  assert.deepEqual(hopAt(1, 5, 10), { index: 0, t: 0, finished: true })
  assert.deepEqual(hopAt(0, 5, 10), { index: 0, t: 0, finished: true })
  assert.deepEqual(hopAt(4, -20, 10), { index: 0, t: 0, finished: false })
  assert.throws(() => hopAt(4, 0, 0), /positive finite/)
})

test('hopDuration matches where hopAt finishes', () => {
  const frames = hopDuration(4, 10)
  assert.equal(frames, 30)
  assert.ok(hopAt(4, frames, 10).finished)
  assert.ok(!hopAt(4, frames - 1, 10).finished)
})

test('hopArc returns shared endpoints so trails have no seam', () => {
  const arc = hopArc(A, B, 8)
  assert.equal(arc.length, 9)
  assert.deepEqual(arc[0], A)
  assert.ok(Math.abs(arc[8]!.x - B.x) < 1e-12 && Math.abs(arc[8]!.z - B.z) < 1e-12)
  assert.throws(() => hopArc(A, B, 0), />= 1/)
})

// ── grid sampling ──────────────────────────────────────────────────────────

test('height grids are the right size and finite', () => {
  for (const s of SURFACES) {
    const g = sampleHeightGrid(s, 33)
    assert.equal(g.heights.length, 33 * 33)
    assert.ok(Number.isFinite(g.min) && Number.isFinite(g.max))
    assert.ok(g.max >= g.min)
  }
})

test('grid corners land exactly on the domain corners', () => {
  const n = 17
  const g = sampleHeightGrid(himmelblau, n)
  const d = himmelblau.domain
  assert.ok(Math.abs(g.heights[0]! - himmelblau.height(d.xMin, d.yMin)) < 1e-9)
  assert.ok(Math.abs(g.heights[n - 1]! - himmelblau.height(d.xMax, d.yMin)) < 1e-9)
  assert.ok(Math.abs(g.heights[n * n - 1]! - himmelblau.height(d.xMax, d.yMax)) < 1e-9)
})

test('a fine grid gets close to the known optimum', () => {
  for (const s of [himmelblau, griewank, ackley]) {
    const g = sampleHeightGrid(s, 401)
    const range = g.max - g.min
    assert.ok(
      s.globalOptimum!.height - g.max < range * 0.02,
      `${s.name}: best sample ${g.max} vs optimum ${s.globalOptimum!.height}`,
    )
  }
})

test('grid resolution is validated', () => {
  assert.throws(() => sampleHeightGrid(himmelblau, 1), />= 2/)
  assert.throws(() => sampleHeightGrid(himmelblau, 8.5), /integer/)
})

test('gradient grids track their largest magnitude', () => {
  const g = sampleGradientGrid(himmelblau, 33)
  assert.equal(g.gx.length, 33 * 33)
  assert.ok(g.maxMagnitude > 0)
  for (let i = 0; i < g.gx.length; i++) {
    assert.ok(Math.hypot(g.gx[i]!, g.gy[i]!) <= g.maxMagnitude + 1e-9)
  }
})

// ── scene transform ────────────────────────────────────────────────────────

test('the domain maps onto [-1, 1] in world XZ', () => {
  for (const s of SURFACES) {
    const t = createSceneTransform(s)
    const d = s.domain
    const corners = [
      t.toWorldXZ(d.xMin, d.yMin),
      t.toWorldXZ(d.xMax, d.yMax),
      t.toWorldXZ(d.xMin, d.yMax),
    ]
    for (const c of corners) {
      assert.ok(Math.abs(Math.abs(c.x) - 1) < 1e-9, `${s.name}: x was ${c.x}`)
      assert.ok(Math.abs(Math.abs(c.z) - 1) < 1e-9, `${s.name}: z was ${c.z}`)
    }
    assert.deepEqual(t.toWorldXZ((d.xMin + d.xMax) / 2, (d.yMin + d.yMax) / 2), { x: 0, z: -0 })
  }
})

test('north points up under a top-down camera', () => {
  // Domain +y is north; screen-up for a camera looking down -Y is -Z.
  const t = createSceneTransform(himmelblau)
  assert.ok(t.toWorldXZ(0, 4).z < t.toWorldXZ(0, -4).z, 'increasing y should decrease world z')
})

test('world XZ round-trips back to the domain', () => {
  for (const s of SURFACES) {
    const t = createSceneTransform(s)
    const d = s.domain
    for (const p of [
      { x: d.xMin, y: d.yMin },
      { x: d.xMax, y: d.yMax },
      { x: (d.xMin + d.xMax) / 3, y: (d.yMin + d.yMax) / 7 },
    ]) {
      const w = t.toWorldXZ(p.x, p.y)
      const back = t.fromWorldXZ(w.x, w.z)
      const scale = Math.max(1, Math.abs(p.x), Math.abs(p.y))
      assert.ok(Math.abs(back.x - p.x) / scale < 1e-12, `${s.name}: x`)
      assert.ok(Math.abs(back.y - p.y) / scale < 1e-12, `${s.name}: y`)
    }
  }
})

test('altitude normalizes into 0..1 and scales into world Y', () => {
  for (const s of SURFACES) {
    const t = createSceneTransform(s, { verticalScale: 0.5 })
    assert.ok(Math.abs(t.normalizeHeight(t.heightMin)) < 1e-12)
    assert.ok(Math.abs(t.normalizeHeight(t.heightMax) - 1) < 1e-12)
    assert.ok(Math.abs(t.toWorldY(t.heightMax) - 0.5) < 1e-12)
  }
})

test('wildly different surfaces end up the same size on screen', () => {
  // Griewank spans 1200 units and Himmelblau spans 10; the whole reason the
  // transform exists is that a camera cannot frame both otherwise.
  const heights = SURFACES.map((s) => {
    const t = createSceneTransform(s)
    return t.toWorldY(t.heightMax) - t.toWorldY(t.heightMin)
  })
  for (const h of heights) assert.ok(Math.abs(h - 0.35) < 1e-9, `got ${h}`)
})

test('a caller-supplied height range is respected', () => {
  const t = createSceneTransform(himmelblau, { heightRange: { min: -100, max: 0 } })
  assert.equal(t.heightMin, -100)
  assert.equal(t.heightMax, 0)
  assert.ok(Math.abs(t.normalizeHeight(-50) - 0.5) < 1e-12)
})

test('a flat surface does not divide by zero', () => {
  const t = createSceneTransform(himmelblau, { heightRange: { min: 5, max: 5 } })
  assert.equal(t.normalizeHeight(5), 0.5)
  assert.ok(Number.isFinite(t.toWorldY(5)))
  assert.deepEqual(t.normalFromGradient({ x: 3, y: -2 }), { x: 0, y: 1, z: 0 })
})

test('normals are unit length and point upward', () => {
  for (const s of SURFACES) {
    const t = createSceneTransform(s)
    const grid = sampleGradientGrid(s, 21)
    for (let i = 0; i < grid.gx.length; i++) {
      const n = t.normalFromGradient({ x: grid.gx[i]!, y: grid.gy[i]! })
      assert.ok(Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 1e-9, `${s.name}: not unit length`)
      assert.ok(n.y > 0, `${s.name}: normal pointed downward`)
    }
  }
})

test('a flat spot has a straight-up normal, a slope leans away from uphill', () => {
  const t = createSceneTransform(himmelblau)
  const flat = t.normalFromGradient({ x: 0, y: 0 })
  // Compared numerically rather than structurally: negating a zero slope gives
  // -0, which deepEqual treats as distinct from 0.
  assert.ok(Math.abs(flat.x) < 1e-12 && Math.abs(flat.z) < 1e-12)
  assert.ok(Math.abs(flat.y - 1) < 1e-12)

  // Uphill in +x should tilt the normal toward -x.
  const n = t.normalFromGradient({ x: 10, y: 0 })
  assert.ok(n.x < 0, `expected the normal to lean away from uphill, got x=${n.x}`)
})

test('normals agree with finite differences on the world heightfield', () => {
  const t = createSceneTransform(schwefel)
  const d = schwefel.domain
  const h = 1e-4

  for (const p of [
    { x: 100, y: -200 },
    { x: -50, y: 300 },
    { x: 12.5, y: 12.5 },
  ]) {
    const analytic = t.normalFromGradient(schwefel.gradient(p.x, p.y))

    // Rebuild the same normal from world-space samples of the heightfield.
    const w = (x: number, y: number) => t.toWorld(x, y, schwefel.height(x, y))
    const here = w(p.x, p.y)
    const dx = w(p.x + h, p.y)
    const dz = w(p.x, p.y + h)
    const slopeX = (dx.y - here.y) / (dx.x - here.x)
    const slopeZ = (dz.y - here.y) / (dz.z - here.z)
    const len = Math.hypot(slopeX, 1, slopeZ)
    const numeric = { x: -slopeX / len, y: 1 / len, z: -slopeZ / len }

    assert.ok(Math.abs(analytic.x - numeric.x) < 1e-4, `x: ${analytic.x} vs ${numeric.x}`)
    assert.ok(Math.abs(analytic.z - numeric.z) < 1e-4, `z: ${analytic.z} vs ${numeric.z}`)
  }
  assert.ok(d.xMax > d.xMin)
})

test('toWorld agrees with its own component parts', () => {
  const t = createSceneTransform(eggholder)
  const h = eggholder.height(100, -100)
  const full = t.toWorld(100, -100, h)
  const xz = t.toWorldXZ(100, -100)
  assert.equal(full.x, xz.x)
  assert.equal(full.z, xz.z)
  assert.equal(full.y, t.toWorldY(h))
})

// ── aspect ratio ───────────────────────────────────────────────────────────

/**
 * A rectangular domain has to render as a rectangle.
 *
 * The transform used to divide X and Y by their own half-extents, which maps
 * any domain onto the unit square. Every analytic surface is square so it was
 * invisible for a long time — and then real terrain arrived, where a
 * whole-Earth region is 40,000 km by 18,800 km and squashing it to a square
 * makes the Pacific as tall as it is wide.
 */
function rectangular(width: number, height: number): Surface {
  return {
    name: 'rect',
    domain: { xMin: -width / 2, xMax: width / 2, yMin: -height / 2, yMax: height / 2 },
    // A tilted plane, so the range is non-degenerate and the gradient is known.
    height: (x, y) => x * 0.001 + y * 0.002,
    gradient: () => ({ x: 0.001, y: 0.002 }),
  }
}

test('a square domain still fills the unit square exactly', () => {
  const t = createSceneTransform(rectangular(100, 100))
  assert.equal(t.halfExtentX, 1)
  assert.equal(t.halfExtentZ, 1)
  assert.ok(Math.abs(t.toWorldXZ(50, 50).x - 1) < 1e-12)
  assert.ok(Math.abs(t.toWorldXZ(50, 50).z + 1) < 1e-12)
})

test('a wide domain keeps its proportions, with the long axis at 1', () => {
  // The world: 40,075 km by 18,798 km, or 2.13 to 1.
  const t = createSceneTransform(rectangular(40075, 18798))
  assert.equal(t.halfExtentX, 1)
  assert.ok(Math.abs(t.halfExtentZ - 18798 / 40075) < 1e-9, `${t.halfExtentZ}`)

  const corner = t.toWorldXZ(40075 / 2, 18798 / 2)
  assert.ok(Math.abs(corner.x - 1) < 1e-9)
  assert.ok(Math.abs(corner.z + 18798 / 40075) < 1e-9)
})

test('a tall domain is handled the same way round', () => {
  const t = createSceneTransform(rectangular(500, 2000))
  assert.equal(t.halfExtentZ, 1)
  assert.ok(Math.abs(t.halfExtentX - 0.25) < 1e-12)
})

test('one world unit is the same distance on both axes', () => {
  // The property the whole change exists for: equal ground distances must map
  // to equal world distances, whichever direction they run in.
  const t = createSceneTransform(rectangular(40000, 10000))
  const east = t.toWorldXZ(1000, 0).x - t.toWorldXZ(0, 0).x
  const north = t.toWorldXZ(0, 0).z - t.toWorldXZ(0, 1000).z
  assert.ok(Math.abs(east - north) < 1e-12, `${east} vs ${north}`)
})

test('the round trip through world XZ survives a rectangular domain', () => {
  const t = createSceneTransform(rectangular(40075, 18798))
  for (const [x, y] of [
    [0, 0],
    [12000, -4000],
    [-20037, 9399],
  ] as const) {
    const w = t.toWorldXZ(x, y)
    const back = t.fromWorldXZ(w.x, w.z)
    assert.ok(Math.abs(back.x - x) < 1e-6, `${back.x} vs ${x}`)
    assert.ok(Math.abs(back.y - y) < 1e-6, `${back.y} vs ${y}`)
  }
})

test('normals stay unit length and upright on a rectangular domain', () => {
  const t = createSceneTransform(rectangular(40075, 18798))
  const n = t.normalFromGradient({ x: 0.001, y: 0.002 })
  assert.ok(Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 1e-9)
  assert.ok(n.y > 0, 'a heightfield normal always has a positive Y')
})
