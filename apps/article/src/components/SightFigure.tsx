import { agentSeries, CKColor, CKMarker, withAlpha } from '@contentkit/tokens'
import {
  SURFACES_BY_NAME,
  bayesianOptimization,
  collect,
  createSampledSurface,
  geneticAlgorithm,
  gradientAscent,
  hillClimber,
  clearCoverage,
  coverageFraction,
  createCoverage,
  mulberry32,
  simulatedAnnealing,
  stampCoverage,
  type Coverage,
  type OptimizerState,
  type Vec2,
  type Surface,
} from '@kangaroos/core'
import { CANVAS_DISPLAY, CANVAS_MONO, ChartFrame, applyFog, rasteriseSurface, toPlanPixel, type PlanRaster } from '@kangaroos/charts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { NearViewport } from './Figure.js'

export type SightAlgorithm =
  | 'hill-climber'
  | 'gradient-ascent'
  | 'annealing'
  | 'genetic'
  | 'bayesian'

/**
 * What counts as seen.
 *
 * - `trail` — everywhere she has ever stood stays lit. The record of a search,
 *   and the one that makes coverage a fair question: five hundred hops inside
 *   one basin still leaves most of the world dark, and that is the sentence the
 *   figure exists to make undeniable.
 * - `window` — only the ground within sight of where she is standing *now*.
 *   Closer to her actual epistemic state, and much more claustrophobic; the
 *   ground she climbed ten hops ago is gone again.
 */
export type SightMode = 'trail' | 'window'

export interface SightFigureProps {
  surface?: string
  algorithm?: SightAlgorithm
  seed?: number
  steps?: number
  /**
   * How many independent searches to run, each from its own random start.
   *
   * One blind run against Bayesian optimization's twenty-five deliberate ones
   * is not a comparison, it is a handicap. Random multistart is the honest
   * baseline — it is what you actually do with a cheap local method, and it is
   * already the thing act three introduces — so the fog figure runs several and
   * accumulates coverage across all of them.
   */
  runs?: number
  /**
   * Fixed starting point, in domain coordinates. Single-run figures only.
   *
   * Same reason the 3D figures needed it: where a random seed happens to drop
   * her decides whether the figure shows anything, and for a figure about *how*
   * she moves that is left to chance for no benefit.
   */
  startX?: number
  startY?: number
  /** Sight radius as a fraction of the domain's shorter side. */
  sight?: number
  /** Evaluations per second of playback. */
  rate?: number
  mode?: SightMode
  /** Start with the true landscape revealed rather than fogged. */
  revealed?: boolean
  /** Draw the uphill direction at her feet, for the methods that can measure it. */
  showGradient?: boolean
  height?: number
  caption?: string
}

const ALGORITHM_LABEL: Record<SightAlgorithm, string> = {
  'hill-climber': 'hill climber',
  'gradient-ascent': 'gradient ascent',
  annealing: 'simulated annealing',
  genetic: 'genetic algorithm',
  bayesian: 'Bayesian optimization',
}

function resolveSurface(spec: string): Surface {
  if (spec.startsWith('data:')) {
    return createSampledSurface({ count: Number(spec.slice(5)) || 40, seed: 1 })
  }
  return SURFACES_BY_NAME[spec] ?? SURFACES_BY_NAME.Himmelblau!
}

function runOf(
  name: SightAlgorithm,
  surface: Surface,
  seed: number,
  steps: number,
  start?: Vec2,
): OptimizerState[] {
  const rng = mulberry32(seed)
  switch (name) {
    case 'gradient-ascent':
      return collect(gradientAscent(surface, rng, { stepDecay: 0.99, maxSteps: steps, start }))
    case 'annealing':
      return collect(simulatedAnnealing(surface, rng, { maxSteps: steps, start }))
    case 'genetic':
      return collect(geneticAlgorithm(surface, rng, { maxSteps: steps, populationSize: 24, start }))
    case 'bayesian':
      return collect(
        bayesianOptimization(surface, rng, { maxSteps: steps, recordModel: false, start }),
      ) as OptimizerState[]
    default:
      // Patience raised so she does not declare victory and stop. A hill
      // climber that gives up after eleven hops is honest about convergence and
      // useless for this figure, whose subject is how little of the world a
      // long search touches. It also matches what act one already says about
      // her spending most of her effort near the top discovering that
      // everything around her is lower — which only happens if she keeps
      // trying.
      return collect(hillClimber(surface, rng, { maxSteps: steps, patience: steps, start }))
  }
}

/**
 * The landscape, as much of it as she has actually sensed.
 *
 * Every other figure in this article shows the reader a landscape the kangaroo
 * cannot see. The prose says so repeatedly and every picture contradicts it.
 * This one does not: the map is dark until she stands somewhere, and the two
 * toggles let a reader put her side of it against ours directly.
 *
 * Interactive, unlike the rest. A toggle earns its place here because the whole
 * point is the *difference* between two views of the same run, and a reader who
 * cannot flip between them has to hold one in memory while looking at the other.
 */
export function SightFigure({
  surface: surfaceName = 'Himmelblau',
  algorithm = 'hill-climber',
  seed = 7,
  runs = 1,
  startX,
  startY,
  steps = 220,
  sight = 0.09,
  rate = 14,
  mode = 'trail',
  revealed = false,
  showGradient = false,
  height = 480,
  caption,
}: SightFigureProps) {
  return (
    <figure className="figure">
      <NearViewport minHeight={height}>
        <SightFigureBody
          surfaceName={surfaceName}
          algorithm={algorithm}
          seed={seed}
          runs={runs}
          startX={startX}
          startY={startY}
          steps={steps}
          sight={sight}
          rate={rate}
          initialMode={mode}
          initialRevealed={revealed}
          showGradient={showGradient}
          height={height}
        />
      </NearViewport>
      {caption && <figcaption className="figure-caption">{caption}</figcaption>}
    </figure>
  )
}

const RASTER = 320
const NO_MARGIN = { top: 0, right: 0, bottom: 0, left: 0 } as const

function SightFigureBody(props: {
  surfaceName: string
  algorithm: SightAlgorithm
  seed: number
  runs: number
  startX?: number
  startY?: number
  steps: number
  sight: number
  rate: number
  initialMode: SightMode
  initialRevealed: boolean
  showGradient: boolean
  height: number
}) {
  const [mode, setMode] = useState<SightMode>(props.initialMode)
  const [revealed, setRevealed] = useState(props.initialRevealed)

  const surface = useMemo(() => resolveSurface(props.surfaceName), [props.surfaceName])
  // Seeds run from `seed`, so the single-run figure is the first of the set
  // rather than a different search entirely.
  const runs = useMemo(
    () =>
      Array.from({ length: Math.max(1, props.runs) }, (_, i) =>
        runOf(
          props.algorithm,
          surface,
          props.seed + i,
          props.steps,
          // A pinned start belongs to a single run; several runs from one point
          // would not be a multistart.
          props.startX !== undefined && props.startY !== undefined && props.runs <= 1
            ? { x: props.startX, y: props.startY }
            : undefined,
        ),
      ),
    [props.algorithm, surface, props.seed, props.runs, props.steps, props.startX, props.startY],
  )
  // The playhead runs on the longest, so it does not stop while somebody is
  // still climbing.
  const longest = useMemo(
    () => runs.reduce((n, r) => Math.max(n, r.length), 0),
    [runs],
  )
  const totalEvaluations = useMemo(() => runs.reduce((n, r) => n + r.length, 0), [runs])

  const d = surface.domain
  const radius = Math.min(d.xMax - d.xMin, d.yMax - d.yMin) * props.sight

  const raster = useRef<PlanRaster | null>(null)
  const fogged = useRef<ImageData | null>(null)
  const coverage = useRef<Coverage>(createCoverage(RASTER))
  // Coverage is accumulated, so it can only be reused while the playhead moves
  // forward. On a loop it has to be rebuilt from the start.
  const stampedTo = useRef(-1)

  useEffect(() => {
    raster.current = null
    fogged.current = null
    coverage.current = createCoverage(RASTER)
    stampedTo.current = -1
  }, [surface, runs, mode])

  const [index, setIndex] = useState(0)
  const raf = useRef(0)

  useEffect(() => {
    let last: number | null = null
    let t = 0
    const tick = (now: number) => {
      const delta = last === null ? 0 : Math.max(0, (now - last) / 1000)
      last = now
      t += delta * props.rate
      if (t > longest + props.rate * 2) t = 0
      setIndex(Math.min(longest - 1, Math.floor(t)))
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [props.rate, longest])

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, plot: { width: number; height: number }) => {
      if (!raster.current) {
        raster.current = rasteriseSurface(surface, RASTER, (w, h) => ctx.createImageData(w, h))
        fogged.current = ctx.createImageData(RASTER, RASTER)
      }
      const base = raster.current
      const out = fogged.current!

      // Window mode redraws coverage from nothing each frame; trail mode only
      // ever adds, so it stamps forward from wherever it got to and rebuilds
      // only when the loop wraps.
      if (mode === 'window') {
        clearCoverage(coverage.current)
        for (const run of runs) {
          stampCoverage(coverage.current, surface, at(run, index).position, { radius })
        }
      } else {
        if (index < stampedTo.current) {
          clearCoverage(coverage.current)
          stampedTo.current = -1
        }
        for (let k = stampedTo.current + 1; k <= index; k++) {
          for (const run of runs) {
            // A finished run stamps its final position again, which is a no-op
            // on an already-lit disc — cheaper than tracking which runs are
            // still going, and it keeps the loop branch-free.
            stampCoverage(coverage.current, surface, at(run, k).position, { radius })
          }
        }
        stampedTo.current = index
      }

      // Revealed keeps a little fog so the seen region is still legible as a
      // shape; zero would make the toggle look like it does nothing but brighten.
      applyFog(out, base.image, coverage.current, { strength: revealed ? 0.42 : 1 })

      drawSight(ctx, plot.width, plot.height, {
        surface,
        runs,
        index,
        out,
        seen: coverageFraction(coverage.current),
        showGradient: props.showGradient,
        mode,
        totalEvaluations,
      })
    },
    [surface, runs, index, radius, mode, revealed, props.showGradient, totalEvaluations],
  )

  const seenNow = coverageFraction(coverage.current)

  return (
    <div className="sight-figure">
      <div className="figure-controls">
        <div className="control-group" role="group" aria-label="What counts as seen">
          <button
            type="button"
            className={mode === 'trail' ? 'is-on' : ''}
            aria-pressed={mode === 'trail'}
            onClick={() => setMode('trail')}
          >
            Everywhere she has been
          </button>
          <button
            type="button"
            className={mode === 'window' ? 'is-on' : ''}
            aria-pressed={mode === 'window'}
            onClick={() => setMode('window')}
          >
            What she can see now
          </button>
        </div>
        <button
          type="button"
          className={revealed ? 'is-on' : ''}
          aria-pressed={revealed}
          onClick={() => setRevealed((v) => !v)}
        >
          {revealed ? 'Hide the landscape' : 'Show the landscape'}
        </button>
      </div>

      <ChartFrame
        height={props.height}
        margin={NO_MARGIN}
        draw={draw}
        description={
          `${runs.length === 1 ? 'A' : `${runs.length} independent runs of a`} ` +
          `${ALGORITHM_LABEL[props.algorithm]} searching ${surface.name}, with the map dark ` +
          `except where it has been sensed. After ${totalEvaluations} evaluations in total, ` +
          `${(seenNow * 100).toFixed(0)} per cent of the domain has been covered.`
        }
      />
    </div>
  )
}

/** A run that has finished holds its last position rather than disappearing. */
function at(run: readonly OptimizerState[], index: number): OptimizerState {
  return run[Math.min(index, run.length - 1)]!
}

interface SightInput {
  surface: Surface
  runs: readonly (readonly OptimizerState[])[]
  index: number
  out: ImageData
  seen: number
  showGradient: boolean
  mode: SightMode
  totalEvaluations: number
}

const sightScratch =
  typeof document === 'undefined' ? null : (document.createElement('canvas') as HTMLCanvasElement)

function drawSight(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  input: SightInput,
): void {
  const { surface, runs, index, out, seen, showGradient, mode, totalEvaluations } = input
  ctx.clearRect(0, 0, width, height)

  const readoutH = 34
  const size = Math.min(width, height - readoutH)
  const view = { x: (width - size) / 2, y: 0, size }

  if (sightScratch) {
    if (sightScratch.width !== out.width) {
      sightScratch.width = out.width
      sightScratch.height = out.height
    }
    const sctx = sightScratch.getContext('2d')
    if (sctx) {
      sctx.putImageData(out, 0, 0)
      ctx.drawImage(sightScratch, view.x, view.y, size, size)
    }
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(view.x, view.y, size, size)
  ctx.clip()

  // Her path, drawn only as far as the playhead. In window mode it is the one
  // thing that persists — she remembers where she walked even when the ground
  // behind her has gone dark again, which is exactly the distinction between
  // having been somewhere and being able to see it.
  const solo = runs.length === 1
  runs.forEach((run, r) => {
    const upto = Math.min(index, run.length - 1)
    const pts = run.slice(0, upto + 1).map((s) => toPlanPixel(surface, s.position, view))
    const colour = solo ? CKMarker.fill : agentSeries(Math.min(r, 3))

    if (pts.length > 1) {
      ctx.strokeStyle = withAlpha(colour, mode === 'window' ? 0.5 : 0.75)
      ctx.lineWidth = 1.4
      ctx.lineJoin = 'round'
      ctx.beginPath()
      pts.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.stroke()
    }

    const p = pts[pts.length - 1]
    if (!p) return
    ctx.beginPath()
    ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2)
    ctx.fillStyle = colour
    ctx.fill()
    ctx.strokeStyle = CKColor.void
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(p.x, p.y, 7.5, 0, Math.PI * 2)
    ctx.strokeStyle = CKColor.textBright
    ctx.lineWidth = 1
    ctx.stroke()
  })

  const lead = runs[0]!
  const here = toPlanPixel(surface, at(lead, index).position, view)
  {
    if (showGradient) {
      const g = surface.gradient(at(lead, index).position.x, at(lead, index).position.y)
      const mag = Math.hypot(g.x, g.y)
      if (mag > 1e-12) {
        // Fixed length. The magnitude is not the point — which way is up is —
        // and a magnitude-scaled arrow is invisible on a plain and off-screen
        // on a cliff, which is the complaint act two is about, not this one.
        const len = size * 0.075
        const dx = (g.x / mag) * len
        // Screen y is inverted relative to the domain.
        const dy = -(g.y / mag) * len
        ctx.strokeStyle = '#5FD8F0'
        ctx.lineWidth = 2.2
        ctx.beginPath()
        ctx.moveTo(here.x, here.y)
        ctx.lineTo(here.x + dx, here.y + dy)
        ctx.stroke()
        const a = Math.atan2(dy, dx)
        ctx.beginPath()
        ctx.moveTo(here.x + dx, here.y + dy)
        ctx.lineTo(here.x + dx - 7 * Math.cos(a - 0.4), here.y + dy - 7 * Math.sin(a - 0.4))
        ctx.moveTo(here.x + dx, here.y + dy)
        ctx.lineTo(here.x + dx - 7 * Math.cos(a + 0.4), here.y + dy - 7 * Math.sin(a + 0.4))
        ctx.stroke()
      }
    }

  }

  ctx.restore()

  ctx.strokeStyle = CKColor.border
  ctx.lineWidth = 1
  ctx.strokeRect(view.x + 0.5, view.y + 0.5, size - 1, size - 1)

  // The readout is the whole argument in one number: a search that looks busy
  // can have touched almost none of the world.
  ctx.font = `12.5px ${CANVAS_MONO}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = CKColor.textSecondary
  const label =
    runs.length === 1
      ? `hop ${Math.min(index, runs[0]!.length - 1)} of ${runs[0]!.length - 1}`
      : `${runs.length} runs, ${totalEvaluations} evaluations`
  ctx.fillText(label, view.x, size + 22)
  ctx.textAlign = 'right'
  ctx.fillStyle = seen < 0.25 ? CKColor.coralBright : CKColor.textBright
  ctx.fillText(`${(seen * 100).toFixed(0)}% of the map sensed`, view.x + size, size + 22)
}
