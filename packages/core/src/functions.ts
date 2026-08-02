/**
 * Standard optimization benchmark surfaces, all sign-flipped to maximization
 * so that higher is better — the convention the email establishes and the 2019
 * `components/functions.js` started.
 *
 * Every function here was reverified against its reference definition. The
 * 2019 versions had drifted: Griewank summed its cosines where the standard
 * form takes their product, Eggholder's parentheses nested the second term
 * inside the first `sin`, Ackley referenced an undefined decay constant, and
 * Griewank, Schwefel and Shubert were never negated, so they were being
 * minimized while everything around them maximized.
 */

import { AnalyticSurface, square, type Vec2 } from './surface.js'

const TAU = Math.PI * 2

/**
 * Ackley. A vast, almost-flat plain dimpled with local optima, hiding one
 * narrow spike at the origin — the canonical "you will never find this by
 * following the slope" surface. Global max 0 at (0, 0).
 */
export const ackley = new AnalyticSurface({
  name: 'Ackley',
  domain: square(-32.768, 32.768),
  globalOptimum: { x: 0, y: 0, height: 0 },
  f(x, y) {
    const r = Math.sqrt(0.5 * (x * x + y * y))
    const s = 0.5 * (Math.cos(TAU * x) + Math.cos(TAU * y))
    return -(-20 * Math.exp(-0.2 * r) - Math.exp(s) + 20 + Math.E)
  },
  grad(x, y): Vec2 {
    const r = Math.sqrt(0.5 * (x * x + y * y))
    const s = 0.5 * (Math.cos(TAU * x) + Math.cos(TAU * y))
    const es = Math.exp(s)
    // The exponential term has a genuine kink at the origin; its one-sided
    // limits disagree, so report a flat summit rather than a NaN.
    const decay = r === 0 ? 0 : (2 * Math.exp(-0.2 * r)) / r
    return {
      x: -(decay * x + Math.PI * Math.sin(TAU * x) * es),
      y: -(decay * y + Math.PI * Math.sin(TAU * y) * es),
    }
  },
})

/**
 * Himmelblau. Four equal global maxima of 0, at (3, 2), (-2.805, 3.131),
 * (-3.779, -3.283) and (3.584, -1.848). The clearest surface for showing that
 * "converged" and "found the best one" are different claims.
 */
export const himmelblau = new AnalyticSurface({
  name: 'Himmelblau',
  domain: square(-5, 5),
  globalOptimum: { x: 3, y: 2, height: 0 },
  f(x, y) {
    const a = x * x + y - 11
    const b = x + y * y - 7
    return -(a * a + b * b)
  },
  grad(x, y): Vec2 {
    const a = x * x + y - 11
    const b = x + y * y - 7
    return {
      x: -(4 * x * a + 2 * b),
      y: -(2 * a + 4 * y * b),
    }
  },
})

/**
 * Griewank. Deceptive by design: at full scale the quadratic bowl dominates
 * and the surface looks trivially easy, while the cosine ripples that actually
 * trap optimizers only become visible near the origin. Global max 0 at (0, 0).
 */
export const griewank = new AnalyticSurface({
  name: 'Griewank',
  domain: square(-600, 600),
  globalOptimum: { x: 0, y: 0, height: 0 },
  f(x, y) {
    // Product of cosines, not a sum — the sum form is a different function.
    return -((x * x + y * y) / 4000 - Math.cos(x) * Math.cos(y / Math.SQRT2) + 1)
  },
  grad(x, y): Vec2 {
    return {
      x: -(x / 2000 + Math.sin(x) * Math.cos(y / Math.SQRT2)),
      y: -(y / 2000 + (Math.cos(x) * Math.sin(y / Math.SQRT2)) / Math.SQRT2),
    }
  },
})

/**
 * Schwefel. The global maximum sits far out near a corner at (420.97, 420.97),
 * while the second-best optimum is at the opposite end of the domain — so an
 * optimizer that follows the local slope is led decisively the wrong way.
 * Global max 0.
 */
export const schwefel = new AnalyticSurface({
  name: 'Schwefel',
  domain: square(-500, 500),
  globalOptimum: { x: 420.9687, y: 420.9687, height: 0 },
  f(x, y) {
    return -(
      418.9829 * 2 -
      x * Math.sin(Math.sqrt(Math.abs(x))) -
      y * Math.sin(Math.sqrt(Math.abs(y)))
    )
  },
  grad(x, y): Vec2 {
    // d/dx [-x sin(sqrt|x|)] = -[sin(s) + s cos(s)/2], where s = sqrt|x|.
    const d = (v: number) => {
      const s = Math.sqrt(Math.abs(v))
      return s === 0 ? 0 : Math.sin(s) + (s * Math.cos(s)) / 2
    }
    return { x: d(x), y: d(y) }
  },
})

/**
 * Shubert. Eighteen tied global maxima of roughly 186.73, scattered across the
 * domain with no structure connecting them. `globalOptimum` is deliberately
 * left undefined: no single point deserves the label.
 */
export const shubert = new AnalyticSurface({
  name: 'Shubert',
  domain: square(-5.12, 5.12),
  f(x, y) {
    return -(shubertTerm(x) * shubertTerm(y))
  },
  grad(x, y): Vec2 {
    return {
      x: -(shubertTermDeriv(x) * shubertTerm(y)),
      y: -(shubertTerm(x) * shubertTermDeriv(y)),
    }
  },
})

function shubertTerm(v: number): number {
  let sum = 0
  for (let i = 1; i <= 5; i++) sum += i * Math.cos((i + 1) * v + i)
  return sum
}

function shubertTermDeriv(v: number): number {
  let sum = 0
  for (let i = 1; i <= 5; i++) sum -= i * (i + 1) * Math.sin((i + 1) * v + i)
  return sum
}

/**
 * Eggholder. Violently irregular, with the global maximum of about 959.64
 * pinned to the domain corner at (512, 404.23). No smooth structure to exploit,
 * which makes it the honest test of a derivative-free search.
 *
 * Gradients fall back to central differences: the nested `sqrt(abs(...))` terms
 * are differentiable almost everywhere but the closed form is long, easy to get
 * subtly wrong, and buys nothing — every optimizer that uses this surface is
 * derivative-free anyway.
 */
export const eggholder = new AnalyticSurface({
  name: 'Eggholder',
  domain: square(-512, 512),
  globalOptimum: { x: 512, y: 404.2319, height: 959.6407 },
  f(x, y) {
    const a = y + 47
    return -(-a * Math.sin(Math.sqrt(Math.abs(x / 2 + a))) - x * Math.sin(Math.sqrt(Math.abs(x - a))))
  },
})

/** All six, in rough order of how cruel they are. */
export const SURFACES = Object.freeze([
  himmelblau,
  griewank,
  ackley,
  shubert,
  schwefel,
  eggholder,
])

export const SURFACES_BY_NAME = Object.freeze(
  Object.fromEntries(SURFACES.map((s) => [s.name, s])),
)
