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
}

export interface SceneTransform {
  readonly domain: Domain
  readonly heightMin: number
  readonly heightMax: number
  readonly verticalScale: number

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
    options.heightRange ?? pick(sampleHeightGrid(surface, options.probeResolution ?? 128))

  const { xMin, xMax, yMin, yMax } = surface.domain
  const halfX = (xMax - xMin) / 2
  const halfY = (yMax - yMin) / 2
  const centreX = (xMin + xMax) / 2
  const centreY = (yMin + yMax) / 2

  // A flat surface has no range to normalize against; treat it as mid-height.
  const span = range.max - range.min
  const flat = !(span > 0)

  const normalizeHeight = (h: number) => (flat ? 0.5 : (h - range.min) / span)
  const toWorldY = (h: number) => normalizeHeight(h) * verticalScale

  return {
    domain: surface.domain,
    heightMin: range.min,
    heightMax: range.max,
    verticalScale,
    normalizeHeight,
    toWorldY,

    toWorldXZ(x, y) {
      return { x: (x - centreX) / halfX, z: -(y - centreY) / halfY }
    },

    toWorld(x, y, height) {
      return { x: (x - centreX) / halfX, y: toWorldY(height), z: -(y - centreY) / halfY }
    },

    fromWorldXZ(worldX, worldZ) {
      return { x: worldX * halfX + centreX, y: -worldZ * halfY + centreY }
    },

    normalFromGradient(gradient) {
      if (flat) return { x: 0, y: 1, z: 0 }
      // Chain rule through the world mapping. dWorldY/dHeight = verticalScale /
      // span; dx/dWorldX = halfX; dy/dWorldZ = -halfY.
      const k = verticalScale / span
      const dydx = gradient.x * halfX * k
      const dydz = gradient.y * -halfY * k
      const len = Math.hypot(dydx, 1, dydz)
      return { x: -dydx / len, y: 1 / len, z: -dydz / len }
    },
  }
}

function pick(grid: HeightGrid): { min: number; max: number } {
  return { min: grid.min, max: grid.max }
}
