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
import type { Coverage, Surface, Vec2 } from '@kangaroos/core'

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
 * `size` is the *longer* side; the shorter one follows the domain's aspect
 * ratio, so a rectangular region comes out rectangular. Every analytic surface
 * here is square, which is why this took until a whole-Earth region — 40,000 km
 * by 18,800 km — to matter. The 3D transform had the same bug.
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
  const spanX = d.xMax - d.xMin
  const spanY = d.yMax - d.yMin
  const longest = Math.max(spanX, spanY)
  const width = spanX >= spanY ? size : Math.max(2, Math.round((size * spanX) / longest))
  const height = spanY >= spanX ? size : Math.max(2, Math.round((size * spanY) / longest))

  const heights = new Float64Array(width * height)
  let min = Infinity
  let max = -Infinity

  for (let j = 0; j < height; j++) {
    // Image rows run top to bottom; domain y runs bottom to top, so north is up.
    const y = d.yMax - (spanY * j) / (height - 1)
    for (let i = 0; i < width; i++) {
      const x = d.xMin + (spanX * i) / (width - 1)
      const h = surface.height(x, y)
      heights[j * width + i] = Number.isFinite(h) ? h : 0
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

  const image = createImageData(width, height)
  for (let k = 0; k < width * height; k++) {
    const t = Math.min(1, Math.max(0, (heights[k]! - floor) / (max - floor || 1)))
    const [r, g, b] = lut[Math.min(255, Math.round(t * 255))]!
    image.data[k * 4] = r
    image.data[k * 4 + 1] = g
    image.data[k * 4 + 2] = b
    image.data[k * 4 + 3] = 255
  }

  return { width, height, image, heights, min, max, floor }
}

export interface Viewport {
  readonly x: number
  readonly y: number
  /**
   * On-screen size of the plate. A square plate can give one number; a region
   * that is not square has to give both or the marks drift off the terrain
   * they are meant to be standing on.
   */
  readonly size?: number
  readonly width?: number
  readonly height?: number
}

/** Domain point to pixel, with north up. */
export function toPlanPixel(surface: Surface, p: Vec2, view: Viewport): { x: number; y: number } {
  const d = surface.domain
  const w = view.width ?? view.size ?? 0
  const h = view.height ?? view.size ?? 0
  return {
    x: view.x + ((p.x - d.xMin) / (d.xMax - d.xMin)) * w,
    y: view.y + (1 - (p.y - d.yMin) / (d.yMax - d.yMin)) * h,
  }
}

// ── fog of war ─────────────────────────────────────────────────────────────

/**
 * Darken an already-rasterised surface wherever coverage is low.
 *
 * Applied to a copy of the terrain image rather than drawn as an overlay
 * rectangle: an alpha overlay would also dim the marks drawn on top, and the
 * path and the current position have to stay at full strength — they are the
 * record of what she *does* know.
 *
 * The coverage itself lives in the core, so the 2D plate and the 3D terrain
 * cannot drift apart about what counts as seen.
 */
export function applyFog(
  target: ImageData,
  source: ImageData,
  coverage: Coverage,
  options: { readonly strength?: number } = {},
): void {
  const strength = options.strength ?? 1
  const [ur, ug, ub] = hexToRgb01(CKColor.void).map((c) => c * 255)

  for (let k = 0; k < coverage.data.length; k++) {
    const hidden = (1 - coverage.data[k]!) * strength
    target.data[k * 4] = source.data[k * 4]! * (1 - hidden) + ur! * hidden
    target.data[k * 4 + 1] = source.data[k * 4 + 1]! * (1 - hidden) + ug! * hidden
    target.data[k * 4 + 2] = source.data[k * 4 + 2]! * (1 - hidden) + ub! * hidden
    target.data[k * 4 + 3] = 255
  }
}
