/**
 * Same seed, same opening, four exploration settings.
 *
 * Top-down rather than 3D on purpose: the question here is *where she chose to
 * stand*, which is a question about the plan view. A perspective camera turns
 * "did she cover the map" into a judgement about foreshortening.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

import {
  SURFACES_BY_NAME,
  bayesianOptimization,
  collect,
  mulberry32,
} from '../packages/core/dist/index.js'
import {
  CKColor,
  chartSeries,
  sampleElevation,
} from '../../contentkit/web~/packages/tokens/dist/index.js'

const SURFACE = SURFACES_BY_NAME.Himmelblau
const SEED = 4
const STEPS = 24
const KAPPAS = [0, 0.5, 2, 8]
const LABELS = ['κ = 0  greedy', 'κ = 0.5', 'κ = 2', 'κ = 8  survey']

// ── minimal PNG writer, so the terrain is a real raster rather than 40k rects ──

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(width, height, rgb) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // truecolour
  const raw = Buffer.alloc(height * (width * 3 + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0 // filter: none
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── the terrain raster, shared by all four panels ──────────────────────────

const RES = 300
const d = SURFACE.domain
const heights = new Float64Array(RES * RES)
let hMin = Infinity
let hMax = -Infinity
for (let j = 0; j < RES; j++) {
  // Image rows run top to bottom; domain y runs bottom to top.
  const y = d.yMax - ((d.yMax - d.yMin) * j) / (RES - 1)
  for (let i = 0; i < RES; i++) {
    const x = d.xMin + ((d.xMax - d.xMin) * i) / (RES - 1)
    const h = SURFACE.height(x, y)
    heights[j * RES + i] = h
    if (h < hMin) hMin = h
    if (h > hMax) hMax = h
  }
}

// Percentile floor, for the same reason the 3D terrain needs one: Himmelblau
// plunges to -890 in one corner, so a linear map puts every peak in the top
// 3% of the ramp and the whole plate reads as one flat colour.
const sorted = Float64Array.from(heights).sort()
const floor = sorted[Math.floor(sorted.length * 0.35)]

const rgb = Buffer.alloc(RES * RES * 3)
for (let k = 0; k < RES * RES; k++) {
  const t = Math.min(1, Math.max(0, (heights[k] - floor) / (hMax - floor)))
  const hex = sampleElevation(t)
  rgb[k * 3] = parseInt(hex.slice(1, 3), 16)
  rgb[k * 3 + 1] = parseInt(hex.slice(3, 5), 16)
  rgb[k * 3 + 2] = parseInt(hex.slice(5, 7), 16)
}
const terrainUri = `data:image/png;base64,${png(RES, RES, rgb).toString('base64')}`

// ── the runs ───────────────────────────────────────────────────────────────

const runs = KAPPAS.map((kappa) => {
  const states = collect(
    bayesianOptimization(SURFACE, mulberry32(SEED), {
      maxSteps: STEPS,
      acquisition: 'ucb',
      kappa,
      recordModel: false,
    }),
  )
  const last = states[states.length - 1]
  return { kappa, observations: last.observations, best: last.best, states }
})

// Identical opening, or the comparison is not controlled. Asserted rather than
// assumed — a shared RNG stream would silently break it.
const opening = runs.map((r) => r.observations.slice(0, 4).map((o) => `${o.position.x.toFixed(6)}`).join())
if (new Set(opening).size !== 1) throw new Error('runs did not share an opening: ' + opening.join(' | '))

// ── layout ─────────────────────────────────────────────────────────────────

const PANEL = 260
const GAP = 18
const PAD = 26
const TOP = 92
const CHART_H = 190
const RIGHT = 58
const W = PAD * 2 + PANEL * 4 + GAP * 3 + RIGHT
const H = TOP + PANEL + 74 + CHART_H + PAD

const toPx = (p, ox) => ({
  x: ox + ((p.x - d.xMin) / (d.xMax - d.xMin)) * PANEL,
  // Flip: domain +y is north, which is up the page.
  y: TOP + (1 - (p.y - d.yMin) / (d.yMax - d.yMin)) * PANEL,
})

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const out = []

out.push(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'IBM Plex Sans', system-ui, sans-serif">`,
)
out.push(`<rect width="${W}" height="${H}" fill="${CKColor.void}"/>`)
out.push(
  `<text x="${PAD}" y="30" fill="${CKColor.textBright}" font-size="17" font-weight="600">One kangaroo, one parachute drop, four settings of the exploration dial</text>`,
)
out.push(
  `<text x="${PAD}" y="52" fill="${CKColor.textSecondary}" font-size="12.5">Himmelblau, seed ${SEED}. All four share the same four random opening samples, then diverge. ${STEPS} evaluations each; later samples are brighter.</text>`,
)

const LEG = TOP - 16
out.push(
  `<g transform="translate(${PAD} ${LEG})">` +
    `<circle cx="6" cy="-4" r="4.5" fill="none" stroke="${CKColor.textBright}" stroke-width="1.6"/>` +
    `<text x="17" y="0" fill="${CKColor.textMuted}" font-size="11">shared opening</text>` +
    `<g stroke="${CKColor.textBright}" stroke-width="1.4" opacity="0.85">` +
    `<line x1="134" y1="-4" x2="146" y2="-4"/><line x1="140" y1="-10" x2="140" y2="2"/></g>` +
    `<text x="152" y="0" fill="${CKColor.textMuted}" font-size="11">a true summit</text>` +
    `<circle cx="272" cy="-4" r="6.5" fill="none" stroke="${CKColor.textBright}" stroke-width="1.8"/>` +
    `<text x="284" y="0" fill="${CKColor.textMuted}" font-size="11">where she finished</text>` +
    `</g>`,
)

runs.forEach((run, panel) => {
  const ox = PAD + panel * (PANEL + GAP)
  const colour = chartSeries(panel)

  out.push(
    `<image x="${ox}" y="${TOP}" width="${PANEL}" height="${PANEL}" href="${terrainUri}" preserveAspectRatio="none"/>`,
  )
  out.push(
    `<rect x="${ox}" y="${TOP}" width="${PANEL}" height="${PANEL}" fill="none" stroke="${CKColor.border}"/>`,
  )

  // The true maxima, so "did she find one" is answerable by eye.
  for (const m of [
    { x: 3, y: 2 },
    { x: -2.805118, y: 3.131312 },
    { x: -3.779310, y: -3.283186 },
    { x: 3.584428, y: -1.848126 },
  ]) {
    const p = toPx(m, ox)
    const a = 6
    out.push(
      `<g stroke="${CKColor.void}" stroke-width="3.2" opacity="0.55">` +
        `<line x1="${(p.x - a).toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${(p.x + a).toFixed(1)}" y2="${p.y.toFixed(1)}"/>` +
        `<line x1="${p.x.toFixed(1)}" y1="${(p.y - a).toFixed(1)}" x2="${p.x.toFixed(1)}" y2="${(p.y + a).toFixed(1)}"/></g>` +
        `<g stroke="${CKColor.textBright}" stroke-width="1.4" opacity="0.85">` +
        `<line x1="${(p.x - a).toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${(p.x + a).toFixed(1)}" y2="${p.y.toFixed(1)}"/>` +
        `<line x1="${p.x.toFixed(1)}" y1="${(p.y - a).toFixed(1)}" x2="${p.x.toFixed(1)}" y2="${(p.y + a).toFixed(1)}"/></g>`,
    )
  }

  // Path, then points. Order is encoded by opacity rather than by a number on
  // every mark — twenty-four labels would bury the terrain.
  const pts = run.observations.map((o) => toPx(o.position, ox))
  out.push(
    `<polyline points="${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="${colour}" stroke-width="1.1" opacity="0.35"/>`,
  )

  pts.forEach((p, i) => {
    const t = i / Math.max(1, pts.length - 1)
    if (i < 4) {
      out.push(
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="none" stroke="${CKColor.textBright}" stroke-width="1.6" opacity="0.9"/>`,
      )
    } else {
      out.push(
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(3 + t * 1.6).toFixed(1)}" fill="${colour}" opacity="${(0.4 + 0.6 * t).toFixed(2)}" stroke="${CKColor.void}" stroke-width="0.8"/>`,
      )
    }
  })

  // Where she ended up, ringed twice so it reads on any part of the ramp.
  const bp = toPx(run.best.position, ox)
  out.push(
    `<circle cx="${bp.x.toFixed(1)}" cy="${bp.y.toFixed(1)}" r="8.5" fill="none" stroke="${CKColor.void}" stroke-width="3.5"/>`,
  )
  out.push(
    `<circle cx="${bp.x.toFixed(1)}" cy="${bp.y.toFixed(1)}" r="8.5" fill="none" stroke="${CKColor.textBright}" stroke-width="1.8"/>`,
  )

  out.push(
    `<text x="${ox}" y="${TOP + PANEL + 20}" fill="${colour}" font-size="13" font-weight="600">${esc(LABELS[panel])}</text>`,
  )
  const distinct = new Set(
    run.observations.map((o) => `${o.position.x.toFixed(1)},${o.position.y.toFixed(1)}`),
  ).size
  out.push(
    `<text x="${ox}" y="${TOP + PANEL + 37}" fill="${CKColor.textSecondary}" font-size="11.5" font-family="'IBM Plex Mono', ui-monospace, monospace">best ${run.best.value.toFixed(2)}   spread ${spread(run.observations).toFixed(2)}</text>`,
  )
  out.push(
    `<text x="${ox}" y="${TOP + PANEL + 53}" fill="${CKColor.textMuted}" font-size="11.5" font-family="'IBM Plex Mono', ui-monospace, monospace">${distinct} distinct spots of ${run.observations.length}</text>`,
  )
})

function spread(obs) {
  // Mean distance from each sample to the nearest earlier one, normalised by
  // the domain diagonal — the same novelty measure the tests use.
  const diag = Math.hypot(d.xMax - d.xMin, d.yMax - d.yMin)
  let total = 0
  for (let i = 1; i < obs.length; i++) {
    let near = Infinity
    for (let j = 0; j < i; j++) {
      near = Math.min(
        near,
        Math.hypot(obs[i].position.x - obs[j].position.x, obs[i].position.y - obs[j].position.y),
      )
    }
    total += near
  }
  return total / (obs.length - 1) / diag
}

// ── best-so-far ────────────────────────────────────────────────────────────

const CY = TOP + PANEL + 94
const CW = W - PAD * 2 - 52 - RIGHT
const CX = PAD + 52

let lo = Infinity
let hi = -Infinity
for (const r of runs) {
  for (const s of r.states) {
    if (s.best.value < lo) lo = s.best.value
    if (s.best.value > hi) hi = s.best.value
  }
}
const pad = (hi - lo) * 0.08
lo -= pad
hi += pad

const sx = (i) => CX + (i / STEPS) * CW
const sy = (v) => CY + (1 - (v - lo) / (hi - lo)) * (CHART_H - 46)

out.push(
  `<text x="${PAD}" y="${CY - 12}" fill="${CKColor.textBright}" font-size="13" font-weight="600">Best altitude found so far</text>`,
)

for (let g = 0; g <= 4; g++) {
  const v = lo + ((hi - lo) * g) / 4
  const y = sy(v)
  out.push(
    `<line x1="${CX}" y1="${y.toFixed(1)}" x2="${(CX + CW).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${CKColor.textMuted}" stroke-width="1" opacity="0.16"/>`,
  )
  out.push(
    `<text x="${CX - 8}" y="${(y + 3.5).toFixed(1)}" fill="${CKColor.textMuted}" font-size="10.5" text-anchor="end" font-family="'IBM Plex Mono', ui-monospace, monospace">${v.toFixed(0)}</text>`,
  )
}

runs.forEach((run, i) => {
  const pts = run.states.map((s, k) => `${sx(k).toFixed(1)},${sy(s.best.value).toFixed(1)}`)
  out.push(
    `<polyline points="${pts.join(' ')}" fill="none" stroke="${chartSeries(i)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
  )
  // Direct labels at the line ends rather than a legend box.
  const last = run.states[run.states.length - 1]
  out.push(
    `<text x="${(CX + CW + 6).toFixed(1)}" y="${(sy(last.best.value) + 3.5).toFixed(1)}" fill="${chartSeries(i)}" font-size="11" font-weight="600">κ=${run.kappa}</text>`,
  )
})

for (const k of [0, 6, 12, 18, 24]) {
  out.push(
    `<text x="${sx(k).toFixed(1)}" y="${(CY + CHART_H - 30).toFixed(1)}" fill="${CKColor.textMuted}" font-size="10.5" text-anchor="middle" font-family="'IBM Plex Mono', ui-monospace, monospace">${k}</text>`,
  )
}
out.push(
  `<text x="${(CX + CW / 2).toFixed(1)}" y="${(CY + CHART_H - 12).toFixed(1)}" fill="${CKColor.textSecondary}" font-size="11.5" text-anchor="middle">evaluations</text>`,
)

out.push('</svg>')

const dest = process.argv[2] ?? new URL('kappa-comparison.svg', import.meta.url).pathname
writeFileSync(dest, out.join('\n'))
console.error(`wrote ${dest}`)


console.log('kappa   best     spread   distinct places visited')
for (const r of runs) {
  const cells = new Set(
    r.observations.map((o) => `${Math.round(o.position.x)},${Math.round(o.position.y)}`),
  )
  console.log(
    String(r.kappa).padEnd(8) +
      r.best.value.toFixed(2).padStart(7) +
      spread(r.observations).toFixed(3).padStart(10) +
      String(cells.size).padStart(24),
  )
}
