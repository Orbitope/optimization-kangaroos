import { chartSeries } from '@contentkit/tokens'
import { quantileBands, type EnsembleResult } from '@kangaroos/core'
import { useCallback, useMemo, useState } from 'react'

import { ChartFrame, ChartTooltip } from './Chart.js'
import { clear, drawAxes, drawBand, drawCrosshair, drawLine } from './draw.js'
import { extentOf, linearScale, nearestIndex, padExtent, type Plot } from './scale.js'

export interface ConvergenceSeries {
  readonly label: string
  readonly ensemble: EnsembleResult
}

export interface ConvergenceChartProps {
  series: readonly ConvergenceSeries[]
  height?: number
  width?: number
  /**
   * Last step to show. Omit to auto-trim to where the search actually happens.
   *
   * Without this the chart is dominated by dead space: annealing runs 2000
   * steps on a surface every method has finished with by step 30, so the
   * interesting part is a vertical line at the origin and the rest is flat.
   */
  maxStep?: number
  /** Reveal the run up to this step, for animated figures and video. */
  revealStep?: number
  title?: string
}

/**
 * Best-so-far altitude against step, as a median line with an interquartile
 * band, one colour per algorithm.
 *
 * A band rather than every run drawn faintly: with thirty seeds the spaghetti
 * is unreadable, and the question a reader has is "how does this usually go",
 * which is a quantile question. The band is the spread and the line is the
 * typical run.
 *
 * `revealStep` exists so the same component serves a static figure, a scrubber,
 * and a Remotion render — nothing here owns a clock.
 */
export function ConvergenceChart({
  series,
  height = 260,
  width,
  maxStep,
  revealStep,
  title,
}: ConvergenceChartProps) {
  const [hover, setHover] = useState<{ x: number; y: number; index: number } | null>(null)

  const bands = useMemo(() => {
    const all = series.map((s) => quantileBands(s.ensemble))
    const cutoff = maxStep ?? autoTrim(all)
    return all.map((b) => b.filter((p) => p.step <= cutoff))
  }, [series, maxStep])

  const domains = useMemo(() => {
    const steps = bands.flatMap((b) => b.map((p) => p.step))
    // Bound by the band edges, not the median — otherwise the shaded region
    // spills past the axis and gets clipped mid-figure.
    const values = bands.flatMap((b) => b.flatMap((p) => [p.lower, p.upper]))
    return {
      x: extentOf(steps) ?? { min: 0, max: 1 },
      y: padExtent(extentOf(values) ?? { min: 0, max: 1 }),
    }
  }, [bands])

  const cut = revealStep ?? Infinity

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, plot: Plot) => {
      const x = linearScale(domains.x, { min: plot.inner.x, max: plot.inner.x + plot.inner.w })
      const y = linearScale(domains.y, { min: plot.inner.y + plot.inner.h, max: plot.inner.y })

      clear(ctx, plot)
      drawAxes(ctx, plot, x, y, { xLabel: 'step', yLabel: 'best altitude so far' })

      bands.forEach((band, i) => {
        const visible = band.filter((p) => p.step <= cut)
        const color = chartSeries(i)
        drawBand(
          ctx,
          x,
          y,
          // QuantileBand keys its abscissa `step`; drawBand is generic over any
          // x-valued series, so adapt rather than special-casing the primitive.
          visible.map((p) => ({ x: p.step, lower: p.lower, upper: p.upper })),
          color,
        )
        drawLine(
          ctx,
          x,
          y,
          visible.map((p) => ({ x: p.step, y: p.median })),
          color,
        )
      })

      if (hover) {
        drawCrosshair(
          ctx,
          plot,
          x(bands[0]?.[hover.index]?.step ?? 0),
          bands.map((b, i) => ({ y: y(b[Math.min(hover.index, b.length - 1)]?.median ?? NaN), color: chartSeries(i) })),
        )
      }
    },
    [bands, domains, cut, hover],
  )

  const onHover = useCallback(
    (point: { x: number; y: number } | null, plot: Plot) => {
      if (!point || bands.length === 0) return setHover(null)
      const x = linearScale(domains.x, { min: plot.inner.x, max: plot.inner.x + plot.inner.w })
      const steps = bands[0]!.map((b) => b.step)
      const index = nearestIndex(x, steps, point.x)
      setHover(index < 0 ? null : { x: point.x, y: point.y, index })
    },
    [bands, domains],
  )

  const legend = series.map((s, i) => ({ label: s.label, color: chartSeries(i) }))

  const description = series
    .map((s) => {
      const runs = s.ensemble.runs
      const final = runs.reduce((acc, r) => acc + r.bestValue, 0) / runs.length
      return `${s.label}: ${runs.length} runs, mean final altitude ${final.toFixed(2)}`
    })
    .join('. ')

  return (
    <ChartFrame
      width={width}
      height={height}
      title={title}
      draw={draw}
      onHover={onHover}
      legend={legend}
      description={`Best altitude reached so far against search step, median with interquartile range. ${description}.`}
      overlay={
        hover && (
          <ChartTooltip x={hover.x} y={hover.y} plot={{ ...tooltipPlot(width, height) }}>
            <div style={{ opacity: 0.7, marginBottom: 2 }}>
              step {bands[0]?.[hover.index]?.step ?? 0}
            </div>
            {series.map((s, i) => {
              const b = bands[i]?.[Math.min(hover.index, (bands[i]?.length ?? 1) - 1)]
              return (
                <div key={s.label}>
                  <span style={{ color: chartSeries(i) }}>■</span> {s.label}{' '}
                  {b ? b.median.toFixed(3) : '—'}
                </div>
              )
            })}
          </ChartTooltip>
        )
      }
    />
  )
}

/**
 * The last step worth drawing.
 *
 * Takes the point at which the slowest series' median has covered 99.5% of the
 * ground it will ever cover, then adds a fifth again so the reader can see the
 * curve has genuinely flattened rather than been cropped mid-climb.
 */
function autoTrim(all: readonly (readonly { step: number; median: number }[])[]): number {
  let latest = 0
  for (const band of all) {
    if (band.length < 2) continue
    const start = band[0]!.median
    const end = band[band.length - 1]!.median
    const span = end - start
    if (!(span > 0)) {
      // A series that never improves has no interesting region; let the others
      // set the window rather than forcing the whole run into view.
      continue
    }
    const target = start + span * 0.995
    const reached = band.find((p) => p.median >= target)
    latest = Math.max(latest, reached ? reached.step : band[band.length - 1]!.step)
  }
  const longest = Math.max(...all.map((b) => b[b.length - 1]?.step ?? 0), 1)
  return latest > 0 ? Math.min(longest, Math.ceil(latest * 1.2)) : longest
}

// The tooltip only needs width/height for edge flipping; rebuilding the full
// layout here would mean threading the measured width back out of ChartFrame.
function tooltipPlot(width: number | undefined, height: number) {
  return {
    width: width ?? 640,
    height,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    inner: { x: 0, y: 0, w: width ?? 640, h: height },
  }
}
