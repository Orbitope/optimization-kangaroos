/**
 * Canvas drawing primitives that encode the house mark specs in one place.
 *
 * Everything recessive is drawn first and dim; data is drawn last and bright.
 * Keeping these here rather than inline in each chart is what stops the third
 * chart from quietly having thicker gridlines than the first.
 */

import { CKColor, withAlpha } from '@contentkit/tokens'

import { formatTick, niceTicks, type Plot, type Scale } from './scale.js'

export interface AxisOptions {
  readonly xLabel?: string
  readonly yLabel?: string
  readonly xTicks?: number
  readonly yTicks?: number
  /** Draw horizontal gridlines. Vertical ones are almost always noise. */
  readonly grid?: boolean
  /**
   * Draw the y axis at all. Off for bar charts, where the categories are
   * labelled directly on each bar and a numeric y axis is meaningless.
   */
  readonly yAxis?: boolean
  readonly font?: string
}

const TICK_FONT = '11px "IBM Plex Mono", ui-monospace, monospace'
const LABEL_FONT = '11px "IBM Plex Sans", system-ui, sans-serif'

export function clear(ctx: CanvasRenderingContext2D, plot: Plot): void {
  ctx.clearRect(0, 0, plot.width, plot.height)
}

/**
 * Grid, ticks and axis labels.
 *
 * Gridlines sit at 10% alpha and only on the value axis. They exist to let you
 * read a magnitude off the chart, not to make a graph-paper background — at
 * full strength they compete with the data for attention and win.
 */
export function drawAxes(
  ctx: CanvasRenderingContext2D,
  plot: Plot,
  x: Scale,
  y: Scale,
  options: AxisOptions = {},
): void {
  const { inner } = plot
  const xt = niceTicks(x.domain, options.xTicks ?? 5)
  const yt = niceTicks(y.domain, options.yTicks ?? 5)

  ctx.save()
  ctx.font = options.font ?? TICK_FONT
  ctx.textBaseline = 'middle'

  const wantY = options.yAxis !== false

  if (options.grid !== false && wantY) {
    ctx.strokeStyle = withAlpha(CKColor.textMuted, 0.16)
    ctx.lineWidth = 1
    for (const t of yt) {
      // Half-pixel offset, or a 1px line straddles two device rows and renders
      // as a 2px smear.
      const py = Math.round(y(t)) + 0.5
      if (py < inner.y || py > inner.y + inner.h) continue
      ctx.beginPath()
      ctx.moveTo(inner.x, py)
      ctx.lineTo(inner.x + inner.w, py)
      ctx.stroke()
    }
  }

  ctx.fillStyle = CKColor.textMuted
  if (wantY) {
    ctx.textAlign = 'right'
    for (const t of yt) {
      const py = y(t)
      if (py < inner.y - 1 || py > inner.y + inner.h + 1) continue
      ctx.fillText(formatTick(t, yt), inner.x - 8, py)
    }
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const t of xt) {
    const px = x(t)
    if (px < inner.x - 1 || px > inner.x + inner.w + 1) continue
    ctx.fillText(formatTick(t, xt), px, inner.y + inner.h + 8)
  }

  ctx.font = LABEL_FONT
  ctx.fillStyle = CKColor.textSecondary
  if (options.xLabel) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText(options.xLabel, inner.x + inner.w / 2, plot.height - 2)
  }
  if (options.yLabel) {
    ctx.save()
    ctx.translate(11, inner.y + inner.h / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(options.yLabel, 0, 0)
    ctx.restore()
  }
  ctx.restore()
}

/** A 2px polyline. Non-finite points break the line rather than spiking to zero. */
export function drawLine(
  ctx: CanvasRenderingContext2D,
  x: Scale,
  y: Scale,
  points: readonly { readonly x: number; readonly y: number }[],
  color: string,
  width = 2,
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()

  let open = false
  for (const p of points) {
    const px = x(p.x)
    const py = y(p.y)
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      open = false
      continue
    }
    if (open) ctx.lineTo(px, py)
    else {
      ctx.moveTo(px, py)
      open = true
    }
  }
  ctx.stroke()
  ctx.restore()
}

/**
 * A filled band between two series — an interquartile range or similar.
 *
 * Drawn at low alpha under the median line. The band is context; the line is
 * the reading, and it has to stay the brighter of the two.
 */
export function drawBand(
  ctx: CanvasRenderingContext2D,
  x: Scale,
  y: Scale,
  points: readonly { readonly x: number; readonly lower: number; readonly upper: number }[],
  color: string,
  alpha = 0.18,
): void {
  const usable = points.filter(
    (p) => Number.isFinite(p.x) && Number.isFinite(p.lower) && Number.isFinite(p.upper),
  )
  if (usable.length < 2) return

  ctx.save()
  ctx.fillStyle = withAlpha(color, alpha)
  ctx.beginPath()
  usable.forEach((p, i) => {
    const px = x(p.x)
    const py = y(p.upper)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  })
  for (let i = usable.length - 1; i >= 0; i--) {
    ctx.lineTo(x(usable[i]!.x), y(usable[i]!.lower))
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

export interface Bar {
  readonly label: string
  readonly value: number
  readonly color: string
}

/**
 * Horizontal bars with rounded data-ends.
 *
 * Only the value end is rounded — the baseline end stays square, because a
 * rounded corner at the origin reads as the bar starting somewhere other than
 * zero. A 2px surface-coloured gap separates neighbours so adjacent bars of
 * similar colour do not merge into one block.
 */
export function drawBars(
  ctx: CanvasRenderingContext2D,
  plot: Plot,
  x: Scale,
  bars: readonly Bar[],
  options: { readonly valueFormat?: (v: number) => string; readonly labelWidth?: number } = {},
): void {
  const { inner } = plot
  if (bars.length === 0) return

  const slot = inner.h / bars.length
  const thickness = Math.max(6, Math.min(26, slot - 8))
  const radius = 4
  const format = options.valueFormat ?? ((v: number) => v.toFixed(2))
  const zero = x(Math.max(0, x.domain.min))

  ctx.save()
  bars.forEach((bar, i) => {
    const cy = inner.y + slot * (i + 0.5)
    const top = cy - thickness / 2
    const end = x(bar.value)
    const w = Math.max(0, end - zero)

    ctx.fillStyle = bar.color
    ctx.beginPath()
    if (typeof ctx.roundRect === 'function' && w > radius) {
      ctx.roundRect(zero, top, w, thickness, [0, radius, radius, 0])
    } else {
      ctx.rect(zero, top, w, thickness)
    }
    ctx.fill()

    // Value, in ink rather than in the series colour — text never wears the
    // mark's hue, or the number starts competing to be a legend.
    ctx.font = TICK_FONT
    ctx.fillStyle = CKColor.textBright
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(format(bar.value), end + 8, cy)

    ctx.fillStyle = CKColor.textSecondary
    ctx.textAlign = 'right'
    ctx.fillText(bar.label, inner.x - 8, cy)
  })
  ctx.restore()
}

/** Crosshair and marker dots at a hovered index. */
export function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  plot: Plot,
  px: number,
  marks: readonly { readonly y: number; readonly color: string }[],
): void {
  const { inner } = plot
  ctx.save()
  ctx.strokeStyle = withAlpha(CKColor.textBright, 0.35)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(Math.round(px) + 0.5, inner.y)
  ctx.lineTo(Math.round(px) + 0.5, inner.y + inner.h)
  ctx.stroke()

  for (const m of marks) {
    if (!Number.isFinite(m.y)) continue
    // A surface-coloured ring so a dot landing on a line of the same hue still
    // reads as a separate mark.
    ctx.beginPath()
    ctx.arc(px, m.y, 5, 0, Math.PI * 2)
    ctx.fillStyle = CKColor.surface
    ctx.fill()
    ctx.beginPath()
    ctx.arc(px, m.y, 3.5, 0, Math.PI * 2)
    ctx.fillStyle = m.color
    ctx.fill()
  }
  ctx.restore()
}
