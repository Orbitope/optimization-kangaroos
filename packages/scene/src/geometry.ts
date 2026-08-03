/**
 * Geometry construction, kept free of Three.js.
 *
 * These return plain typed arrays that a component wraps in BufferAttributes.
 * Splitting it this way means the arithmetic — which is where the sign errors
 * and off-by-ones live — is testable in Node without a WebGL context.
 */

import { elevationLut, hexToLinear01 } from '@contentkit/tokens'
import {
  hopArc,
  sampleGradientGrid,
  sampleHeightGrid,
  type OptimizerState,
  type SceneTransform,
  type Surface,
  type Vec3,
} from '@kangaroos/core'

export interface TerrainGeometry {
  readonly positions: Float32Array
  readonly normals: Float32Array
  readonly colors: Float32Array
  readonly indices: Uint32Array
  /** Altitude normalized to 0..1, per vertex. Drives the contour lines. */
  readonly heights01: Float32Array
  readonly resolution: number
}

/**
 * Elevation ramp as linear-space RGB triples.
 *
 * Linear, not sRGB: Three.js assumes vertex colours are already linear when
 * colour management is on, and handing it sRGB values washes the whole terrain
 * out in a way that is easy to mistake for a lighting problem.
 */
export function elevationLutLinear(size = 256, ramp?: string): Float32Array {
  const hexes = elevationLut(size, ramp)
  const out = new Float32Array(size * 3)
  hexes.forEach((hex, i) => {
    const [r, g, b] = hexToLinear01(hex)
    out[i * 3] = r
    out[i * 3 + 1] = g
    out[i * 3 + 2] = b
  })
  return out
}

/**
 * A displaced grid over the whole domain.
 *
 * Normals come from the analytic gradients, so this never calls
 * `computeVertexNormals()` — that would average adjacent faces and throw away
 * derivatives we already have exactly.
 */
export function buildTerrainGeometry(
  surface: Surface,
  transform: SceneTransform,
  resolution: number,
  lut: Float32Array = elevationLutLinear(),
): TerrainGeometry {
  const heightGrid = sampleHeightGrid(surface, resolution)
  const gradGrid = sampleGradientGrid(surface, resolution)
  const n = resolution
  const lutSize = lut.length / 3

  const positions = new Float32Array(n * n * 3)
  const normals = new Float32Array(n * n * 3)
  const colors = new Float32Array(n * n * 3)
  const heights01 = new Float32Array(n * n)

  const { xMin, xMax, yMin, yMax } = surface.domain

  for (let j = 0; j < n; j++) {
    const y = yMin + ((yMax - yMin) * j) / (n - 1)
    for (let i = 0; i < n; i++) {
      const x = xMin + ((xMax - xMin) * i) / (n - 1)
      const k = j * n + i
      const raw = heightGrid.heights[k]!
      // A non-finite sample would poison the vertex buffer and silently blank
      // the mesh; pin it to the floor instead.
      const h = Number.isFinite(raw) ? raw : heightGrid.min

      const p = transform.toWorld(x, y, h)
      positions[k * 3] = p.x
      positions[k * 3 + 1] = p.y
      positions[k * 3 + 2] = p.z

      const nv = transform.normalFromGradient({ x: gradGrid.gx[k]!, y: gradGrid.gy[k]! })
      normals[k * 3] = nv.x
      normals[k * 3 + 1] = nv.y
      normals[k * 3 + 2] = nv.z

      const t = Math.min(1, Math.max(0, transform.normalizeHeight(h)))
      heights01[k] = t
      const bucket = Math.min(lutSize - 1, Math.round(t * (lutSize - 1)))
      colors[k * 3] = lut[bucket * 3]!
      colors[k * 3 + 1] = lut[bucket * 3 + 1]!
      colors[k * 3 + 2] = lut[bucket * 3 + 2]!
    }
  }

  return { positions, normals, colors, indices: buildGridIndices(n), heights01, resolution: n }
}

function assertGridResolution(n: number): void {
  if (!Number.isInteger(n) || n < 2) {
    throw new Error(`Grid resolution must be an integer >= 2, got ${n}`)
  }
}

/**
 * Triangulation for an n x n grid.
 *
 * Wound so front faces point at the sky. This is the opposite order to a
 * rotated PlaneGeometry: domain +y maps to world -z, so the row index runs
 * against the grain of three's usual convention. Getting it backwards makes
 * the terrain invisible from above, which is a miserable thing to debug
 * visually — hence the winding test.
 */
function buildGridIndices(n: number): Uint32Array {
  const indices = new Uint32Array((n - 1) * (n - 1) * 6)
  let w = 0
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i
      const b = a + 1
      const c = a + n
      const d = c + 1
      indices[w++] = a
      indices[w++] = b
      indices[w++] = c
      indices[w++] = b
      indices[w++] = d
      indices[w++] = c
    }
  }
  return indices
}

/**
 * The pointwise maximum of several landscapes, coloured by which one won.
 *
 * For comparing draws of the same data, this beats stacking translucent skins
 * outright. Transparency has to solve an ordering problem that has no good
 * answer with five overlapping surfaces — additive saturates to white, alpha
 * depends on draw order, and either way the middle of the frame turns to mud.
 * A max surface is opaque, sorts correctly for free, and answers a sharper
 * question: at this spot, whose hill is on top?
 *
 * The reading inverts from the stacked version and is stronger for it. A broad
 * solid patch of one colour is ground that a single draw invented and no other
 * draw supports. Speckle means the draws are within a hair of each other, which
 * is what agreement looks like.
 *
 * Colour is modulated by altitude so the surface still reads as terrain rather
 * than as a flat choropleth; hue says who, brightness says how high.
 */
export function buildMaxTerrainGeometry(
  surfaces: readonly Surface[],
  colors: readonly string[],
  transform: SceneTransform,
  resolution: number,
  /**
   * Fade a winner's colour toward neutral when it barely won, expressed as a
   * fraction of the altitude range. 0 disables.
   *
   * Argmax alone is scale-free: it reports who is on top without regard for by
   * how much, so five draws that have all but converged still carve the map
   * into confident coloured territories. Weighting by the margin over the
   * runner-up is what makes the figure say something — strong colour where a
   * draw genuinely owns the ground, neutral where the draws agree and the
   * winner is a coin toss.
   */
  marginFade = 0,
): TerrainGeometry {
  if (surfaces.length === 0) throw new Error('Need at least one surface to take a maximum of')
  assertGridResolution(resolution)

  const n = resolution
  const positions = new Float32Array(n * n * 3)
  const normals = new Float32Array(n * n * 3)
  const outColors = new Float32Array(n * n * 3)
  const heights01 = new Float32Array(n * n)

  const linear = colors.map((c) => hexToLinear01(c))
  const { xMin, xMax, yMin, yMax } = surfaces[0]!.domain

  for (let j = 0; j < n; j++) {
    const y = yMin + ((yMax - yMin) * j) / (n - 1)
    for (let i = 0; i < n; i++) {
      const x = xMin + ((xMax - xMin) * i) / (n - 1)
      const k = j * n + i

      let winner = 0
      let best = -Infinity
      let second = -Infinity
      for (let d = 0; d < surfaces.length; d++) {
        const h = surfaces[d]!.height(x, y)
        if (!Number.isFinite(h)) continue
        if (h > best) {
          second = best
          best = h
          winner = d
        } else if (h > second) {
          second = h
        }
      }
      if (!Number.isFinite(best)) best = transform.heightMin

      const p = transform.toWorld(x, y, best)
      positions[k * 3] = p.x
      positions[k * 3 + 1] = p.y
      positions[k * 3 + 2] = p.z

      // Normal from the winning surface only — averaging across draws would
      // smooth over exactly the ridges where one draw takes over from another.
      const g = surfaces[winner]!.gradient(x, y)
      const nv = transform.normalFromGradient({
        x: Number.isFinite(g.x) ? g.x : 0,
        y: Number.isFinite(g.y) ? g.y : 0,
      })
      normals[k * 3] = nv.x
      normals[k * 3 + 1] = nv.y
      normals[k * 3 + 2] = nv.z

      const t = Math.min(1, Math.max(0, transform.normalizeHeight(best)))
      heights01[k] = t
      const shade = 0.28 + 0.72 * t
      const c = linear[winner % linear.length]!

      let confidence = 1
      if (marginFade > 0 && Number.isFinite(second)) {
        const span = transform.heightMax - transform.heightMin
        confidence = Math.min(1, (best - second) / (span * marginFade))
      }
      // Toward the mid grey of the winning colour rather than to grey outright,
      // so a contested region still reads as terrain and not as a hole.
      const grey = (c[0] + c[1] + c[2]) / 3
      outColors[k * 3] = (grey + (c[0] - grey) * confidence) * shade
      outColors[k * 3 + 1] = (grey + (c[1] - grey) * confidence) * shade
      outColors[k * 3 + 2] = (grey + (c[2] - grey) * confidence) * shade
    }
  }

  return { positions, normals, colors: outColors, indices: buildGridIndices(n), heights01, resolution: n }
}

// ── trails ─────────────────────────────────────────────────────────────────

export interface TrailGeometry {
  readonly positions: Float32Array
  /**
   * Normalized time at which each point is reached, 0..1 across the whole run.
   * The material compares this against a single uniform, so revealing the trail
   * costs one uniform write per frame instead of rebuilding the buffer.
   */
  readonly progress: Float32Array
  readonly pointCount: number
}

/** World-space positions of a run, one per state. */
export function statesToWorld(
  states: readonly OptimizerState[],
  transform: SceneTransform,
): Vec3[] {
  return states.map((s) => transform.toWorld(s.position.x, s.position.y, s.value))
}

/**
 * One polyline through every hop of a run, built once up front.
 *
 * Consecutive hops share an endpoint exactly, so the trail has no seam. A
 * 500-step run at 16 samples is 8k points and a 40x100 genetic run is 64k —
 * both small enough that rebuilding per frame would be the only slow part, and
 * this avoids it entirely.
 */
export function buildTrailGeometry(
  points: readonly Vec3[],
  samplesPerHop = 16,
): TrailGeometry {
  if (points.length < 2) {
    return { positions: new Float32Array(0), progress: new Float32Array(0), pointCount: 0 }
  }

  const hops = points.length - 1
  const perHop = samplesPerHop + 1
  // Hops after the first drop their duplicated first point.
  const pointCount = perHop + (hops - 1) * samplesPerHop

  const positions = new Float32Array(pointCount * 3)
  const progress = new Float32Array(pointCount)

  let w = 0
  for (let h = 0; h < hops; h++) {
    const arc = hopArc(points[h]!, points[h + 1]!, samplesPerHop)
    for (let s = h === 0 ? 0 : 1; s < arc.length; s++) {
      const p = arc[s]!
      positions[w * 3] = p.x
      positions[w * 3 + 1] = p.y
      positions[w * 3 + 2] = p.z
      progress[w] = (h + s / samplesPerHop) / hops
      w++
    }
  }

  return { positions, progress, pointCount }
}

// ── gradient arrows ────────────────────────────────────────────────────────

export interface ArrowField {
  /** World position of each arrow's base. */
  readonly positions: Float32Array
  /** Yaw in radians, pointing uphill. */
  readonly headings: Float32Array
  /** Gradient magnitude normalized to 0..1 across the field. */
  readonly strengths: Float32Array
  readonly count: number
}

/**
 * Uphill arrows on a coarse grid, sitting on the terrain surface.
 *
 * Skips the domain edge: an arrow centred on the boundary is half off the mesh
 * and reads as a rendering glitch.
 */
export function buildArrowField(
  surface: Surface,
  transform: SceneTransform,
  resolution: number,
): ArrowField {
  if (!Number.isInteger(resolution) || resolution < 2) {
    throw new Error(`Arrow resolution must be an integer >= 2, got ${resolution}`)
  }

  const { xMin, xMax, yMin, yMax } = surface.domain
  const count = resolution * resolution
  const positions = new Float32Array(count * 3)
  const headings = new Float32Array(count)
  const strengths = new Float32Array(count)

  // Inset by half a cell so arrows sit inside their cells rather than on edges.
  const stepX = (xMax - xMin) / resolution
  const stepY = (yMax - yMin) / resolution

  let maxMagnitude = 0
  const magnitudes = new Float32Array(count)

  for (let j = 0; j < resolution; j++) {
    const y = yMin + stepY * (j + 0.5)
    for (let i = 0; i < resolution; i++) {
      const x = xMin + stepX * (i + 0.5)
      const k = j * resolution + i

      const h = surface.height(x, y)
      const p = transform.toWorld(x, y, Number.isFinite(h) ? h : transform.heightMin)
      positions[k * 3] = p.x
      positions[k * 3 + 1] = p.y
      positions[k * 3 + 2] = p.z

      const g = surface.gradient(x, y)
      const gx = Number.isFinite(g.x) ? g.x : 0
      const gy = Number.isFinite(g.y) ? g.y : 0

      // Domain +y is world -z, so the uphill heading flips sign on that axis —
      // the same convention SceneTransform uses.
      headings[k] = Math.atan2(gx, -gy)
      const m = Math.hypot(gx, gy)
      magnitudes[k] = m
      if (m > maxMagnitude) maxMagnitude = m
    }
  }

  // Normalize by a high quantile rather than the maximum: one near-vertical
  // cliff would otherwise flatten every other arrow to nothing.
  //
  // Then compress with a square root. Gradient magnitude has a far wider
  // dynamic range than a length can show — on Schwefel the boundary is orders
  // of magnitude steeper than the interior, so a linear mapping saturates the
  // edges into giant spikes while everything inside degenerates to slivers.
  // The root keeps the ordering and lifts the low end back into view.
  const sorted = Float32Array.from(magnitudes).sort()
  const reference = sorted[Math.floor(sorted.length * 0.9)] || maxMagnitude || 1
  for (let k = 0; k < count; k++) {
    strengths[k] = Math.sqrt(Math.min(1, magnitudes[k]! / reference))
  }

  return { positions, headings, strengths, count }
}
