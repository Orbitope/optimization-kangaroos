import { CKColor, chartSeries, withAlpha } from '@contentkit/tokens'
import {
  SURFACES_BY_NAME,
  bayesianOptimization,
  collect,
  mulberry32,
  type BayesianState,
  type Surface,
  type Vec2,
} from '@kangaroos/core'
import {
  CANVAS_DISPLAY,
  CANVAS_MONO,
  ChartFrame,
  linearScale,
  rasteriseSurface,
  toPlanPixel,
  type PlanRaster,
} from '@kangaroos/charts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { NearViewport } from './Figure.js'

export interface AcquisitionFigureProps {
  surface?: string
  seed?: number
  steps?: number
  /** Exploration settings to compare, low to high. */
  kappas?: readonly number[]
  labels?: readonly string[]
  /** Evaluations per second of playback. */
  rate?: number
  height?: number
  caption?: string
}

/** The four tied maxima of Himmelblau, so "did she find one" is answerable by eye. */
const KNOWN_SUMMITS: Record<string, readonly Vec2[]> = {
  Himmelblau: [
    { x: 3, y: 2 },
    { x: -2.805118, y: 3.131312 },
    { x: -3.77931, y: -3.283186 },
    { x: 3.584428, y: -1.848126 },
  ],
}

/**
 * One parachute drop, four settings of the exploration dial.
 *
 * A controlled comparison, not four runs shown together: every panel shares a
 * seed, so all four begin with the same random opening samples and diverge only
 * once the acquisition function takes over. Anything that differs between the
 * panels after that is the dial and nothing else.
 *
 * Plan view rather than 3D. The question here is where she chose to *stand*,
 * which is a question about area, and a perspective camera turns it into a
 * question about foreshortening — the far half of the map occupies a third of
 * the frame, so a run that neglected it looks thorough.
 */
export function AcquisitionFigure({
  surface: surfaceName = 'Himmelblau',
  seed = 4,
  steps = 24,
  kappas = [0, 0.5, 2, 8],
  labels = ['κ = 0', 'κ = 0.5', 'κ = 2', 'κ = 8'],
  rate = 2.6,
  height = 560,
  caption,
}: AcquisitionFigureProps) {
  return (
    <figure className="figure">
      <NearViewport minHeight={height}>
        <AcquisitionFigureBody
          surfaceName={surfaceName}
          seed={seed}
          steps={steps}
          kappas={kappas}
          labels={labels}
          rate={rate}
          height={height}
        />
      </NearViewport>
      {caption && <figcaption className="figure-caption">{caption}</figcaption>}
    </figure>
  )
}

interface Run {
  readonly kappa: number
  readonly states: readonly BayesianState[]
  readonly observations: readonly { readonly position: Vec2; readonly value: number }[]
}

function AcquisitionFigureBody(props: {
  surfaceName: string
  seed: number
  steps: number
  kappas: readonly number[]
  labels: readonly string[]
  rate: number
  height: number
}) {
  const surface: Surface = useMemo(
    () => SURFACES_BY_NAME[props.surfaceName] ?? SURFACES_BY_NAME.Himmelblau!,
    [props.surfaceName],
  )

  const runs: Run[] = useMemo(
    () =>
      props.kappas.map((kappa) => {
        const states = collect(
          bayesianOptimization(surface, mulberry32(props.seed), {
            maxSteps: props.steps,
            acquisition: 'ucb',
            kappa,
            recordModel: false,
          }),
        ) as BayesianState[]
        return {
          kappa,
          states,
          observations: states[states.length - 1]!.observations,
        }
      }),
    [surface, props.seed, props.steps, props.kappas],
  )

  // Built once and blitted every frame. A 260px plate is 68k height
  // evaluations; doing that per frame would cost more than everything else in
  // the figure put together.
  const raster = useRef<PlanRaster | null>(null)
  const rasterFor = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      if (!raster.current || raster.current.width !== RASTER) {
        raster.current = rasteriseSurface(surface, RASTER, (w, h) => ctx.createImageData(w, h))
      }
      return raster.current
    },
    [surface],
  )
  useEffect(() => {
    raster.current = null
  }, [surface])

  const [shown, setShown] = useState(0)
  const raf = useRef(0)

  useEffect(() => {
    let last: number | null = null
    let t = 0
    const tick = (now: number) => {
      const delta = last === null ? 0 : Math.max(0, (now - last) / 1000)
      last = now
      t += delta * props.rate
      // Hold on the finished state before restarting, so the comparison can
      // actually be read rather than glimpsed.
      if (t > props.steps + 5) t = 0
      setShown(Math.min(props.steps, t))
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [props.rate, props.steps])

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, plot: { width: number; height: number }) => {
      drawComparison(ctx, plot.width, plot.height, {
        surface,
        runs,
        labels: props.labels,
        shown,
        steps: props.steps,
        raster: rasterFor(ctx),
      })
    },
    [surface, runs, props.labels, shown, props.steps, rasterFor],
  )

  const description = useMemo(
    () =>
      `Four Bayesian searches from an identical start on ${surface.name}, differing only in the ` +
      `exploration setting kappa. ` +
      runs
        .map((r, i) => {
          const last = r.states[r.states.length - 1]!
          const distinct = new Set(
            r.observations.map((o) => `${o.position.x.toFixed(1)},${o.position.y.toFixed(1)}`),
          ).size
          return (
            `${props.labels[i]}: best altitude ${last.best.value.toFixed(1)}, ` +
            `${distinct} distinct locations visited out of ${r.observations.length} evaluations`
          )
        })
        .join('. ') +
      '.',
    [surface, runs, props.labels],
  )

  return (
    <div className="acquisition-figure">
      <ChartFrame
        height={props.height}
        margin={NO_MARGIN}
        draw={draw}
        description={description}
      />
    </div>
  )
}

const RASTER = 260
const NO_MARGIN = { top: 0, right: 0, bottom: 0, left: 0 } as const

interface ComparisonInput {
  surface: Surface
  runs: readonly Run[]
  labels: readonly string[]
  shown: number
  steps: number
  raster: PlanRaster
}

/**
 * The whole figure in one canvas: four plan views over a shared convergence
 * chart.
 *
 * One canvas rather than five, because the panels have to stay in lockstep. Two
 * canvases animating off the same state can render a frame apart, and in a
 * figure whose entire argument is "same start, same step count, different
 * outcome", a one-frame skew between panels is a lie.
 */
function drawComparison(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  input: ComparisonInput,
): void {
  const { surface, runs, labels, shown, steps, raster } = input

  ctx.clearRect(0, 0, width, height)

  const n = runs.length
  // Two rows when the figure is narrow. Four 130px panels on a phone is not a
  // comparison, it is four thumbnails.
  const cols = width < 720 ? 2 : n
  const rows = Math.ceil(n / cols)
  const gap = 14
  const legendH = 22
  const captionH = 54
  const titleH = 16
  const chartH = Math.min(176, Math.max(120, height * 0.28))

  const panel = Math.min(
    (width - gap * (cols - 1)) / cols,
    (height - legendH - chartH - titleH - 30 - rows * (captionH + gap)) / rows,
  )

  ctx.save()
  ctx.textBaseline = 'alphabetic'

  // ── legend ───────────────────────────────────────────────────────────────
  ctx.font = `11.5px ${CANVAS_DISPLAY}`
  ctx.fillStyle = CKColor.textMuted
  ctx.textAlign = 'left'
  let lx = 2
  const ly = 13

  ctx.strokeStyle = CKColor.textBright
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(lx + 5, ly - 4, 4.5, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillText('shared opening', lx + 15, ly)
  lx += 120

  ctx.beginPath()
  ctx.moveTo(lx, ly - 4)
  ctx.lineTo(lx + 11, ly - 4)
  ctx.moveTo(lx + 5.5, ly - 9.5)
  ctx.lineTo(lx + 5.5, ly + 1.5)
  ctx.stroke()
  ctx.fillText('a true summit', lx + 20, ly)
  lx += 115

  ctx.lineWidth = 1.8
  ctx.beginPath()
  ctx.arc(lx + 6, ly - 4, 6.5, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillText('where she finished', lx + 19, ly)

  // ── panels ───────────────────────────────────────────────────────────────
  runs.forEach((run, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const ox = col * (panel + gap)
    const oy = legendH + row * (panel + captionH + gap)
    const view = { x: ox, y: oy, size: panel }
    const colour = chartSeries(i)

    ctx.imageSmoothingEnabled = true
    drawRaster(ctx, raster, view)

    ctx.strokeStyle = CKColor.border
    ctx.lineWidth = 1
    ctx.strokeRect(ox + 0.5, oy + 0.5, panel - 1, panel - 1)

    ctx.save()
    ctx.beginPath()
    ctx.rect(ox, oy, panel, panel)
    ctx.clip()

    for (const m of KNOWN_SUMMITS[surface.name] ?? []) {
      drawCross(ctx, toPlanPixel(surface, m, view))
    }

    const visible = run.observations.slice(0, Math.max(1, Math.floor(shown) + 1))
    const pts = visible.map((o) => toPlanPixel(surface, o.position, view))

    if (pts.length > 1) {
      ctx.strokeStyle = withAlpha(colour, 0.35)
      ctx.lineWidth = 1.1
      ctx.beginPath()
      pts.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.stroke()
    }

    pts.forEach((p, k) => {
      // The opening is drawn identically in every panel, so a reader can see at
      // a glance that the comparison is controlled.
      if (k < 4) {
        ctx.strokeStyle = CKColor.textBright
        ctx.lineWidth = 1.6
        ctx.globalAlpha = 0.9
        ctx.beginPath()
        ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1
        return
      }
      const t = k / Math.max(1, run.observations.length - 1)
      ctx.fillStyle = colour
      ctx.globalAlpha = 0.4 + 0.6 * t
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3 + t * 1.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.strokeStyle = CKColor.void
      ctx.lineWidth = 0.8
      ctx.stroke()
    })

    // Her best so far, ringed twice so it reads against any part of the ramp.
    const bestNow = run.states[Math.min(run.states.length - 1, Math.floor(shown))]!.best
    const bp = toPlanPixel(surface, bestNow.position, view)
    ctx.strokeStyle = CKColor.void
    ctx.lineWidth = 3.5
    ctx.beginPath()
    ctx.arc(bp.x, bp.y, 8.5, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = CKColor.textBright
    ctx.lineWidth = 1.8
    ctx.beginPath()
    ctx.arc(bp.x, bp.y, 8.5, 0, Math.PI * 2)
    ctx.stroke()

    ctx.restore()

    // ── caption ────────────────────────────────────────────────────────────
    ctx.textAlign = 'left'
    ctx.font = `600 13px ${CANVAS_DISPLAY}`
    ctx.fillStyle = colour
    ctx.fillText(labels[i] ?? `κ = ${run.kappa}`, ox, oy + panel + 17)

    const distinct = new Set(
      visible.map((o) => `${o.position.x.toFixed(1)},${o.position.y.toFixed(1)}`),
    ).size
    ctx.font = `11.5px ${CANVAS_MONO}`
    ctx.fillStyle = CKColor.textSecondary
    ctx.fillText(`best ${bestNow.value.toFixed(1)}`, ox, oy + panel + 33)
    ctx.fillStyle = CKColor.textMuted
    ctx.fillText(`${distinct} spots of ${visible.length}`, ox + 92, oy + panel + 33)
  })

  // ── convergence ──────────────────────────────────────────────────────────
  const cy = legendH + rows * (panel + captionH + gap) + titleH
  const cx = 44
  const cw = width - cx - 50
  const ch = Math.max(60, height - cy - 30)

  let lo = Infinity
  let hi = -Infinity
  for (const r of runs) {
    for (const s of r.states) {
      if (s.best.value < lo) lo = s.best.value
      if (s.best.value > hi) hi = s.best.value
    }
  }
  const padY = (hi - lo) * 0.1 || 1
  const y = linearScale({ min: lo - padY, max: hi + padY }, { min: cy + ch, max: cy })
  const x = linearScale({ min: 0, max: steps }, { min: cx, max: cx + cw })

  ctx.textAlign = 'left'
  ctx.font = `600 12.5px ${CANVAS_DISPLAY}`
  ctx.fillStyle = CKColor.textBright
  ctx.fillText('Best altitude found so far', 0, cy - 10)

  ctx.font = `10.5px ${CANVAS_MONO}`
  for (let g = 0; g <= 3; g++) {
    const v = lo - padY + ((hi - lo + padY * 2) * g) / 3
    const py = Math.round(y(v)) + 0.5
    ctx.strokeStyle = withAlpha(CKColor.textMuted, 0.16)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx, py)
    ctx.lineTo(cx + cw, py)
    ctx.stroke()
    ctx.fillStyle = CKColor.textMuted
    ctx.textAlign = 'right'
    ctx.fillText(v.toFixed(0), cx - 8, py + 3.5)
  }

  runs.forEach((run, i) => {
    const upto = run.states.slice(0, Math.floor(shown) + 1)
    if (upto.length < 2) return
    ctx.strokeStyle = chartSeries(i)
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    upto.forEach((s, k) => {
      const px = x(k)
      const py = y(s.best.value)
      if (k === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.stroke()

    // Direct labels riding the line end, so there is no legend to cross-refer.
    const last = upto[upto.length - 1]!
    ctx.font = `600 11px ${CANVAS_DISPLAY}`
    ctx.fillStyle = chartSeries(i)
    ctx.textAlign = 'left'
    ctx.fillText(`κ=${run.kappa}`, x(upto.length - 1) + 6, y(last.best.value) + 3.5)
  })

  ctx.font = `10.5px ${CANVAS_MONO}`
  ctx.fillStyle = CKColor.textMuted
  ctx.textAlign = 'center'
  for (const k of [0, steps / 4, steps / 2, (steps * 3) / 4, steps]) {
    ctx.fillText(String(Math.round(k)), x(k), cy + ch + 16)
  }
  ctx.font = `11.5px ${CANVAS_DISPLAY}`
  ctx.fillStyle = CKColor.textSecondary
  ctx.fillText('evaluations', cx + cw / 2, cy + ch + 30)

  ctx.restore()
}

/** Blit the shared raster into a panel, via an offscreen canvas so it scales. */
const scratch =
  typeof document === 'undefined' ? null : (document.createElement('canvas') as HTMLCanvasElement)

function drawRaster(
  ctx: CanvasRenderingContext2D,
  raster: PlanRaster,
  view: { x: number; y: number; size: number },
): void {
  // putImageData ignores the transform and cannot scale, so the raster goes
  // through a scratch canvas first. Without this the plate would draw at
  // device pixels in the top-left corner of the figure.
  if (!scratch) return
  if (scratch.width !== raster.width) {
    scratch.width = raster.width
    scratch.height = raster.height
  }
  const sctx = scratch.getContext('2d')
  if (!sctx) return
  sctx.putImageData(raster.image, 0, 0)
  ctx.drawImage(scratch, view.x, view.y, view.size, view.size)
}

function drawCross(ctx: CanvasRenderingContext2D, p: { x: number; y: number }): void {
  const a = 6
  ctx.save()
  ctx.strokeStyle = CKColor.void
  ctx.globalAlpha = 0.55
  ctx.lineWidth = 3.2
  for (const pass of [0, 1]) {
    if (pass === 1) {
      ctx.strokeStyle = CKColor.textBright
      ctx.globalAlpha = 0.85
      ctx.lineWidth = 1.4
    }
    ctx.beginPath()
    ctx.moveTo(p.x - a, p.y)
    ctx.lineTo(p.x + a, p.y)
    ctx.moveTo(p.x, p.y - a)
    ctx.lineTo(p.x, p.y + a)
    ctx.stroke()
  }
  ctx.restore()
}
