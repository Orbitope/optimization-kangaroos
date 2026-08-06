/**
 * Bake fixed regions of real elevation into `apps/article/public/terrain/`.
 *
 *   node tools/bake-dem.mjs            # all regions
 *   node tools/bake-dem.mjs everest    # just one
 *
 * Bake, do not fetch. A live tile request is a trap for a piece meant to last
 * a decade: the bucket outlives most things but the article should not depend
 * on it being up, on the reader having network beyond the page itself, or on a
 * hundred round trips before the first frame. The output is committed.
 *
 * Each region is a 256×256 Int16 raster — 128 KB, which at these spans is 4×
 * finer than anything the 192×192 terrain mesh can show, and only loaded when a
 * figure asks for that region.
 */
import { mkdirSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { encodeDemRaster } from '../packages/core/dist/dem.js'
import { metresPerPixel, sampleRegion } from './dem/tiles.mjs'

const OUT = new URL('../apps/article/public/terrain/', import.meta.url).pathname

/**
 * Output grid, per region. 256 is 128 KB and is four times finer than
 * anything the 192x192 terrain mesh can show, which is right for a region a
 * few tens of kilometres across.
 *
 * The world is the exception and gets 512. Not for the render — the mesh
 * cannot use it either — but for the *search*: the whole point of that figure
 * is whether a kangaroo lands on the highest ground on Earth, and how sharp
 * that needle is depends entirely on how finely the planet is sampled.
 */
const SIZE = 256

/**
 * A box around a point, sized in kilometres so the intent is legible.
 *
 * Longitude is divided by cos(lat) so the box comes out square on the ground
 * rather than square in degrees — at K2 that is a 26% difference, and a region
 * that is secretly 4:3 would render as a stretched landscape.
 */
function boxAround(lat, lon, km) {
  const dLat = km / 2 / 110.574
  const dLon = km / 2 / (111.32 * Math.cos((lat * Math.PI) / 180))
  return { west: lon - dLon, east: lon + dLon, south: lat - dLat, north: lat + dLat }
}

/**
 * Zoom is chosen so the tile grid is at least as fine as the output grid.
 * Going finer wastes bandwidth on detail the resample throws away; going
 * coarser means interpolating data that is not there and calling it terrain.
 */
const REGIONS = [
  {
    name: 'everest',
    title: 'Everest',
    bounds: boxAround(27.9881, 86.925, 20),
    zoom: 12,
    /*
     * Everest's surveyed height is 8849 m and this data caps it at about
     * 8750, and that gap is not a resampling artefact — it holds at 78, 52 and
     * 47 m per sample, and at two source zooms. It is the data: terrarium is
     * built from SRTM and friends, radar sounding a snow-capped pyramid from
     * orbit, and the surveyed figure comes from people standing on it with
     * GNSS receivers. A raster also cannot represent a peak it does not have a
     * sample on, so a sampled summit is always low.
     *
     * Worth stating in the prose rather than papering over, because it is the
     * article's own thesis arriving early: the map is not the terrain, and the
     * kangaroo can only ever climb the map.
     */
    expect: { label: 'Everest', metres: 8849, tolerance: 150 },
  },
  {
    name: 'k2',
    title: 'K2',
    bounds: boxAround(35.8808, 76.5133, 20),
    zoom: 12,
    // Same shortfall as Everest, same reason.
    expect: { label: 'K2', metres: 8611, tolerance: 150 },
  },
  {
    // Wide enough to hold both, which is the shot the article's opening quote
    // wants: Everest and K2 are 1300 km apart and the point is that they are
    // two summits in one landscape.
    name: 'himalaya',
    title: 'The Himalaya and the Karakoram',
    bounds: { west: 74, east: 89.5, south: 26, north: 37.5 },
    zoom: 7,
    /*
     * 7300 m, not 8849. At 5.7 km per sample an 8.8 km peak two kilometres
     * across simply is not in the raster — the nearest samples straddle it and
     * both sit on the shoulders. This is not a defect to tune away; it is why
     * `everest` and `k2` exist as separate close-ups, and it is the sampling
     * lesson again: the same mountain is a different height depending on how
     * often you look.
     */
    expect: { label: 'the highest ground', metres: 7300, tolerance: 600 },
  },
  {
    name: 'chapel-hill',
    title: 'Chapel Hill, North Carolina',
    bounds: boxAround(35.9132, -79.0558, 24),
    zoom: 12,
    /*
     * Sarle's bad local optimum, and the joke only lands if the number is
     * right — so this one is checked at the town rather than at the highest
     * point in the box, which are two different claims. Chapel Hill sits at
     * about 150 m; the ridges a few kilometres out reach 240.
     */
    expect: { label: 'Chapel Hill itself', metres: 150, tolerance: 40, at: { lat: 35.9132, lon: -79.0558 } },
  },
  {
    name: 'australia',
    title: 'Australia',
    bounds: { west: 112, east: 154, south: -44, north: -10 },
    zoom: 6,
    // Kosciuszko, 2228 m. The whole continent, and that is the highest thing
    // on it — which is the closing joke, stated as data.
    expect: { label: 'Kosciuszko', metres: 2228, tolerance: 250 },
  },
  {
    /*
     * The whole planet, equirectangular. Web Mercator cannot represent beyond
     * about 85 degrees, which costs the last few degrees around each pole —
     * the South Pole itself is outside the data. Most of the East Antarctic
     * plateau is inside it, which is what matters here, because at fast
     * cooling that plateau is the single most common place a search stops.
     */
    name: 'world',
    title: 'Earth',
    bounds: { west: -180, east: 180, south: -85, north: 85 },
    zoom: 4,
    size: 512,
    /*
     * 6100 m, and not Everest. At 78 km per sample the Himalaya is a handful
     * of pixels and its 8849 m summit averages down to about six kilometres —
     * which is the same lesson as the Everest close-up, one more zoom level
     * out, and the reason the highest sample sits in the Karakoram rather than
     * on any named peak.
     */
    expect: { label: 'the highest ground on Earth', metres: 6100, tolerance: 400 },
  },
  {
    name: 'indian-ocean',
    title: 'The Indian Ocean',
    /*
     * Deliberately inside the open ocean rather than a tidy lat/lon box: the
     * first attempt reached to 8°N and caught the Indian and Somali coasts, so
     * the "everything here is underwater" claim was false by 2100 m. These
     * bounds are open water apart from the Chagos atolls, which is why the
     * check below is a fraction rather than an absolute — Diego Garcia is a
     * real place and averaging it out of the raster to make a rounder claim
     * would be the wrong kind of tidy.
     */
    bounds: { west: 68, east: 89, south: -21, north: -1 },
    zoom: 6,
    expect: { label: 'the deep', metres: -5000, tolerance: 2000, mode: 'min', belowSeaLevel: 0.999 },
  },
]

/** Nearest sample to a coordinate. Rows run north to south. */
function sampleAt(heights, size, bounds, { lat, lon }) {
  const col = Math.round(((lon - bounds.west) / (bounds.east - bounds.west)) * (size - 1))
  const row = Math.round(((bounds.north - lat) / (bounds.north - bounds.south)) * (size - 1))
  return heights[Math.min(size - 1, Math.max(0, row)) * size + Math.min(size - 1, Math.max(0, col))]
}

const wanted = process.argv.slice(2)
const todo = wanted.length ? REGIONS.filter((r) => wanted.includes(r.name)) : REGIONS
if (!todo.length) {
  console.error(`no such region. known: ${REGIONS.map((r) => r.name).join(', ')}`)
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
const manifest = []

for (const region of todo) {
  const { bounds, zoom, name } = region
  const centreLat = (bounds.north + bounds.south) / 2
  process.stdout.write(`${name.padEnd(14)} z${zoom} `)

  const size = region.size ?? SIZE
  const heights = await sampleRegion(bounds, zoom, size, (done, total) => {
    process.stdout.write(`\r${name.padEnd(14)} z${zoom} tiles ${done}/${total}   `)
  })

  let min = Infinity
  let max = -Infinity
  for (const h of heights) {
    if (h < min) min = h
    if (h > max) max = h
  }

  const file = join(OUT, `${name}.dem`)
  writeFileSync(file, Buffer.from(encodeDemRaster({ width: size, height: size, bounds, heights })))

  const gsd = metresPerPixel(centreLat, zoom)
  const spanKm = ((bounds.east - bounds.west) * 111.32 * Math.cos((centreLat * Math.PI) / 180)) / 1
  const outputGsd = (spanKm * 1000) / size

  // Verified at bake time, not only in a test: a region whose numbers are
  // wrong should never reach the repository in the first place.
  const observed = region.expect.at
    ? sampleAt(heights, size, bounds, region.expect.at)
    : region.expect.mode === 'min'
      ? min
      : max
  const off = Math.abs(observed - region.expect.metres)
  let ok = off <= region.expect.tolerance
  if (region.expect.belowSeaLevel !== undefined) {
    let wet = 0
    for (const h of heights) if (h < 0) wet++
    const fraction = wet / heights.length
    if (fraction < region.expect.belowSeaLevel) {
      ok = false
      console.log(`\n${name}: only ${(fraction * 100).toFixed(2)}% below sea level`)
    }
  }

  process.stdout.write(
    `\r${name.padEnd(14)} z${zoom}  ${size}×${size}  ` +
      `${spanKm.toFixed(0)} km span, ${outputGsd.toFixed(0)} m/sample ` +
      `(source ${gsd.toFixed(0)} m/px)  ` +
      `${min.toFixed(0)}..${max.toFixed(0)} m  ` +
      `${(statSync(file).size / 1024).toFixed(0)} KB  ` +
      `${ok ? '✓' : '✗'} ${region.expect.label} ${observed.toFixed(0)} m ` +
      `(published ${region.expect.metres}, off by ${off.toFixed(0)})\n`,
  )
  if (!ok) process.exitCode = 1

  manifest.push({
    name,
    title: region.title,
    file: `${name}.dem`,
    bounds,
    size,
    zoom,
    minHeight: Math.round(min),
    maxHeight: Math.round(max),
    metresPerSample: Math.round(outputGsd),
  })
}

// Merged rather than overwritten, so baking one region does not drop the rest.
const manifestPath = join(OUT, 'index.json')
let existing = []
try {
  existing = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(manifestPath, 'utf8')))
} catch {
  // First run.
}
const byName = new Map(existing.map((r) => [r.name, r]))
for (const r of manifest) byName.set(r.name, r)
const merged = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
writeFileSync(manifestPath, JSON.stringify(merged, null, 2) + '\n')

console.log(`\n${merged.length} regions in ${manifestPath}`)
