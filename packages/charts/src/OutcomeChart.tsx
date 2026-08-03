import { chartSeries } from '@contentkit/tokens'
import { clusterOptima, type EnsembleResult } from '@kangaroos/core'
import { useCallback, useMemo } from 'react'

import { ChartFrame } from './Chart.js'
import { clear, drawAxes, drawBars, type Bar } from './draw.js'
import { linearScale, type Plot } from './scale.js'

export interface SuccessChartProps {
  results: readonly { readonly label: string; readonly ensemble: EnsembleResult }[]
  height?: number
  width?: number
  title?: string
}

/**
 * How often each algorithm actually reached the global optimum.
 *
 * The counterweight to a convergence curve, which only ever shows a median and
 * so makes every method look competent. A run that converges confidently onto
 * the wrong summit contributes a fine-looking line and a zero here.
 *
 * Surfaces with tied optima report `successRate: null` from the core, because
 * the question is meaningless there — those are dropped with a note rather
 * than drawn as zero.
 */
export function SuccessChart({ results, height, width, title }: SuccessChartProps) {
  const usable = useMemo(
    () => results.filter((r) => r.ensemble.successRate !== null),
    [results],
  )
  const skipped = results.length - usable.length

  const bars: Bar[] = useMemo(
    () =>
      usable.map((r, i) => ({
        label: r.label,
        value: r.ensemble.successRate! * 100,
        color: chartSeries(i),
      })),
    [usable],
  )

  const h = height ?? Math.max(120, 44 + bars.length * 34)

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, plot: Plot) => {
      // Fixed 0–100 domain. Scaling to the observed maximum would make 4% fill
      // the plot and read as success.
      const x = linearScale(
        { min: 0, max: 100 },
        { min: plot.inner.x, max: plot.inner.x + plot.inner.w - 44 },
      )
      clear(ctx, plot)
      drawAxes(ctx, plot, x, x, {
        xLabel: '% of runs reaching the global optimum',
        grid: false,
        yAxis: false,
      })
      drawBars(ctx, plot, x, bars, { valueFormat: (v) => `${v.toFixed(0)}%` })
    },
    [bars],
  )

  return (
    <ChartFrame
      width={width}
      height={h}
      margin={{ top: 10, right: 16, bottom: 34, left: 132 }}
      title={title}
      draw={draw}
      description={
        `Share of runs that reached the global optimum. ` +
        bars.map((b) => `${b.label} ${b.value.toFixed(0)}%`).join(', ') +
        (skipped > 0
          ? `. ${skipped} surface${skipped > 1 ? 's' : ''} omitted: their optima are tied, so a success rate is undefined.`
          : '.')
      }
    />
  )
}

export interface BasinChartProps {
  ensemble: EnsembleResult
  /** Clustering radius in domain units. */
  radius: number
  height?: number
  width?: number
  title?: string
}

/**
 * Which summit each run ended on.
 *
 * The figure Himmelblau needs. Its four maxima are all worth exactly zero, so
 * every run "succeeds" and a success-rate bar says 100% and nothing else — the
 * interesting result is that those runs are spread across four different
 * basins, which only clustering the final positions can show.
 */
export function BasinChart({ ensemble, radius, height, width, title }: BasinChartProps) {
  const clusters = useMemo(() => clusterOptima(ensemble, radius), [ensemble, radius])

  const bars: Bar[] = useMemo(
    () =>
      clusters.map((c, i) => ({
        label: `(${c.position.x.toFixed(1)}, ${c.position.y.toFixed(1)})`,
        value: c.share * 100,
        // Colour by rank here rather than by identity: a basin has no stable
        // identity across ensembles, so there is nothing for a hue to track.
        // The scale runs out past five, which is itself a signal the radius is
        // too small and the clustering has fragmented.
        color: chartSeries(Math.min(i, 4)),
      })),
    [clusters],
  )

  const h = height ?? Math.max(120, 44 + bars.length * 32)

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, plot: Plot) => {
      const x = linearScale(
        { min: 0, max: 100 },
        { min: plot.inner.x, max: plot.inner.x + plot.inner.w - 44 },
      )
      clear(ctx, plot)
      drawAxes(ctx, plot, x, x, { xLabel: '% of runs ending here', grid: false, yAxis: false })
      drawBars(ctx, plot, x, bars, { valueFormat: (v) => `${v.toFixed(0)}%` })
    },
    [bars],
  )

  return (
    <ChartFrame
      width={width}
      height={h}
      margin={{ top: 10, right: 16, bottom: 34, left: 132 }}
      title={title}
      draw={draw}
      description={
        `Distribution of final positions across ${clusters.length} distinct summit` +
        `${clusters.length === 1 ? '' : 's'} on ${ensemble.surface}: ` +
        clusters
          .map((c) => `(${c.position.x.toFixed(1)}, ${c.position.y.toFixed(1)}) ${(c.share * 100).toFixed(0)}%`)
          .join(', ') +
        '.'
      }
    />
  )
}
