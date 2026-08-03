/**
 * Scales and layout arithmetic, free of canvas and React.
 *
 * Same split as the scene package: the maths is where the off-by-ones live, so
 * it is testable in Node without a rendering context.
 */

export interface Extent {
  readonly min: number
  readonly max: number
}

export interface Scale {
  /** Data value to pixel. */
  (value: number): number
  readonly domain: Extent
  readonly range: Extent
  /** Pixel back to data value. Needed for hover. */
  readonly invert: (pixel: number) => number
}

export function linearScale(domain: Extent, range: Extent): Scale {
  // A zero-width domain would divide by zero and put every mark at NaN; pin it
  // to the middle of the range instead, which is what a constant series means.
  const span = domain.max - domain.min
  const flat = !(span > 0)

  const fn = ((value: number) => {
    if (!Number.isFinite(value)) return NaN
    const t = flat ? 0.5 : (value - domain.min) / span
    return range.min + t * (range.max - range.min)
  }) as { (v: number): number; domain: Extent; range: Extent; invert: (p: number) => number }

  fn.domain = domain
  fn.range = range
  fn.invert = (pixel: number) => {
    const t = (pixel - range.min) / (range.max - range.min)
    return flat ? domain.min : domain.min + t * span
  }
  return fn as Scale
}

/** Extent of finite values, or null if there are none. */
export function extentOf(values: Iterable<number>): Extent | null {
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  return Number.isFinite(min) ? { min, max } : null
}

/** Pad an extent by a fraction of its span, so marks don't touch the frame. */
export function padExtent(e: Extent, fraction = 0.06): Extent {
  const span = e.max - e.min
  // A flat extent has no span to take a fraction of; open a unit window instead
  // so a constant series draws as a line through the middle rather than a
  // zero-height strip on the axis.
  if (!(span > 0)) return { min: e.min - 0.5, max: e.max + 0.5 }
  return { min: e.min - span * fraction, max: e.max + span * fraction }
}

/**
 * Tick values at human-readable intervals inside a domain.
 *
 * The 1/2/5/10 progression, which is what makes an axis readable — arbitrary
 * even divisions give you gridlines at 3.7143 and nobody can use those.
 */
export function niceTicks(domain: Extent, target = 5): number[] {
  const span = domain.max - domain.min
  if (!(span > 0) || !Number.isFinite(span)) return [domain.min]

  const rough = span / Math.max(1, target)
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)))
  const normalized = rough / magnitude
  const step = (normalized >= 5 ? 10 : normalized >= 2 ? 5 : normalized >= 1 ? 2 : 1) * magnitude

  // Round to the decimals the step implies, not to a multiple of the step.
  // Snapping to a multiple looks like it fixes the accumulation but cannot:
  // the step is itself a float, so 3 * 0.2 is 0.6000000000000001 either way,
  // and that number reaches the axis as a label.
  const decimals = Math.max(0, Math.min(12, -Math.floor(Math.log10(step)) + 1))

  const ticks: number[] = []
  const first = Math.ceil(domain.min / step) * step
  for (let v = first; v <= domain.max + step * 1e-9; v += step) {
    ticks.push(Number(v.toFixed(decimals)))
  }
  return ticks
}

/** Format a tick for display, given the step size implied by its neighbours. */
export function formatTick(value: number, ticks: readonly number[]): string {
  if (!Number.isFinite(value)) return ''
  const step = ticks.length > 1 ? Math.abs(ticks[1]! - ticks[0]!) : Math.abs(value) || 1
  const decimals = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step)) + (step < 1 ? 0 : 0)))
  if (Math.abs(value) >= 10000) return value.toExponential(1)
  return value.toFixed(Number.isFinite(decimals) ? decimals : 0)
}

export interface Margin {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export interface Plot {
  readonly width: number
  readonly height: number
  readonly margin: Margin
  /** Drawable area, inside the margins. */
  readonly inner: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
}

export const DEFAULT_MARGIN: Margin = { top: 16, right: 16, bottom: 34, left: 52 }

export function layout(width: number, height: number, margin: Margin = DEFAULT_MARGIN): Plot {
  return {
    width,
    height,
    margin,
    inner: {
      x: margin.left,
      y: margin.top,
      // Never negative: a chart briefly laid out at zero width during mount
      // would otherwise produce inverted scales and NaN marks.
      w: Math.max(0, width - margin.left - margin.right),
      h: Math.max(0, height - margin.top - margin.bottom),
    },
  }
}

/** Index of the datum nearest a pixel x, for crosshair hover. */
export function nearestIndex(scale: Scale, xs: readonly number[], pixel: number): number {
  if (xs.length === 0) return -1
  const target = scale.invert(pixel)
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs(xs[i]! - target)
    if (d < bestDistance) {
      bestDistance = d
      best = i
    }
  }
  return best
}
