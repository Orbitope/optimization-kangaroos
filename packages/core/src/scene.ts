/**
 * Turning a `Surface` into something renderable.
 *
 * Domains here span [-5, 5] to [-600, 600] and altitude ranges span about 22
 * to about 1900, so nothing can be drawn in its own units — a camera framed for
 * Himmelblau would lose Griewank entirely. Everything is normalized into a
 * canonical world box first.
 *
 * World convention matches Three.js: +Y is up, the domain lies in the XZ plane
 * mapped to [-1, 1] on both axes. Domain +y maps to world **-z** so that north
 * reads as up under a top-down camera, which the compass metaphor in the email
 * depends on.
 */

import type { Domain, Surface, Vec2 } from './surface.js'
import type { Vec3 } from './hop.js'

export interface HeightGrid {
  readonly resolution: number
  /** Row-major, `heights[j * resolution + i]`, i along x and j along y. */
  readonly heights: Float32Array
  readonly min: number
  readonly max: number
}

export interface GradientGrid {
  readonly resolution: number
  readonly gx: Float32Array
  readonly gy: Float32Array
  readonly maxMagnitude: number
}

function axisValue(lo: number, hi: number, i: number, n: number): number {
  return n === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * i) / (n - 1)
}

function assertResolution(n: number): void {
  if (!Number.isInteger(n) || n < 2) {
    throw new Error(`Grid resolution must be an integer >= 2, got ${n}`)
  }
}

/**
 * Sample altitude on a regular grid.
 *
 * Non-finite samples are recorded as NaN but excluded from min/max, so one bad
 * point cannot collapse the whole colour ramp — the classic way a single
 * out-of-domain evaluation turns an entire terrain flat grey.
 */
export function sampleHeightGrid(surface: Surface, resolution: number): HeightGrid {
  assertResolution(resolution)
  const { xMin, xMax, yMin, yMax } = surface.domain
  const heights = new Float32Array(resolution * resolution)

  let min = Infinity
  let max = -Infinity

  for (let j = 0; j < resolution; j++) {
    const y = axisValue(yMin, yMax, j, resolution)
    for (let i = 0; i < resolution; i++) {
      const x = axisValue(xMin, xMax, i, resolution)
      const h = surface.height(x, y)
      heights[j * resolution + i] = h
      if (Number.isFinite(h)) {
        if (h < min) min = h
        if (h > max) max = h
      }
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error(`${surface.name} produced no finite samples at resolution ${resolution}`)
  }
  return { resolution, heights, min, max }
}

/** Sample the gradient field on a regular grid, for the arrow layer. */
export function sampleGradientGrid(surface: Surface, resolution: number): GradientGrid {
  assertResolution(resolution)
  const { xMin, xMax, yMin, yMax } = surface.domain
  const gx = new Float32Array(resolution * resolution)
  const gy = new Float32Array(resolution * resolution)
  let maxMagnitude = 0

  for (let j = 0; j < resolution; j++) {
    const y = axisValue(yMin, yMax, j, resolution)
    for (let i = 0; i < resolution; i++) {
      const x = axisValue(xMin, xMax, i, resolution)
      const g = surface.gradient(x, y)
      const ok = Number.isFinite(g.x) && Number.isFinite(g.y)
      const vx = ok ? g.x : 0
      const vy = ok ? g.y : 0
      gx[j * resolution + i] = vx
      gy[j * resolution + i] = vy
      const m = Math.hypot(vx, vy)
      if (m > maxMagnitude) maxMagnitude = m
    }
  }

  return { resolution, gx, gy, maxMagnitude }
}

// ── world transform ────────────────────────────────────────────────────────

export interface SceneTransformOptions {
  /**
   * World height of the full altitude range, against a horizontal extent of 2.
   *
   * Exaggeration is not optional. Everest at true aspect across a thousand
   * kilometres of Asia is an imperceptible bump, and the analytic surfaces are
   * no better behaved.
   */
  readonly verticalScale?: number
  /** Override the measured altitude range, e.g. to hold it fixed across runs. */
  readonly heightRange?: { readonly min: number; readonly max: number }
  /** Grid resolution used to measure the altitude range. */
  readonly probeResolution?: number
  /**
   * Quantile used as the floor instead of the true minimum.
   *
   * Without this the deepest corner sets the scale and flattens everything
   * worth looking at. Himmelblau bottoms out near -890 while its four maxima
   * all sit at 0, so a true-minimum mapping gives the peaks 2.4% of the
   * vertical range and the surface renders as one smooth dome.
   *
   * Clamping the bottom is also the honest reading of the metaphor: below a
   * certain depth it is all ocean floor, and the kangaroo has drowned either
   * way. Set to 0 for a literal minimum.
   */
  readonly heightFloorQuantile?: number
}

export interface SceneTransform {
  readonly domain: Domain
  readonly heightMin: number
  readonly heightMax: number
  readonly verticalScale: number
  /**
   * World half-extents in X and Z. The longer axis is always 1; the shorter is
   * the domain's aspect ratio.
   *
   * Present because the scene has to know the shape of the ground it is
   * drawing. Anything that framed, textured or bounded the terrain by assuming
   * a unit square — the camera solve and the fog UVs both did — needs these
   * instead.
   */
  readonly halfExtentX: number
  readonly halfExtentZ: number

  /** Domain point plus altitude to a world position. */
  toWorld(x: number, y: number, height: number): Vec3
  /** Domain point to world XZ, ignoring altitude. */
  toWorldXZ(x: number, y: number): { readonly x: number; readonly z: number }
  /** Altitude to world Y. */
  toWorldY(height: number): number
  /** World XZ back to a domain point. */
  fromWorldXZ(worldX: number, worldZ: number): Vec2
  /** Altitude normalized to 0..1 across the measured range. */
  normalizeHeight(height: number): number
  /**
   * Surface normal in world space, from a domain-space gradient.
   *
   * Derived from the analytic gradients rather than averaged from adjacent
   * faces. It is better shading and it is free — the exact derivatives already
   * exist, so `computeVertexNormals()` would be throwing away information and
   * spending time to do it.
   */
  normalFromGradient(gradient: Vec2): Vec3
}

export function createSceneTransform(
  surface: Surface,
  options: SceneTransformOptions = {},
): SceneTransform {
  const verticalScale = options.verticalScale ?? 0.35
  const range =
    options.heightRange ??
    measureRange(
      sampleHeightGrid(surface, options.probeResolution ?? 128),
      options.heightFloorQuantile ?? 0.05,
    )

  const { xMin, xMax, yMin, yMax } = surface.domain
  const halfX = (xMax - xMin) / 2
  const halfY = (yMax - yMin) / 2
  const centreX = (xMin + xMax) / 2
  const centreY = (yMin + yMax) / 2

  /*
   * One scale for both horizontal axes, so a rectangular domain renders as a
   * rectangle.
   *
   * The first version divided X by halfX and Y by halfY, which maps *any*
   * domain onto the unit square. Every analytic surface here is square, so it
   * was invisible — and then real terrain arrived. A whole-Earth region is
   * 40,000 km by 18,800 km, and squashing that to a square makes the Pacific
   * as tall as it is wide. The already-baked Himalaya and Australia regions
   * were being squeezed by about 10% and nobody noticed either.
   *
   * Dividing both by the larger half-extent keeps the longer axis spanning
   * [-1, 1] — so `verticalScale` still means what its docstring says — and
   * lets the shorter one come out proportionally short.
   */
  const half = Math.max(halfX, halfY)
  const halfExtentX = halfX / half
  const halfExtentZ = halfY / half

  // A flat surface has no range to normalize against; treat it as mid-height.
  const span = range.max - range.min
  const flat = !(span > 0)

  // Clamped, because the floor is a quantile: anything below it is drawn at
  // the same depth rather than pushed out through the bottom of the world box.
  const normalizeHeight = (h: number) =>
    flat ? 0.5 : Math.min(1, Math.max(0, (h - range.min) / span))
  const toWorldY = (h: number) => normalizeHeight(h) * verticalScale

  return {
    domain: surface.domain,
    heightMin: range.min,
    heightMax: range.max,
    verticalScale,
    halfExtentX,
    halfExtentZ,
    normalizeHeight,
    toWorldY,

    toWorldXZ(x, y) {
      return { x: (x - centreX) / half, z: -(y - centreY) / half }
    },

    toWorld(x, y, height) {
      return { x: (x - centreX) / half, y: toWorldY(height), z: -(y - centreY) / half }
    },

    fromWorldXZ(worldX, worldZ) {
      return { x: worldX * half + centreX, y: -worldZ * half + centreY }
    },

    normalFromGradient(gradient) {
      if (flat) return { x: 0, y: 1, z: 0 }
      // Chain rule through the world mapping. dWorldY/dHeight = verticalScale /
      // span, and both horizontal axes share one scale, so dx/dWorldX = half
      // and dy/dWorldZ = -half.
      const k = verticalScale / span
      const dydx = gradient.x * half * k
      const dydz = gradient.y * -half * k
      const len = Math.hypot(dydx, 1, dydz)
      return { x: -dydx / len, y: 1 / len, z: -dydz / len }
    },
  }
}

/** Altitude range with its floor pulled up to a quantile of the samples. */
function measureRange(grid: HeightGrid, floorQuantile: number): { min: number; max: number } {
  if (!(floorQuantile > 0)) return { min: grid.min, max: grid.max }

  const finite = Array.from(grid.heights).filter(Number.isFinite)
  finite.sort((a, b) => a - b)
  const floor = finite[Math.floor(Math.min(1, floorQuantile) * (finite.length - 1))] ?? grid.min

  // A floor at or above the summit would collapse the range entirely.
  return { min: floor < grid.max ? floor : grid.min, max: grid.max }
}
