/**
 * Terrarium terrain-RGB tiles, decoded to metres.
 *
 * The source is AWS Open Data — `s3.amazonaws.com/elevation-tiles-prod` — which
 * needs no token, serves land *and* ocean bathymetry in one grid, and is the
 * only elevation host reachable from here. NOAA's own ETOPO endpoint times out,
 * which is a shame because it is the canonical source; terrarium is built from
 * it among others, so the numbers agree.
 *
 * Encoding: `height = R*256 + G + B/256 − 32768`, metres.
 */
import { inflateSync } from 'node:zlib'

const EARTH_CIRCUMFERENCE = 40075016.686
const BASE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'

/** Slippy-map tile containing a coordinate, as fractional tile units. */
export function tileFor(lat, lon, z) {
  const n = 2 ** z
  const r = (lat * Math.PI) / 180
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n,
  }
}

/** Inverse of `tileFor`, for fractional tile units. */
export function latLonFor(tx, ty, z) {
  const n = 2 ** z
  const lon = (tx / n) * 360 - 180
  const k = Math.PI - 2 * Math.PI * (ty / n)
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(k) - Math.exp(-k)))
  return { lat, lon }
}

/** Ground sample distance in metres per pixel at a latitude and zoom. */
export function metresPerPixel(lat, z) {
  return (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z)
}

/**
 * Minimal PNG decoder.
 *
 * Hand-written rather than a dependency: zlib ships with Node, terrarium tiles
 * are always 8-bit RGB, and the only other thing a PNG needs is un-filtering.
 * Five filter types, one of which is fiddly.
 */
export function decodePng(buf) {
  let off = 8 // signature
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const idat = []

  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }

  if (bitDepth !== 8) throw new Error(`expected 8-bit PNG, got ${bitDepth}`)
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType]
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`)

  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[y * stride + i - channels] : 0
      const b = y > 0 ? out[(y - 1) * stride + i] : 0
      const c = i >= channels && y > 0 ? out[(y - 1) * stride + i - channels] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[y * stride + i] = v & 0xff
    }
  }
  return { width, height, channels, pixels: out }
}

const cache = new Map()

/** One tile as a 256×256 Float32Array of metres, row 0 north. Memoised. */
export async function fetchTile(z, x, y) {
  const key = `${z}/${x}/${y}`
  const hit = cache.get(key)
  if (hit) return hit

  const res = await fetch(`${BASE}/${key}.png`)
  if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`)
  const img = decodePng(Buffer.from(await res.arrayBuffer()))

  const out = new Float32Array(img.width * img.height)
  for (let i = 0; i < out.length; i++) {
    const p = i * img.channels
    out[i] = img.pixels[p] * 256 + img.pixels[p + 1] + img.pixels[p + 2] / 256 - 32768
  }
  const tile = { width: img.width, height: img.height, heights: out }
  cache.set(key, tile)
  return tile
}

/**
 * Sample a geographic box into a `size × size` grid of metres.
 *
 * Bilinear across the tile mosaic. The tiles are already a coarser grid than
 * the output in most regions, so the interpolation is doing real work rather
 * than just resampling — and the alternative, nearest neighbour, puts visible
 * terraces on every slope.
 *
 * Rows run north to south, matching the raster convention in `dem.ts`.
 */
export async function sampleRegion({ west, east, south, north }, zoom, size, onProgress) {
  const tl = tileFor(north, west, zoom)
  const br = tileFor(south, east, zoom)

  const x0 = Math.floor(tl.x)
  const x1 = Math.ceil(br.x)
  const y0 = Math.floor(tl.y)
  const y1 = Math.ceil(br.y)

  // Prefetch the mosaic. Sequential rather than parallel: this is a one-off
  // bake and hammering a public bucket with a hundred concurrent requests to
  // save thirty seconds is not a trade worth making.
  const total = (x1 - x0) * (y1 - y0)
  let done = 0
  for (let ty = y0; ty < y1; ty++) {
    for (let tx = x0; tx < x1; tx++) {
      await fetchTile(zoom, tx, ty)
      done++
      onProgress?.(done, total)
    }
  }

  const heights = new Float32Array(size * size)
  for (let r = 0; r < size; r++) {
    // Sampled in Web Mercator tile space, not linearly in latitude: the two
    // differ by several kilometres across a region this tall, which would
    // shear the whole raster north-south against its own bounds.
    const lat = north + ((south - north) * r) / (size - 1)
    const ty = tileFor(lat, west, zoom).y
    for (let c = 0; c < size; c++) {
      const lon = west + ((east - west) * c) / (size - 1)
      const tx = tileFor(lat, lon, zoom).x
      heights[r * size + c] = bilinearFromMosaic(tx, ty, zoom)
    }
  }
  return heights
}

function bilinearFromMosaic(tx, ty, zoom) {
  // Fractional tile units to global pixel units.
  const px = tx * 256 - 0.5
  const py = ty * 256 - 0.5
  const x0 = Math.floor(px)
  const y0 = Math.floor(py)
  const fx = px - x0
  const fy = py - y0

  const p = (gx, gy) => {
    const tile = cache.get(`${zoom}/${Math.floor(gx / 256)}/${Math.floor(gy / 256)}`)
    // Off the edge of the fetched mosaic — only reachable at the very border of
    // a region, and clamping there beats a hole in the terrain.
    if (!tile) return 0
    const lx = ((gx % 256) + 256) % 256
    const ly = ((gy % 256) + 256) % 256
    return tile.heights[ly * 256 + lx]
  }

  return (
    p(x0, y0) * (1 - fx) * (1 - fy) +
    p(x0 + 1, y0) * fx * (1 - fy) +
    p(x0, y0 + 1) * (1 - fx) * fy +
    p(x0 + 1, y0 + 1) * fx * fy
  )
}
