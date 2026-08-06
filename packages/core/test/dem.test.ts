import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  blur,
  createDemSurface,
  encodeDemRaster,
  parseDemRaster,
  type DemRaster,
  type GeoBounds,
} from '../dist/dem.js'

const TERRAIN = new URL('../../../apps/article/public/terrain/', import.meta.url)

function load(name: string): DemRaster {
  const bytes = readFileSync(fileURLToPath(new URL(`${name}.dem`, TERRAIN)))
  // A Buffer is a view into a shared pool, so its ArrayBuffer is not the file.
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return parseDemRaster(copy as ArrayBuffer, name)
}

/** Nearest sample to a coordinate, straight out of the raster. */
function sampleAt(raster: DemRaster, lat: number, lon: number): number {
  const { bounds, width, height } = raster
  const col = Math.round(((lon - bounds.west) / (bounds.east - bounds.west)) * (width - 1))
  const row = Math.round(((bounds.north - lat) / (bounds.north - bounds.south)) * (height - 1))
  return raster.heights[row * width + col]!
}

// ── the file format ────────────────────────────────────────────────────────

const TOY_BOUNDS: GeoBounds = { west: 10, east: 11, south: 40, north: 41 }

test('a raster survives a round trip through the file format', () => {
  const heights = Float32Array.from({ length: 16 }, (_, i) => i * 37 - 200)
  const encoded = encodeDemRaster({ width: 4, height: 4, bounds: TOY_BOUNDS, heights })
  const back = parseDemRaster(encoded, 'toy')

  assert.equal(back.width, 4)
  assert.equal(back.height, 4)
  assert.deepEqual(back.bounds, TOY_BOUNDS)
  assert.deepEqual([...back.heights], [...heights])
  assert.equal(back.minHeight, -200)
  assert.equal(back.maxHeight, 15 * 37 - 200)
})

test('a truncated or foreign file is rejected rather than misread', () => {
  const good = encodeDemRaster({
    width: 4,
    height: 4,
    bounds: TOY_BOUNDS,
    heights: new Float32Array(16),
  })
  assert.throws(() => parseDemRaster(good.slice(0, 20)), /header/)
  assert.throws(() => parseDemRaster(good.slice(0, 60)), /expected/)

  const foreign = new ArrayBuffer(good.byteLength)
  new Uint8Array(foreign).set(new Uint8Array(good))
  new DataView(foreign).setUint32(0, 0xdeadbeef, true)
  assert.throws(() => parseDemRaster(foreign), /magic/)
})

// ── the baked regions ──────────────────────────────────────────────────────

test('Everest is where it should be, at the height the data has', () => {
  const raster = load('everest')
  // 8849 m is the surveyed figure. Radar-derived elevation caps it near 8750
  // and a raster cannot hold a peak it has no sample on, so a sampled summit
  // is always low — see the note in tools/bake-dem.mjs.
  assert.ok(raster.maxHeight > 8600, `max ${raster.maxHeight}`)
  assert.ok(raster.maxHeight < 8849, 'a sampled summit cannot exceed the real one')

  const surface = createDemSurface(raster)
  const peak = surface.globalOptimum!
  // Everest is at the centre of the box, so its summit should be near the
  // origin of the domain — within one twentieth of the 20 km span.
  assert.ok(Math.hypot(peak.x, peak.y) < 1000, `peak ${peak.x}, ${peak.y}`)
})

test('K2 too', () => {
  const raster = load('k2')
  assert.ok(raster.maxHeight > 8400 && raster.maxHeight < 8611, `max ${raster.maxHeight}`)
})

test('Chapel Hill is a bad local optimum, at about 150 m', () => {
  const raster = load('chapel-hill')
  const town = sampleAt(raster, 35.9132, -79.0558)
  assert.ok(Math.abs(town - 150) < 40, `${town} m`)
  // The joke needs it to be small, not just correct.
  assert.ok(raster.maxHeight < 400)
})

test('the Indian Ocean is under water', () => {
  const raster = load('indian-ocean')
  let wet = 0
  for (const h of raster.heights) if (h < 0) wet++
  assert.ok(wet / raster.heights.length > 0.999, `${wet} of ${raster.heights.length}`)
  assert.ok(raster.minHeight < -5000, `deepest ${raster.minHeight}`)
})

test('Australia is flat, which is the whole joke', () => {
  const raster = load('australia')
  // Kosciuszko, 2228 m — the highest point on a continent, and lower than
  // Everest base camp.
  assert.ok(Math.abs(raster.maxHeight - 2228) < 250, `max ${raster.maxHeight}`)
  assert.ok(load('everest').maxHeight > raster.maxHeight * 3)
})

test('every region carries bounds that make sense', () => {
  for (const name of ['everest', 'k2', 'himalaya', 'chapel-hill', 'australia', 'indian-ocean']) {
    const r = load(name)
    assert.ok(r.bounds.east > r.bounds.west, `${name}: east of west`)
    assert.ok(r.bounds.north > r.bounds.south, `${name}: north of south`)
    assert.ok(Math.abs(r.bounds.north) <= 85 && Math.abs(r.bounds.south) <= 85, `${name}: latitude`)
    assert.equal(r.width, 256)
    assert.equal(r.height, 256)
  }
})

// ── the surface ────────────────────────────────────────────────────────────

test('the domain is metres, and square where the region is square', () => {
  const surface = createDemSurface(load('everest'))
  const width = surface.domain.xMax - surface.domain.xMin
  const heightSpan = surface.domain.yMax - surface.domain.yMin
  // Baked as a 20 km box, corrected for the cosine of the latitude.
  assert.ok(Math.abs(width - 20000) < 200, `${width} m wide`)
  assert.ok(Math.abs(width - heightSpan) < 200, 'and square')
})

test('sampling reproduces the raster at sample points', () => {
  const raster = load('chapel-hill')
  const surface = createDemSurface(raster)
  const { xMin, xMax, yMax, yMin } = surface.domain

  for (const [col, row] of [
    [0, 0],
    [128, 64],
    [200, 200],
    [255, 255],
  ] as const) {
    const x = xMin + ((xMax - xMin) * col) / 255
    const y = yMax - ((yMax - yMin) * row) / 255
    // Catmull-Rom is interpolating: at a sample it returns that sample.
    assert.ok(
      Math.abs(surface.height(x, y) - raster.heights[row * 256 + col]!) < 1e-3,
      `${col},${row}`,
    )
  }
})

test('north is up: moving north on a north-facing slope changes height the right way', () => {
  const raster = load('everest')
  const surface = createDemSurface(raster)
  // Compare the surface's own reading against the raster, one sample apart in
  // each direction. If the row flip were wrong, north and south would swap.
  const step = 20000 / 255
  for (const [x, y] of [
    [-3000, 2000],
    [1500, -4000],
    [0, 0],
  ] as const) {
    const north = surface.height(x, y + step)
    const south = surface.height(x, y - step)
    const g = surface.gradient(x, y)
    // The smoothed gradient should agree in sign with the raw difference
    // whenever the slope is not near-flat.
    if (Math.abs(north - south) > 60) {
      assert.ok(Math.sign(g.y) === Math.sign(north - south), `at ${x},${y}`)
    }
  }
})

test('the gradient points uphill on real terrain', () => {
  const surface = createDemSurface(load('everest'))
  let agreed = 0
  let tested = 0
  for (let i = 0; i < 40; i++) {
    // Deterministic sweep rather than random: a flaky terrain test is worse
    // than no terrain test.
    const x = -8000 + (16000 * (i % 8)) / 7
    const y = -8000 + (16000 * Math.floor(i / 8)) / 4
    const g = surface.gradient(x, y)
    const mag = Math.hypot(g.x, g.y)
    if (mag < 1e-4) continue
    tested++
    const step = 200
    const uphill = surface.height(x + (g.x / mag) * step, y + (g.y / mag) * step)
    if (uphill > surface.height(x, y)) agreed++
  }
  assert.ok(tested > 20, `only ${tested} usable points`)
  // Not all of them: the gradient is taken on a smoothed copy, so on a ridge
  // crest it can point across a gully the smoothing filled in. That is the
  // point of the smoothing, and 90% is a real bar for real terrain.
  assert.ok(agreed / tested > 0.9, `${agreed}/${tested} pointed uphill`)
})

test('smoothing quiets the gradient without moving the mountain', () => {
  const raster = load('everest')
  const raw = createDemSurface(raster, { smoothing: 0 })
  const smooth = createDemSurface(raster, { smoothing: 3 })

  // Heights are untouched — only the gradient is taken on the smoothed copy.
  assert.equal(raw.height(1000, -500), smooth.height(1000, -500))

  let rawTotal = 0
  let smoothTotal = 0
  for (let i = 0; i < 64; i++) {
    const x = -9000 + (18000 * (i % 8)) / 7
    const y = -9000 + (18000 * Math.floor(i / 8)) / 7
    rawTotal += Math.hypot(raw.gradient(x, y).x, raw.gradient(x, y).y)
    smoothTotal += Math.hypot(smooth.gradient(x, y).x, smooth.gradient(x, y).y)
  }
  assert.ok(smoothTotal < rawTotal, `smoothed ${smoothTotal} vs raw ${rawTotal}`)
})

test('sea level is set, because the drowning needs it', () => {
  assert.equal(createDemSurface(load('indian-ocean')).seaLevel, 0)
})

// ── the blur ───────────────────────────────────────────────────────────────

test('the blur conserves the mean and flattens a spike', () => {
  const data = new Float32Array(64 * 64)
  data[32 * 64 + 32] = 6400
  const out = blur(data, 64, 64, 2)

  const sum = (a: Float32Array) => a.reduce((n, v) => n + v, 0)
  // Edges clamp rather than wrap, but a spike in the middle is nowhere near
  // them, so the total should be preserved.
  assert.ok(Math.abs(sum(out) - sum(data)) / sum(data) < 1e-4)
  assert.ok(out[32 * 64 + 32]! < 1000, 'the spike should be spread')
  assert.ok(out[32 * 64 + 33]! > 0, 'onto its neighbours')
})
