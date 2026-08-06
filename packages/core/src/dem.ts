import type { Surface, Vec2 } from './surface.js'

/**
 * Real elevation data, as a `Surface`.
 *
 * Every widget in the piece takes a `Surface`, so the whole of the real-terrain
 * story is this file plus a bake script: nothing downstream learns that the
 * ground stopped being an equation.
 */

export interface GeoBounds {
  readonly west: number
  readonly east: number
  readonly south: number
  readonly north: number
}

export interface DemRaster {
  readonly name: string
  readonly width: number
  readonly height: number
  readonly bounds: GeoBounds
  /**
   * Elevations in metres, row-major, **row 0 is the northern edge**.
   *
   * That is the order raster tiles arrive in and the order every GIS tool
   * writes, so flipping on load would mean flipping back for every debug
   * dump. The flip lives in the sampler instead, where it is one subtraction.
   */
  readonly heights: Float32Array
  readonly minHeight: number
  readonly maxHeight: number
}

// ── the baked file format ──────────────────────────────────────────────────

const MAGIC = 0x4d45444b // "KDEM" little-endian
const VERSION = 1
const HEADER_BYTES = 48

/**
 * Parse a `.dem` produced by `tools/bake-dem.mjs`.
 *
 * A bespoke format rather than PNG or GeoTIFF, for one reason each: a PNG
 * would have to be decoded through a canvas, which does not exist in a test
 * runner, and GeoTIFF is a large dependency to read six rectangles of numbers.
 * This is a fixed 48-byte header and an Int16 array — elevations are stored to
 * the metre, which is four times finer than the ground sample distance of any
 * region baked here and still leaves 24 km of headroom over Everest.
 */
export function parseDemRaster(buffer: ArrayBuffer, name = 'terrain'): DemRaster {
  if (buffer.byteLength < HEADER_BYTES) throw new Error('DEM: file is shorter than its header')
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== MAGIC) throw new Error('DEM: bad magic')

  const version = view.getUint16(4, true)
  if (version !== VERSION) throw new Error(`DEM: version ${version}, expected ${VERSION}`)

  const width = view.getUint16(6, true)
  const height = view.getUint16(8, true)
  const bounds: GeoBounds = {
    west: view.getFloat64(16, true),
    south: view.getFloat64(24, true),
    east: view.getFloat64(32, true),
    north: view.getFloat64(40, true),
  }

  const count = width * height
  const expected = HEADER_BYTES + count * 2
  if (buffer.byteLength !== expected) {
    throw new Error(`DEM: ${buffer.byteLength} bytes, expected ${expected} for ${width}x${height}`)
  }

  const raw = new Int16Array(buffer, HEADER_BYTES, count)
  const heights = new Float32Array(count)
  let minHeight = Infinity
  let maxHeight = -Infinity
  for (let i = 0; i < count; i++) {
    const h = raw[i]!
    heights[i] = h
    if (h < minHeight) minHeight = h
    if (h > maxHeight) maxHeight = h
  }

  return { name, width, height, bounds, heights, minHeight, maxHeight }
}

/** The writer's half of the format. Used by the bake script and its tests. */
export function encodeDemRaster(raster: {
  readonly width: number
  readonly height: number
  readonly bounds: GeoBounds
  readonly heights: ArrayLike<number>
}): ArrayBuffer {
  const { width, height, bounds } = raster
  const count = width * height
  const buffer = new ArrayBuffer(HEADER_BYTES + count * 2)
  const view = new DataView(buffer)

  view.setUint32(0, MAGIC, true)
  view.setUint16(4, VERSION, true)
  view.setUint16(6, width, true)
  view.setUint16(8, height, true)
  view.setFloat64(16, bounds.west, true)
  view.setFloat64(24, bounds.south, true)
  view.setFloat64(32, bounds.east, true)
  view.setFloat64(40, bounds.north, true)

  const out = new Int16Array(buffer, HEADER_BYTES, count)
  for (let i = 0; i < count; i++) {
    // Clamped, not wrapped. Nothing on Earth is out of range, but a decode bug
    // upstream should produce a wrong flat value rather than an inverted spike.
    out[i] = Math.max(-32768, Math.min(32767, Math.round(raster.heights[i] ?? 0)))
  }
  return buffer
}

// ── geography ──────────────────────────────────────────────────────────────

const METRES_PER_DEGREE_LAT = 110574

/**
 * Metres per degree of longitude at a latitude.
 *
 * The kangaroo hops in metres, not degrees, and a degree of longitude is 111 km
 * at the equator and 90 km at K2. Ignoring that would make every region a
 * different distorted aspect ratio and make "she hopped 400 m east" mean
 * something different in each one.
 */
function metresPerDegreeLon(latitudeDegrees: number): number {
  return 111320 * Math.cos((latitudeDegrees * Math.PI) / 180)
}

export interface DemSurfaceOptions {
  /**
   * Radius, in samples, of the blur applied before differencing.
   *
   * Prechelt's teflon is not a flourish — it is load-bearing. He plates the
   * ditch so that "all small valleys or hills the ditch may have had are
   * averaged out", and a real DEM is nothing but small valleys and hills. Raw
   * central differences on unsmoothed elevation give a gradient dominated by
   * one-pixel noise, and a gradient ascent driven by it staggers rather than
   * climbs. This is the teflon, and its radius is how thick the plating is.
   *
   * 0 differences the raw data, which is worth having for the figure that
   * shows why you would not.
   */
  readonly smoothing?: number
  /** Override the reported summit, e.g. to name a published one. */
  readonly globalOptimum?: { readonly x: number; readonly y: number; readonly height: number }
}

/**
 * Wrap a raster as a `Surface`.
 *
 * The domain is metres east and north of the region's centre, so a step size
 * means the same thing here as it would on a map. The analytic surfaces span
 * ±5 to ±600 and the optimizers already scale their defaults off the domain
 * diagonal, so a domain measured in tens of kilometres needs no special case.
 */
export function createDemSurface(raster: DemRaster, options: DemSurfaceOptions = {}): Surface {
  const { width, height, bounds } = raster
  const centreLat = (bounds.north + bounds.south) / 2

  const spanX = (bounds.east - bounds.west) * metresPerDegreeLon(centreLat)
  const spanY = (bounds.north - bounds.south) * METRES_PER_DEGREE_LAT
  const domain = { xMin: -spanX / 2, xMax: spanX / 2, yMin: -spanY / 2, yMax: spanY / 2 }

  const metresPerSampleX = spanX / Math.max(1, width - 1)
  const metresPerSampleY = spanY / Math.max(1, height - 1)

  const smoothing = options.smoothing ?? 1.5
  const smoothed = smoothing > 0 ? blur(raster.heights, width, height, smoothing) : raster.heights

  /** Domain metres to fractional sample coordinates. Row 0 is north. */
  const toSample = (x: number, y: number) => ({
    col: ((x - domain.xMin) / spanX) * (width - 1),
    row: ((domain.yMax - y) / spanY) * (height - 1),
  })

  const heightAt = (x: number, y: number) => {
    const { col, row } = toSample(x, y)
    return bicubic(raster.heights, width, height, col, row)
  }

  const gradientAt = (x: number, y: number): Vec2 => {
    const { col, row } = toSample(x, y)
    // Central differences one whole sample apart, on the smoothed copy. A
    // smaller step would just re-introduce the interpolant's own wiggle, which
    // is precisely what the smoothing was for.
    const east = bicubic(smoothed, width, height, col + 1, row)
    const west = bicubic(smoothed, width, height, col - 1, row)
    const south = bicubic(smoothed, width, height, col, row + 1)
    const north = bicubic(smoothed, width, height, col, row - 1)
    return {
      x: (east - west) / (2 * metresPerSampleX),
      // Row increases southward, so north minus south is the northward slope.
      y: (north - south) / (2 * metresPerSampleY),
    }
  }

  let optimum = options.globalOptimum
  if (!optimum) {
    let best = -Infinity
    let bestIndex = 0
    for (let i = 0; i < raster.heights.length; i++) {
      if (raster.heights[i]! > best) {
        best = raster.heights[i]!
        bestIndex = i
      }
    }
    const col = bestIndex % width
    const row = Math.floor(bestIndex / width)
    optimum = {
      x: domain.xMin + (col / Math.max(1, width - 1)) * spanX,
      y: domain.yMax - (row / Math.max(1, height - 1)) * spanY,
      height: best,
    }
  }

  return {
    name: raster.name,
    domain,
    height: heightAt,
    gradient: gradientAt,
    globalOptimum: optimum,
    // Real terrain is the only place this means anything, and the drowning
    // set-piece needs it. Terrarium's ocean floor is genuine bathymetry, so
    // below zero is water rather than missing data.
    seaLevel: 0,
  }
}

/**
 * How much to exaggerate a region's relief when rendering it.
 *
 * Vertical exaggeration is unavoidable and the analytic surfaces get away with
 * a constant, because they all have roughly the same shape. Real regions do
 * not: the Everest box is 20 km across with 4.3 km of relief, which is a true
 * aspect of 0.22, and Australia is 4166 km across with 9 km of relief, which is
 * 0.002. Rendering both at the scene default of 0.35 exaggerates one by 1.6×
 * and the other by 160× — and the second looks like it, a continent rendered as
 * a field of spikes.
 *
 * Using the true aspect instead swings the other way: at 0.002 the Himalaya
 * from 1500 km away is a wrinkle, which is *correct* and useless, since the
 * whole reason the figure exists is that Everest and K2 are two summits in one
 * landscape.
 *
 * So: the square root. Exaggeration grows as terrain flattens, but sub-
 * linearly, so a plain still reads as flatter than a mountain range rather
 * than every region being normalised to the same drama. The floor keeps a
 * genuinely flat continent visible; the ceiling keeps a steep box from
 * becoming a spike.
 */
export function suggestVerticalScale(raster: DemRaster): number {
  const centreLat = (raster.bounds.north + raster.bounds.south) / 2
  const spanX = (raster.bounds.east - raster.bounds.west) * metresPerDegreeLon(centreLat)
  const relief = raster.maxHeight - raster.minHeight
  if (!(spanX > 0) || !(relief > 0)) return 0.35
  const trueAspect = relief / spanX
  return Math.min(0.4, Math.max(0.12, Math.sqrt(trueAspect) * 0.6))
}

// ── sampling ───────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Nearest in-bounds sample. Edges extend rather than wrap. */
function at(data: ArrayLike<number>, width: number, height: number, col: number, row: number) {
  return data[clamp(row, 0, height - 1) * width + clamp(col, 0, width - 1)]!
}

/**
 * Catmull-Rom in one dimension.
 *
 * Bicubic rather than bilinear because the gradient is what the terrain is for.
 * Bilinear interpolation is C0: its derivative jumps at every sample boundary,
 * so a kangaroo walking a straight line across a bilinear DEM feels the slope
 * change in discrete steps and a gradient ascent visibly stair-steps. Catmull-
 * Rom is C1, which costs sixteen taps instead of four and removes the artefact
 * completely.
 */
function cubic(a: number, b: number, c: number, d: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return (
    0.5 *
    (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
  )
}

function bicubic(
  data: ArrayLike<number>,
  width: number,
  height: number,
  col: number,
  row: number,
): number {
  const c0 = Math.floor(col)
  const r0 = Math.floor(row)
  const tx = col - c0
  const ty = row - r0

  const rows: number[] = []
  for (let j = -1; j <= 2; j++) {
    rows.push(
      cubic(
        at(data, width, height, c0 - 1, r0 + j),
        at(data, width, height, c0, r0 + j),
        at(data, width, height, c0 + 1, r0 + j),
        at(data, width, height, c0 + 2, r0 + j),
        tx,
      ),
    )
  }
  return cubic(rows[0]!, rows[1]!, rows[2]!, rows[3]!, ty)
}

/**
 * Separable Gaussian blur, edges clamped.
 *
 * Separable because a radius-5 kernel is 11 taps per axis instead of 121, and
 * the smoothed copy is built once per surface rather than per sample — but a
 * 512×512 region at radius 5 is still 11 million multiplies the naive way, and
 * that is long enough to notice on a page load.
 */
export function blur(
  data: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const taps = Math.max(1, Math.ceil(radius * 2))
  const sigma = radius
  const kernel = new Float32Array(taps * 2 + 1)
  let sum = 0
  for (let i = -taps; i <= taps; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma))
    kernel[i + taps] = w
    sum += w
  }
  for (let i = 0; i < kernel.length; i++) kernel[i]! /= sum

  const pass1 = new Float32Array(data.length)
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      let acc = 0
      for (let i = -taps; i <= taps; i++) {
        acc += kernel[i + taps]! * data[r * width + clamp(c + i, 0, width - 1)]!
      }
      pass1[r * width + c] = acc
    }
  }

  const out = new Float32Array(data.length)
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      let acc = 0
      for (let i = -taps; i <= taps; i++) {
        acc += kernel[i + taps]! * pass1[clamp(r + i, 0, height - 1) * width + c]!
      }
      out[r * width + c] = acc
    }
  }
  return out
}
