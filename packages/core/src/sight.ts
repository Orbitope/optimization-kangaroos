/**
 * What a searcher has actually sensed of the world.
 *
 * Pure numerics over a `Surface`, deliberately with no notion of pixels or
 * colour, because three different renderers want it: the 2D plan view fogs an
 * ImageData with it, the 3D terrain uploads it as a texture, and a readout
 * turns it into a percentage. Putting it in the core is what stops those three
 * disagreeing about what "seen" means.
 */

import type { Surface, Vec2 } from './surface.js'

export interface Coverage {
  /** Row-major, `size * size`, top row first — the raster convention, not the domain's. */
  readonly data: Float32Array
  readonly size: number
}

export interface SightOptions {
  /** Sight radius in domain units. */
  readonly radius: number
  /**
   * Fraction of the radius over which the edge softens.
   *
   * A hard circle reads as a stencil laid over a photograph. A soft edge reads
   * as the limit of what someone can make out, which is the claim being made.
   */
  readonly feather?: number
}

export function createCoverage(size: number): Coverage {
  if (!Number.isInteger(size) || size < 2) {
    throw new Error(`Coverage size must be an integer >= 2, got ${size}`)
  }
  return { data: new Float32Array(size * size), size }
}

export function clearCoverage(coverage: Coverage): void {
  coverage.data.fill(0)
}

/**
 * Reveal a disc around one position.
 *
 * Monotone by construction — coverage only ever increases, because she does not
 * forget a hillside on walking away from it. That is what makes this cheap
 * enough to animate: revealing one more position stamps a disc into an existing
 * buffer rather than recomputing a distance field over every point visited.
 */
export function stampCoverage(
  coverage: Coverage,
  surface: Surface,
  p: Vec2,
  options: SightOptions,
): void {
  const { data, size } = coverage
  const d = surface.domain
  const feather = options.feather ?? 0.45
  const spanX = d.xMax - d.xMin
  const spanY = d.yMax - d.yMin

  // Radius in cells along each axis, since the domain need not be square.
  const rx = (options.radius / spanX) * (size - 1)
  const ry = (options.radius / spanY) * (size - 1)
  const cx = ((p.x - d.xMin) / spanX) * (size - 1)
  // Row 0 is the domain's northern edge.
  const cy = (1 - (p.y - d.yMin) / spanY) * (size - 1)

  const i0 = Math.max(0, Math.floor(cx - rx))
  const i1 = Math.min(size - 1, Math.ceil(cx + rx))
  const j0 = Math.max(0, Math.floor(cy - ry))
  const j1 = Math.min(size - 1, Math.ceil(cy + ry))

  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      // Normalised elliptical distance, so the disc is a circle in *domain*
      // space even when the raster is not square.
      const dx = (i - cx) / (rx || 1)
      const dy = (j - cy) / (ry || 1)
      const r = Math.hypot(dx, dy)
      if (r > 1) continue
      const v = feather <= 0 ? 1 : Math.min(1, (1 - r) / feather)
      const k = j * size + i
      if (v > data[k]!) data[k] = v
    }
  }
}

/**
 * How much of the domain has been sensed, 0..1.
 *
 * The number that makes a fog figure quantitative rather than atmospheric, and
 * the honest counterweight to a search that looks busy: hundreds of hops inside
 * one basin can leave most of the world dark.
 */
export function coverageFraction(coverage: Coverage): number {
  let total = 0
  for (const v of coverage.data) total += v
  return total / coverage.data.length
}

/** Coverage as bytes, for upload as a texture. */
export function coverageToBytes(coverage: Coverage, out?: Uint8Array): Uint8Array {
  const bytes = out ?? new Uint8Array(coverage.data.length)
  for (let k = 0; k < coverage.data.length; k++) {
    bytes[k] = Math.round(Math.min(1, Math.max(0, coverage.data[k]!)) * 255)
  }
  return bytes
}
