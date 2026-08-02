/**
 * A landscape the kangaroo hops around on.
 *
 * Everything is framed as *maximization*, following the email: altitude is
 * negated error, so higher is always better. The 2019 `components/functions.js`
 * used the same convention and it is worth keeping — it means the metaphor and
 * the code never disagree about which way is up.
 */

export interface Vec2 {
  readonly x: number
  readonly y: number
}

export interface Domain {
  readonly xMin: number
  readonly xMax: number
  readonly yMin: number
  readonly yMax: number
}

export interface Surface {
  readonly name: string
  readonly domain: Domain

  /** Altitude at a point. Higher is better, always. */
  height(x: number, y: number): number

  /** Uphill direction and steepness. Analytic where possible. */
  gradient(x: number, y: number): Vec2

  /** Where the true summit is, when it is known. */
  readonly globalOptimum?: { readonly x: number; readonly y: number; readonly height: number }

  /** Below this altitude the kangaroo drowns. Real terrain only. */
  readonly seaLevel?: number
}

// ── domain helpers ─────────────────────────────────────────────────────────

/** A square domain, the shape every benchmark function in the 2019 code used. */
export function square(min: number, max: number): Domain {
  return { xMin: min, xMax: max, yMin: min, yMax: max }
}

export function inDomain(d: Domain, x: number, y: number): boolean {
  return x >= d.xMin && x <= d.xMax && y >= d.yMin && y <= d.yMax
}

export function clampToDomain(d: Domain, x: number, y: number): Vec2 {
  return {
    x: Math.min(d.xMax, Math.max(d.xMin, x)),
    y: Math.min(d.yMax, Math.max(d.yMin, y)),
  }
}

export function domainWidth(d: Domain): number {
  return d.xMax - d.xMin
}

export function domainHeight(d: Domain): number {
  return d.yMax - d.yMin
}

/** Length of the domain diagonal — the natural unit for step sizes. */
export function domainDiagonal(d: Domain): number {
  return Math.hypot(domainWidth(d), domainHeight(d))
}

// ── vectors ────────────────────────────────────────────────────────────────

export function magnitude(v: Vec2): number {
  return Math.hypot(v.x, v.y)
}

/** Scale a vector to unit length. Returns the zero vector unchanged. */
export function normalize(v: Vec2): Vec2 {
  const m = magnitude(v)
  return m === 0 ? { x: 0, y: 0 } : { x: v.x / m, y: v.y / m }
}

export function scaleVec(v: Vec2, k: number): Vec2 {
  return { x: v.x * k, y: v.y * k }
}

export function addVec(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y
}

// ── analytic surfaces ──────────────────────────────────────────────────────

export interface AnalyticSpec {
  readonly name: string
  readonly domain: Domain
  readonly f: (x: number, y: number) => number
  /** Exact partial derivatives. Omit to fall back to central differences. */
  readonly grad?: (x: number, y: number) => Vec2
  readonly globalOptimum?: { readonly x: number; readonly y: number; readonly height: number }
}

/**
 * A closed-form test surface.
 *
 * Gradients are hand-written rather than derived at runtime. The 2019 code
 * carried a parallel string form of every function and fed it to
 * `mathjs.derivative` on each call, which is both slower and a second thing
 * to keep correct — several of those strings had already drifted from the
 * functions they were supposed to mirror.
 */
export class AnalyticSurface implements Surface {
  readonly name: string
  readonly domain: Domain
  readonly globalOptimum?: { readonly x: number; readonly y: number; readonly height: number }

  readonly #f: (x: number, y: number) => number
  readonly #grad?: (x: number, y: number) => Vec2
  /** Step for central differences, as a fraction of the domain diagonal. */
  readonly #h: number

  constructor(spec: AnalyticSpec) {
    this.name = spec.name
    this.domain = spec.domain
    this.#f = spec.f
    this.#grad = spec.grad
    this.globalOptimum = spec.globalOptimum
    this.#h = domainDiagonal(spec.domain) * 1e-6
  }

  height(x: number, y: number): number {
    return this.#f(x, y)
  }

  gradient(x: number, y: number): Vec2 {
    if (this.#grad) return this.#grad(x, y)
    const h = this.#h
    return {
      x: (this.#f(x + h, y) - this.#f(x - h, y)) / (2 * h),
      y: (this.#f(x, y + h) - this.#f(x, y - h)) / (2 * h),
    }
  }
}
