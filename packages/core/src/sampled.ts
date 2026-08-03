/**
 * Landscapes built out of training examples.
 *
 * Act 4's whole argument is that the terrain is not given — it accumulates from
 * the examples you happened to draw. This makes that literal, and it is not a
 * cheat: a loss surface really is the average of one surface per example, and
 * that average really does converge to a fixed landscape as examples pile up.
 *
 * The construction:
 *
 *   truth(p)     = sum_j  w_j * Gaussian(p; m_j, s_j)      the thing being learned
 *   examples     = N points drawn from that same mixture
 *   landscape(p) = (1/N) sum_i Gaussian(p; c_i, bandwidth) what she walks on
 *
 * So every example raises one hill where it lands, and the hills add up. With
 * few examples the sum is lumpy and full of peaks that exist only because of
 * where those particular examples fell. With many it settles onto the truth.
 *
 * The limit is available exactly rather than approximated with a huge N:
 * convolving the mixture with the kernel just widens each component, since
 * Gaussian(m, s^2) * Gaussian(0, h^2) = Gaussian(m, s^2 + h^2).
 */

import { randNormal, mulberry32, type Rng } from './rng.js'
import { square, type Domain, type Surface, type Vec2 } from './surface.js'

/** One mountain in the underlying distribution examples are drawn from. */
export interface Feature {
  readonly x: number
  readonly y: number
  /** Relative share of examples that land near this feature. */
  readonly weight: number
  /** Spread, in domain units. */
  readonly sigma: number
}

export interface SampledLandscapeOptions {
  /** How many training examples to draw. */
  readonly count: number
  /** Which draw. Changing it reshuffles the data without changing the truth. */
  readonly seed: number
  /**
   * Width of the hill each single example raises, in domain units.
   *
   * Held fixed rather than adapted to `count` on purpose. A bandwidth that
   * shrinks as data grows would confound two effects, and the point being made
   * is about sample size alone.
   */
  readonly bandwidth?: number
  readonly features?: readonly Feature[]
  readonly domain?: Domain
  readonly name?: string
}

export const DEFAULT_DOMAIN: Domain = square(-10, 10)

/**
 * A recognisable range: two dominant peaks, a lesser one, and two foothills.
 *
 * Deliberately uneven. If every feature had the same weight, a small sample
 * would look merely noisy rather than misleading, and the interesting failure —
 * a real-looking summit in the wrong place — would not appear.
 */
export const DEFAULT_FEATURES: readonly Feature[] = Object.freeze([
  { x: -4.2, y: 3.1, weight: 1.0, sigma: 2.1 },
  { x: 4.6, y: -2.4, weight: 0.85, sigma: 2.4 },
  { x: 1.2, y: 5.4, weight: 0.45, sigma: 1.7 },
  { x: -5.5, y: -4.8, weight: 0.3, sigma: 1.5 },
  { x: 6.2, y: 4.9, weight: 0.22, sigma: 1.3 },
])

const TAU = Math.PI * 2

function defaultBandwidth(domain: Domain): number {
  return Math.hypot(domain.xMax - domain.xMin, domain.yMax - domain.yMin) * 0.055
}

/**
 * Draw `count` examples from the feature mixture.
 *
 * Exposed because the scene draws them as markers: seeing where the examples
 * actually fell is what makes "this hill is here because of those three dots"
 * legible.
 */
export function drawExamples(
  count: number,
  rng: Rng,
  features: readonly Feature[] = DEFAULT_FEATURES,
): Vec2[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`Example count must be an integer >= 1, got ${count}`)
  }
  if (features.length === 0) throw new Error('Need at least one feature to sample from')

  const total = features.reduce((s, f) => s + f.weight, 0)
  if (!(total > 0)) throw new Error('Feature weights must sum to something positive')

  return Array.from({ length: count }, () => {
    let pick = rng.next() * total
    let chosen = features[features.length - 1]!
    for (const f of features) {
      pick -= f.weight
      if (pick <= 0) {
        chosen = f
        break
      }
    }
    return {
      x: chosen.x + randNormal(rng) * chosen.sigma,
      y: chosen.y + randNormal(rng) * chosen.sigma,
    }
  })
}

/** Shared implementation: any weighted sum of isotropic Gaussian hills. */
class GaussianMixtureSurface implements Surface {
  readonly name: string
  readonly domain: Domain

  readonly #cx: Float64Array
  readonly #cy: Float64Array
  readonly #amp: Float64Array
  readonly #inv2s2: Float64Array
  readonly #invs2: Float64Array

  constructor(
    name: string,
    domain: Domain,
    centres: readonly Vec2[],
    amplitudes: readonly number[],
    sigmas: readonly number[],
  ) {
    this.name = name
    this.domain = domain
    const n = centres.length
    this.#cx = new Float64Array(n)
    this.#cy = new Float64Array(n)
    this.#amp = new Float64Array(n)
    this.#inv2s2 = new Float64Array(n)
    this.#invs2 = new Float64Array(n)

    for (let i = 0; i < n; i++) {
      const s = sigmas[i]!
      this.#cx[i] = centres[i]!.x
      this.#cy[i] = centres[i]!.y
      // Normalized so each hill carries the same volume regardless of width;
      // otherwise a narrow kernel would tower over a broad one for no reason.
      this.#amp[i] = amplitudes[i]! / (TAU * s * s)
      this.#inv2s2[i] = 1 / (2 * s * s)
      this.#invs2[i] = 1 / (s * s)
    }
  }

  height(x: number, y: number): number {
    let sum = 0
    for (let i = 0; i < this.#cx.length; i++) {
      const dx = x - this.#cx[i]!
      const dy = y - this.#cy[i]!
      sum += this.#amp[i]! * Math.exp(-(dx * dx + dy * dy) * this.#inv2s2[i]!)
    }
    return sum
  }

  gradient(x: number, y: number): Vec2 {
    let gx = 0
    let gy = 0
    for (let i = 0; i < this.#cx.length; i++) {
      const dx = x - this.#cx[i]!
      const dy = y - this.#cy[i]!
      const g = this.#amp[i]! * Math.exp(-(dx * dx + dy * dy) * this.#inv2s2[i]!) * this.#invs2[i]!
      gx -= g * dx
      gy -= g * dy
    }
    return { x: gx, y: gy }
  }
}

/**
 * The landscape a particular set of examples builds.
 *
 * Change `seed` and the truth is untouched but the data is redrawn — the big
 * mountains stay where they are and the small bumps move. That single
 * comparison is the whole of the overfitting section.
 */
export function createSampledSurface(options: SampledLandscapeOptions): Surface {
  const domain = options.domain ?? DEFAULT_DOMAIN
  const features = options.features ?? DEFAULT_FEATURES
  const bandwidth = options.bandwidth ?? defaultBandwidth(domain)
  const examples = drawExamples(options.count, mulberry32(options.seed), features)

  return new GaussianMixtureSurface(
    options.name ?? `Data (${options.count} examples)`,
    domain,
    examples,
    examples.map(() => 1 / examples.length),
    examples.map(() => bandwidth),
  )
}

/**
 * What the landscape settles onto given unlimited examples.
 *
 * Computed exactly, not approximated: smoothing the mixture by the kernel only
 * widens each feature. Being exact matters, because the reveal is a dissolve
 * from her terrain to this one and any sampling noise here would read as part
 * of her error.
 */
export function createTrueSurface(
  options: Omit<SampledLandscapeOptions, 'count' | 'seed'> = {},
): Surface {
  const domain = options.domain ?? DEFAULT_DOMAIN
  const features = options.features ?? DEFAULT_FEATURES
  const bandwidth = options.bandwidth ?? defaultBandwidth(domain)
  const total = features.reduce((s, f) => s + f.weight, 0)

  return new GaussianMixtureSurface(
    options.name ?? 'Truth',
    domain,
    features.map((f) => ({ x: f.x, y: f.y })),
    features.map((f) => f.weight / total),
    features.map((f) => Math.hypot(f.sigma, bandwidth)),
  )
}

/**
 * A single mini-batch: the world rebuilt from just a few examples.
 *
 * Sarle's earthquakes and Prechelt's "one world for each training example" are
 * the same thing as `createSampledSurface` with a tiny count and a fresh seed
 * each step, so no new machinery is needed — only a different call.
 */
export function createBatchSurface(
  batchSize: number,
  step: number,
  options: Omit<SampledLandscapeOptions, 'count' | 'seed'> & { readonly seed?: number } = {},
): Surface {
  return createSampledSurface({
    ...options,
    count: batchSize,
    // Derived from the step so consecutive batches differ but a run replays.
    seed: ((options.seed ?? 0) * 1_000_003 + step * 2_654_435_761) >>> 0,
    name: `Batch ${step} (${batchSize})`,
  })
}
