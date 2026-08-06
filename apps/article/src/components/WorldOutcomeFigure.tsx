import { CKColor, CKMarker } from '@contentkit/tokens'
import {
  collect,
  hillClimber,
  mulberry32,
  simulatedAnnealing,
  type Surface,
  type Vec2,
} from '@kangaroos/core'
import {
  CANVAS_DISPLAY,
  CANVAS_MONO,
  ChartFrame,
  rasteriseSurface,
  type PlanRaster,
} from '@kangaroos/charts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useDemSurface } from '../lib/dem.js'
import { NearViewport } from './Figure.js'

/**
 * Where sixty kangaroos end up on Earth, under settings shown side by side.
 *
 * Small-multiple maps rather than a bar chart of outcomes, for a reason worth
 * stating: the categories here are *places*. At fast cooling the runs finish on
 * twenty-one separate highlands, which is more than any categorical palette can
 * separate and more than a legend can carry — but on a map they need neither,
 * because a ring on the west coast of South America is the Andes and nobody has
 * to be told. The geography is the legend.
 *
 * It is also the only form that shows the actual claim. The argument is not
 * "slower cooling scores higher", which a line chart would show; it is that the
 * outcomes *collapse from everywhere onto one place*, and collapse is spatial.
 */

/** A domain-space window, for panels that zoom in. */
export interface Zoom {
  readonly x: number
  readonly y: number
  /** Half-width in domain metres. The height follows the panel's aspect. */
  readonly halfSpan: number
}

export interface OutcomePanel {
  readonly label: string
  readonly note?: string
  /** Defaults to annealing. The blind climber is here as the control. */
  readonly algorithm?: 'annealing' | 'hill-climber'
  readonly cooling?: number
  /** Hop length, as a fraction of the domain diagonal. */
  readonly hop?: number
  readonly proposalDecay?: number
}

export interface WorldOutcomeFigureProps {
  panels: readonly OutcomePanel[]
  runs?: number
  steps?: number
  columns?: number
  /** Crop every panel to a window, for claims a whole planet cannot show. */
  zoom?: Zoom
  /** Ring the true summit. Only meaningful zoomed in far enough to see it. */
  markSummit?: boolean
  caption?: string
}

export function WorldOutcomeFigure(props: WorldOutcomeFigureProps) {
  return (
    <figure className="figure">
      {/*
        Matches the height floor below. Any larger and a two-panel figure —
        which sizes itself to about 340 — gets a band of empty plate under it,
        because the reservation, not the content, is setting the height.
      */}
      <NearViewport minHeight={240}>
        <WorldOutcomeBody {...props} />
      </NearViewport>
      {props.caption && <figcaption className="figure-caption">{props.caption}</figcaption>}
    </figure>
  )
}

/** Space under each map for its label and its two numbers. */
const LABEL_SPACE = 46
const GAP = 22
/** The world's own aspect: 40,075 km by 18,798 km. */
const MAP_ASPECT = 40075 / 18798

interface Outcome extends OutcomePanel {
  readonly landings: readonly Vec2[]
  readonly meanBest: number
  readonly highlands: number
  /**
   * Runs whose best altitude was below sea level.
   *
   * Only a real landscape can produce this number, and it is the sharpest
   * single thing the whole-Earth figure says: a blind climber dropped at
   * random on this planet mostly lands in an ocean, where there is no uphill
   * to find and nothing a better step size can do about it.
   */
  readonly drowned: number
}

/**
 * How many distinct highlands the runs finished on.
 *
 * Clustered by distance rather than looked up in a gazetteer: two runs that
 * ended 200 km apart are on the same massif for the purposes of this argument,
 * and a table of named ranges would put a lot of editorial judgement behind a
 * number that only exists to be compared with the one next to it.
 */
function countHighlands(landings: readonly Vec2[], radius: number): number {
  const centres: Vec2[] = []
  for (const p of landings) {
    if (!centres.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < radius)) centres.push(p)
  }
  return centres.length
}

function WorldOutcomeBody({
  panels,
  runs = 60,
  steps = 2200,
  columns,
  zoom,
  markSummit = false,
}: WorldOutcomeFigureProps) {
  const region = useDemSurface('world')
  const surface = region?.surface ?? null

  /*
   * The figure's height is a consequence of its width, not a prop.
   *
   * Maps of a fixed 2.13:1 planet in a grid — so once the column count and the
   * available width are known, the height that packs them without slack is
   * arithmetic. Guessing it leaves a band of empty plate under every row at
   * most widths, and crops at the rest.
   */
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // One column on a phone. Two world maps at 380px wide are two green smears,
  // and the whole figure depends on recognising South America.
  const cols = columns ?? (width > 0 && width < 620 ? 1 : 2)

  const outcomes = useMemo<readonly Outcome[]>(() => {
    if (!surface) return []
    const { xMin, xMax, yMin, yMax } = surface.domain
    const diagonal = Math.hypot(xMax - xMin, yMax - yMin)

    return panels.map((panel) => {
      const landings: Vec2[] = []
      let total = 0
      let drowned = 0
      for (let seed = 1; seed <= runs; seed++) {
        const rng = mulberry32(seed)
        const states = collect(
          panel.algorithm === 'hill-climber'
            ? hillClimber(surface, rng, { maxSteps: steps })
            : simulatedAnnealing(surface, rng, {
                maxSteps: steps,
                cooling: panel.cooling ?? 0.999,
                ...(panel.hop === undefined ? {} : { proposalScale: diagonal * panel.hop }),
                proposalDecay: panel.proposalDecay ?? 1,
              }),
        )
        const best = states[states.length - 1]!.best
        landings.push(best.position)
        total += best.value
        if (best.value < (surface.seaLevel ?? 0)) drowned++
      }
      return {
        ...panel,
        landings,
        meanBest: total / runs,
        // 900 km: wide enough that the Karakoram and the Himalaya count once,
        // narrow enough to keep the Andes and the Rockies apart.
        highlands: countHighlands(landings, 900_000),
        drowned,
      }
    })
  }, [surface, panels, runs, steps])

  const raster = useRef<PlanRaster | null>(null)

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, plot: { width: number; height: number }) => {
      ctx.clearRect(0, 0, plot.width, plot.height)
      if (!surface || outcomes.length === 0) return

      if (!raster.current) {
        // The floor quantile earns its keep on a planet: two thirds of the
        // surface is sea floor, and letting it have two thirds of the ramp
        // leaves every continent the same shade of brown.
        raster.current = rasteriseSurface(surface, 512, (w, h) => ctx.createImageData(w, h), {
          floorQuantile: 0.62,
        })
      }
      const map = raster.current

      const cellW = (plot.width - GAP * (cols - 1)) / cols
      const h = cellW / MAP_ASPECT

      outcomes.forEach((outcome, i) => {
        drawPanel(ctx, surface, map, outcome, zoom, markSummit, {
          x: (i % cols) * (cellW + GAP),
          y: Math.floor(i / cols) * (h + LABEL_SPACE + GAP),
          width: cellW,
          height: h,
        })
      })
    },
    [surface, outcomes, cols, zoom, markSummit],
  )

  const rows = Math.ceil((outcomes.length || panels.length) / cols)
  const cellW = width > 0 ? (width - GAP * (cols - 1)) / cols : 0
  const height = Math.max(
    240,
    Math.round(rows * (cellW / MAP_ASPECT + LABEL_SPACE) + GAP * (rows - 1)),
  )

  if (!surface) {
    return (
      <div className="scene-loading" ref={wrap} style={{ height }}>
        <span>Loading terrain…</span>
      </div>
    )
  }

  return (
    <div ref={wrap}>
      <ChartFrame
        height={height}
        draw={draw}
        description={
          `Maps showing where ${runs} simulated-annealing runs finished under ` +
          `${outcomes.length} settings. ` +
          outcomes
            .map(
              (o) =>
                `${o.label}: ${o.highlands} separate highlands, ` +
                `${Math.round(o.meanBest)} metres on average` +
                (o.drowned ? `, and ${o.drowned} of ${runs} ended below sea level.` : '.'),
            )
            .join(' ')
        }
      />
    </div>
  )
}

interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

function drawPanel(
  ctx: CanvasRenderingContext2D,
  surface: Surface,
  map: PlanRaster,
  outcome: Outcome,
  zoom: Zoom | undefined,
  markSummit: boolean,
  view: Rect,
) {
  const d = surface.domain
  // The domain window this panel shows. Unzoomed, that is the whole planet.
  const halfX = zoom ? zoom.halfSpan : (d.xMax - d.xMin) / 2
  const halfY = halfX / MAP_ASPECT
  const cx = zoom ? zoom.x : (d.xMin + d.xMax) / 2
  const cy = zoom ? zoom.y : (d.yMin + d.yMax) / 2

  const toPixel = (p: Vec2) => ({
    x: view.x + ((p.x - (cx - halfX)) / (halfX * 2)) * view.width,
    y: view.y + (1 - (p.y - (cy - halfY)) / (halfY * 2)) * view.height,
  })

  /*
   * Blit through an offscreen canvas.
   *
   * `putImageData` ignores the transform, so it can neither scale nor crop —
   * and both are needed here: the raster is 512 wide against a panel around
   * 400, and a zoomed panel is a sub-rectangle of it.
   */
  const scratch = document.createElement('canvas')
  scratch.width = map.width
  scratch.height = map.height
  scratch.getContext('2d')!.putImageData(map.image, 0, 0)

  const sx = ((cx - halfX - d.xMin) / (d.xMax - d.xMin)) * map.width
  const sw = ((halfX * 2) / (d.xMax - d.xMin)) * map.width
  const sy = ((d.yMax - (cy + halfY)) / (d.yMax - d.yMin)) * map.height
  const sh = ((halfY * 2) / (d.yMax - d.yMin)) * map.height

  ctx.save()
  ctx.beginPath()
  ctx.rect(view.x, view.y, view.width, view.height)
  ctx.clip()
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(scratch, sx, sy, sw, sh, view.x, view.y, view.width, view.height)

  /*
   * A drowned kangaroo is drawn as a cross rather than a ring.
   *
   * Colour alone would not carry it — steel on a dark ocean is nearly
   * invisible, which is the opposite of the point — and the shape reads at
   * four pixels where a hue does not.
   */
  const seaLevel = surface.seaLevel ?? 0

  /*
   * Landings as translucent rings, not filled dots.
   *
   * Sixty runs at slow cooling all finish within a few hundred kilometres of
   * each other, which at planet scale is the same handful of pixels. Filled
   * marks stack into one opaque blob and the two panels that matter most look
   * identical. Rings overlap legibly, and the density of the overlap is itself
   * the reading.
   */
  ctx.globalAlpha = 0.75
  ctx.strokeStyle = CKMarker.fill
  ctx.lineWidth = 1.6
  const r = zoom ? 5 : 4
  for (const p of outcome.landings) {
    const { x, y } = toPixel(p)
    ctx.beginPath()
    if (surface.height(p.x, p.y) < seaLevel) {
      ctx.moveTo(x - r, y - r)
      ctx.lineTo(x + r, y + r)
      ctx.moveTo(x + r, y - r)
      ctx.lineTo(x - r, y + r)
    } else {
      ctx.arc(x, y, r, 0, Math.PI * 2)
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1

  // The thing being aimed at, when the panel is close enough to show it.
  if (markSummit && surface.globalOptimum) {
    const { x, y } = toPixel(surface.globalOptimum)
    ctx.strokeStyle = CKColor.textBright
    ctx.lineWidth = 1.4
    ctx.beginPath()
    ctx.arc(x, y, 9, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x - 14, y)
    ctx.lineTo(x - 5, y)
    ctx.moveTo(x + 5, y)
    ctx.lineTo(x + 14, y)
    ctx.moveTo(x, y - 14)
    ctx.lineTo(x, y - 5)
    ctx.moveTo(x, y + 5)
    ctx.lineTo(x, y + 14)
    ctx.stroke()
  }
  ctx.restore()

  ctx.strokeStyle = CKColor.border
  ctx.lineWidth = 1
  ctx.strokeRect(view.x + 0.5, view.y + 0.5, view.width - 1, view.height - 1)

  // ── the label ────────────────────────────────────────────────────────────
  const baseline = view.y + view.height + 18
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  ctx.font = `600 13px ${CANVAS_DISPLAY}`
  ctx.fillStyle = CKColor.textBright
  ctx.fillText(outcome.label.toUpperCase(), view.x, baseline)

  ctx.font = `11.5px ${CANVAS_MONO}`
  ctx.fillStyle = CKColor.textSecondary
  ctx.fillText(
    outcome.note ??
      (outcome.drowned
        ? `${outcome.drowned} drowned · ${Math.round(outcome.meanBest)} m average`
        : `${outcome.highlands} separate highlands · ${Math.round(outcome.meanBest)} m average`),
    view.x,
    baseline + 16,
  )
}
