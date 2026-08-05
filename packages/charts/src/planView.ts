/**
 * The landscape from directly above, and what a searcher has seen of it.
 *
 * The plan view answers a different question from the 3D scene. In three
 * dimensions the reading is "how high did she get"; from above it is "where did
 * she choose to stand, and how much of the map did she touch". Coverage is a
 * question about area, and a perspective camera turns it into a question about
 * foreshortening — the far half of the domain occupies a third of the frame, so
 * a run that neglected it looks thorough.
 *
 * It is also where fog of war belongs. Every figure in the article shows the
 * reader a landscape the kangaroo cannot see, which is stated in the prose and
 * contradicted by every picture. Masking the terrain to what she has actually
 * sensed is the only way to show her side of it, and from above the mask is
 * simply a shape rather than a volumetric effect.
 */

import { CKColor, elevationLut, hexToRgb01 } from '@contentkit/tokens'
import type { Surface, Vec2 } from '@kangaroos/core'

export interface PlanRaster {
  readonly width: number
  readonly height: number
  readonly image: ImageData
  /** Altitude at each pixel, row-major, top row first. */
  readonly heights: Float64Array
  readonly min: number
  readonly max: number
  /** The value mapped to the bottom of the ramp. */
  readonly floor: number
}

export interface PlanRasterOptions {
  readonly ramp?: string
  /**
   * Quantile mapped to the bottom of the colour ramp.
   *
   * Not zero, and this is the same problem the 3D terrain has. Himmelblau
   * plunges to -890 in one corner while every summit sits at 0, so a linear map
   * puts the entire interesting range in the top 3% of the ramp and the plate
   * reads as one flat colour with a dark corner. Clipping the tail spends the
   * ramp on the part anybody is looking at.
   */
  readonly floorQuantile?: number
}

/**
 * Rasterise a surface to an ImageData, ready to blit.
 *
 * Expensive enough to be worth memoising per surface — a 300x300 plate is 90k
 * height evaluations — and completely static once built, so an animated figure
 * builds it once and then only draws marks.
 */
export function rasteriseSurface(
  surface: Surface,
  size: number,
  createImageData: (w: number, h: number) => ImageData,
  options: PlanRasterOptions = {},
): PlanRaster {
  if (!Number.isInteger(size) || size < 2) {
    throw new Error(`Raster size must be an integer >= 2, got ${size}`)
  }

  const d = surface.domain
  const heights = new Float64Array(size * size)
  let min = Infinity
  let max = -Infinity

  for (let j = 0; j < size; j++) {
    // Image rows run top to bottom; domain y runs bottom to top, so north is up.
    const y = d.yMax - ((d.yMax - d.yMin) * j) / (size - 1)
    for (let i = 0; i < size; i++) {
      const x = d.xMin + ((d.xMax - d.xMin) * i) / (size - 1)
      const h = surface.height(x, y)
      heights[j * size + i] = Number.isFinite(h) ? h : 0
      if (h < min) min = h
      if (h > max) max = h
    }
  }

  const sorted = Float64Array.from(heights).sort()
  const q = options.floorQuantile ?? 0.35
  const floor = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!

  const lut = elevationLut(256, options.ramp).map((hex) => {
    const [r, g, b] = hexToRgb01(hex)
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)] as const
  })

  const image = createImageData(size, size)
  for (let k = 0; k < size * size; k++) {
    const t = Math.min(1, Math.max(0, (heights[k]! - floor) / (max - floor || 1)))
    const [r, g, b] = lut[Math.min(255, Math.round(t * 255))]!
    image.data[k * 4] = r
    image.data[k * 4 + 1] = g
    image.data[k * 4 + 2] = b
    image.data[k * 4 + 3] = 255
  }

  return { width: size, height: size, image, heights, min, max, floor }
}

export interface Viewport {
  readonly x: number
  readonly y: number
  readonly size: number
}

/** Domain point to pixel, with north up. */
export function toPlanPixel(surface: Surface, p: Vec2, view: Viewport): { x: number; y: number } {
  const d = surface.domain
  return {
    x: view.x + ((p.x - d.xMin) / (d.xMax - d.xMin)) * view.size,
    y: view.y + (1 - (p.y - d.yMin) / (d.yMax - d.yMin)) * view.size,
  }
}

// ── fog of war ─────────────────────────────────────────────────────────────

export interface FogOptions {
  /** Sight radius in domain units. */
  readonly radius: number
  /**
   * Fraction of the radius over which the edge softens.
   *
   * A hard circle reads as a stencil laid over a photograph. A soft edge reads
   * as the limit of what someone can make out, which is the claim being made.
   */
  readonly feather?: number
  /** How dark unseen ground goes, 0..1. 1 is fully hidden. */
  readonly strength?: number
}

/**
 * Coverage accumulated over a run: 0 never seen, 1 fully revealed.
 *
 * Monotone by construction — coverage only ever increases, because she does not
 * forget a hillside on walking away from it. That is what makes this cheap
 * enough to animate: revealing one more position stamps a disc into an existing
 * buffer rather than recomputing a distance field over every visited point.
 */
export function stampCoverage(
  coverage: Float32Array,
  size: number,
  surface: Surface,
  p: Vec2,
  options: FogOptions,
): void {
  const d = surface.domain
  const feather = options.feather ?? 0.45
  const spanX = d.xMax - d.xMin
  const spanY = d.yMax - d.yMin

  // Radius in pixels along each axis, since the domain need not be square.
  const rx = (options.radius / spanX) * (size - 1)
  const ry = (options.radius / spanY) * (size - 1)
  const cx = ((p.x - d.xMin) / spanX) * (size - 1)
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
      if (v > coverage[k]!) coverage[k] = v
    }
  }
}

/**
 * Darken an already-blitted raster wherever coverage is low.
 *
 * Applied to a copy of the terrain image rather than drawn as an overlay
 * rectangle: an alpha overlay would also dim the marks drawn on top, and the
 * cairns and the path have to stay at full strength — they are the record of
 * what she *does* know.
 */
export function applyFog(
  target: ImageData,
  source: ImageData,
  coverage: Float32Array,
  options: FogOptions,
): void {
  const strength = options.strength ?? 1
  const [ur, ug, ub] = hexToRgb01(CKColor.void).map((c) => c * 255)

  for (let k = 0; k < coverage.length; k++) {
    const seen = coverage[k]!
    const hidden = (1 - seen) * strength
    target.data[k * 4] = source.data[k * 4]! * (1 - hidden) + ur! * hidden
    target.data[k * 4 + 1] = source.data[k * 4 + 1]! * (1 - hidden) + ug! * hidden
    target.data[k * 4 + 2] = source.data[k * 4 + 2]! * (1 - hidden) + ub! * hidden
    target.data[k * 4 + 3] = 255
  }
}

/**
 * Coverage as a fraction of the domain — how much of the map she has seen.
 *
 * The number that makes a fog figure quantitative rather than atmospheric, and
 * the honest counterweight to a search that looks busy: five hundred hops
 * inside one basin can leave ninety per cent of the world dark.
 */
export function coverageFraction(coverage: Float32Array): number {
  let total = 0
  for (const v of coverage) total += v
  return total / coverage.length
}
