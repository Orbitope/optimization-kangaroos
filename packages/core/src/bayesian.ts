/**
 * The kangaroo who draws her own map.
 *
 * Every other method here is cheap and blind: hundreds of hops, each decided
 * from what is under her feet right now. This one is expensive and thoughtful.
 * She hops maybe twenty times in total, and between hops she sits down and
 * reconstructs the whole landscape from the handful of places she has actually
 * stood — including, and this is the part that matters, how sure she is about
 * each part of the reconstruction.
 *
 * Then she picks where to go next by trading two things off: where she *thinks*
 * it is high, against where she has *no idea*. Exploitation and exploration,
 * made literal.
 *
 * Not in the 1993 thread. Sarle's taxonomy predates Bayesian optimization
 * reaching mainstream machine learning by five years, and the article says so.
 * It earns its place because it is the only method in the piece that is
 * different in kind rather than in degree.
 *
 * No dependencies, and none needed. For two dimensions and under a hundred
 * observations the O(n^3) Cholesky is microseconds, and the acquisition sweep
 * is a grid evaluation that the scene layer wants rendered anyway.
 */

import { clampToDomain, inDomain, type Surface, type Vec2 } from './surface.js'
import { uniform, type Rng } from './rng.js'
import type { BaseOptions, Individual, OptimizerState, Termination } from './optimizers.js'

// ── linear algebra ─────────────────────────────────────────────────────────

/**
 * Lower-triangular Cholesky factor of a symmetric positive-definite matrix.
 *
 * Returns null rather than throwing when the matrix is not positive definite.
 * That happens for a real reason here — two observations at nearly the same
 * point make the covariance matrix singular — and the caller's fix is to add
 * more jitter and retry, not to unwind.
 */
export function cholesky(a: readonly number[][], n: number): number[][] | null {
  const l: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i]![j]!
      for (let k = 0; k < j; k++) sum -= l[i]![k]! * l[j]![k]!

      if (i === j) {
        if (sum <= 0) return null
        l[i]![j] = Math.sqrt(sum)
      } else {
        l[i]![j] = sum / l[j]![j]!
      }
    }
  }
  return l
}

/** Solve `L L^T x = b` given the Cholesky factor, by forward then back substitution. */
export function choleskySolve(l: readonly number[][], b: readonly number[], n: number): number[] {
  const y = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    let sum = b[i]!
    for (let k = 0; k < i; k++) sum -= l[i]![k]! * y[k]!
    y[i] = sum / l[i]![i]!
  }

  const x = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i]!
    for (let k = i + 1; k < n; k++) sum -= l[k]![i]! * x[k]!
    x[i] = sum / l[i]![i]!
  }
  return x
}

// ── kernel ─────────────────────────────────────────────────────────────────

/**
 * Matérn 5/2 covariance.
 *
 * The default choice for this kind of work, and the reason is worth stating:
 * the squared-exponential kernel everyone reaches for first assumes the
 * landscape is infinitely smooth, which makes the posterior wildly
 * overconfident between observations — it will happily report near-zero
 * uncertainty halfway between two cairns. Matérn 5/2 assumes twice
 * differentiable, which is closer to what terrain is, and its uncertainty
 * grows the way a reader expects when they look at a gap.
 *
 * `k(r) = σ² (1 + √5 r/ℓ + 5r²/3ℓ²) exp(-√5 r/ℓ)`
 */
export function matern52(r: number, lengthScale: number, variance: number): number {
  const s = (Math.sqrt(5) * r) / lengthScale
  return variance * (1 + s + (s * s) / 3) * Math.exp(-s)
}

// ── the posterior ──────────────────────────────────────────────────────────

export interface GpObservation {
  readonly position: Vec2
  readonly value: number
}

export interface GpOptions {
  /**
   * Correlation distance, in domain units. How far her knowledge carries from
   * a place she has stood.
   */
  readonly lengthScale: number
  /** Prior variance — how much the landscape is expected to vary overall. */
  readonly variance: number
  /**
   * Assumed measurement noise. Also what keeps the covariance matrix
   * invertible, so it is never quite zero even for a noiseless surface.
   */
  readonly noise: number
}

export interface GaussianProcess {
  readonly observations: readonly GpObservation[]
  readonly options: GpOptions
  /** Posterior mean and standard deviation at a point. */
  predict(p: Vec2): { mean: number; sd: number }
  /** Mean of the observations — the prior the posterior reverts to far away. */
  readonly priorMean: number
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Condition a Gaussian process on what she has seen.
 *
 * The prior mean is the mean of the observations rather than zero. With a zero
 * prior the posterior decays toward *sea level* far from any cairn, so
 * unexplored ground looks like a giant hole and the acquisition function goes
 * hunting for it — the search would systematically avoid everywhere it has not
 * been, which is precisely backwards.
 */
export function fitGaussianProcess(
  observations: readonly GpObservation[],
  options: GpOptions,
): GaussianProcess {
  const n = observations.length
  const priorMean = n === 0 ? 0 : observations.reduce((s, o) => s + o.value, 0) / n

  if (n === 0) {
    const sd = Math.sqrt(options.variance)
    return { observations, options, priorMean, predict: () => ({ mean: 0, sd }) }
  }

  // Build K + noise·I, factor it, and pre-solve for the residuals. Everything
  // per-query after this is O(n).
  let l: number[][] | null = null
  let jitter = options.noise
  for (let attempt = 0; attempt < 6 && !l; attempt++) {
    const k: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        k[i]![j] =
          matern52(dist(observations[i]!.position, observations[j]!.position), options.lengthScale, options.variance) +
          (i === j ? jitter : 0)
      }
    }
    l = cholesky(k, n)
    // Two cairns in nearly the same place make K singular. Ten times the
    // jitter and try again; this converges in one or two rounds in practice.
    jitter *= 10
  }

  if (!l) {
    const sd = Math.sqrt(options.variance)
    return { observations, options, priorMean, predict: () => ({ mean: priorMean, sd }) }
  }

  const residual = observations.map((o) => o.value - priorMean)
  const alpha = choleskySolve(l, residual, n)
  const factor = l

  return {
    observations,
    options,
    priorMean,
    predict(p: Vec2) {
      const ks = observations.map((o) =>
        matern52(dist(p, o.position), options.lengthScale, options.variance),
      )

      let mean = priorMean
      for (let i = 0; i < n; i++) mean += ks[i]! * alpha[i]!

      // var = k(p,p) - ks^T K^-1 ks, via the same factorisation.
      const v = choleskySolve(factor, ks, n)
      let quad = 0
      for (let i = 0; i < n; i++) quad += ks[i]! * v[i]!

      // Floating point can push this a hair below zero at an observed point,
      // where the true value is exactly zero.
      const variance = Math.max(0, options.variance - quad)
      return { mean, sd: Math.sqrt(variance) }
    },
  }
}

// ── acquisition ────────────────────────────────────────────────────────────

/** Standard normal PDF and CDF. The CDF uses Abramowitz & Stegun 7.1.26. */
function normPdf(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI)
}

function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const poly =
    t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  const upper = normPdf(z) * poly
  return z >= 0 ? 1 - upper : upper
}

/**
 * Expected Improvement over the best value seen so far.
 *
 * The quantity being maximised: how much higher than her current best she
 * expects this spot to be, averaged over everything she believes about it.
 * It is high where the mean is high, *and* high where the uncertainty is
 * large — which is the whole trick, and why she goes and looks at places her
 * own map says are unremarkable.
 *
 * `xi` is a nudge toward exploration: it raises the bar she is trying to beat,
 * so marginal improvements stop counting.
 */
export function expectedImprovement(mean: number, sd: number, best: number, xi = 0.01): number {
  if (sd <= 0) return 0
  const improvement = mean - best - xi
  const z = improvement / sd
  return Math.max(0, improvement * normCdf(z) + sd * normPdf(z))
}

// ── the posterior, on a grid ───────────────────────────────────────────────

export interface PosteriorGrid {
  readonly resolution: number
  /** Row-major, `resolution * resolution`, y outermost. */
  readonly mean: Float64Array
  readonly sd: Float64Array
  readonly acquisition: Float64Array
  readonly meanRange: readonly [number, number]
  readonly sdRange: readonly [number, number]
  readonly acquisitionRange: readonly [number, number]
  /** Where the acquisition function peaks — the next place she will go. */
  readonly argmax: Vec2
}

/**
 * Evaluate the posterior and the acquisition function across the whole domain.
 *
 * The renderer needs these grids anyway — belief surface, uncertainty fog,
 * acquisition heat — so the search for the next point is a by-product of
 * drawing the figure rather than extra work. Maximising EI properly would mean
 * a multi-start local optimiser, which is more accurate and produces nothing
 * anyone can look at.
 */
export function posteriorGrid(
  gp: GaussianProcess,
  surface: Surface,
  best: number,
  resolution: number,
  xi = 0.01,
): PosteriorGrid {
  const d = surface.domain
  const mean = new Float64Array(resolution * resolution)
  const sd = new Float64Array(resolution * resolution)
  const acquisition = new Float64Array(resolution * resolution)

  let meanMin = Infinity
  let meanMax = -Infinity
  let sdMin = Infinity
  let sdMax = -Infinity
  let acqMin = Infinity
  let acqMax = -Infinity
  let argmax: Vec2 = { x: (d.xMin + d.xMax) / 2, y: (d.yMin + d.yMax) / 2 }

  for (let j = 0; j < resolution; j++) {
    const ty = resolution === 1 ? 0.5 : j / (resolution - 1)
    const y = d.yMin + ty * (d.yMax - d.yMin)
    for (let i = 0; i < resolution; i++) {
      const tx = resolution === 1 ? 0.5 : i / (resolution - 1)
      const x = d.xMin + tx * (d.xMax - d.xMin)
      const idx = j * resolution + i

      const p = gp.predict({ x, y })
      const a = expectedImprovement(p.mean, p.sd, best, xi)

      mean[idx] = p.mean
      sd[idx] = p.sd
      acquisition[idx] = a

      if (p.mean < meanMin) meanMin = p.mean
      if (p.mean > meanMax) meanMax = p.mean
      if (p.sd < sdMin) sdMin = p.sd
      if (p.sd > sdMax) sdMax = p.sd
      if (a < acqMin) acqMin = a
      if (a > acqMax) {
        acqMax = a
        argmax = { x, y }
      }
    }
  }

  return {
    resolution,
    mean,
    sd,
    acquisition,
    meanRange: [meanMin, meanMax],
    sdRange: [sdMin, sdMax],
    acquisitionRange: [acqMin, acqMax],
    argmax,
  }
}

// ── the optimizer ──────────────────────────────────────────────────────────

export interface BayesianOptions extends BaseOptions {
  /**
   * Correlation distance as a fraction of the domain's smaller side.
   *
   * The single most consequential setting. Too short and every observation is
   * an island, so the posterior is flat everywhere else and she wanders; too
   * long and she believes the whole continent is one hill and stops looking.
   */
  readonly lengthScaleFraction?: number
  /** Exploration nudge passed to Expected Improvement. */
  readonly xi?: number
  /** Grid used for both the acquisition search and the rendered layers. */
  readonly resolution?: number
  /** Random points taken before the model is trusted. */
  readonly initialSamples?: number
  /**
   * Attach the posterior grids to each state.
   *
   * On by default, because a run of this without its belief surface is just a
   * hill climber with very few steps and no way to see why it went anywhere.
   * `runEnsemble` turns it off — a hundred runs times a 64x64 grid times three
   * layers is 1.2 million doubles nobody looks at.
   */
  readonly recordModel?: boolean
}

/** The posterior, carried on the state so the scene can draw her belief. */
export interface BayesianState extends OptimizerState {
  readonly model?: PosteriorGrid
  readonly observations: readonly GpObservation[]
}

/**
 * Twenty deliberate hops against the hill climber's five hundred blind ones.
 *
 * Each step: fit the process to everything seen so far, sweep the acquisition
 * function, go stand on its maximum, and write down what the altitude actually
 * was there. The interesting frames are the ones where she walks away from a
 * perfectly good summit because a blank region scored higher.
 */
export function* bayesianOptimization(
  surface: Surface,
  rng: Rng,
  options: BayesianOptions = {},
): Generator<BayesianState, BayesianState> {
  const {
    maxSteps = 25,
    lengthScaleFraction = 0.18,
    xi = 0.01,
    resolution = 48,
    initialSamples = 4,
    recordModel = true,
    start,
  } = options

  const d = surface.domain
  const shortSide = Math.min(d.xMax - d.xMin, d.yMax - d.yMin)
  const lengthScale = shortSide * lengthScaleFraction

  const observations: GpObservation[] = []
  let best: Individual = { position: { x: 0, y: 0 }, value: -Infinity }

  const observe = (p: Vec2): Individual => {
    const q = inDomain(d, p.x, p.y) ? p : clampToDomain(d, p.x, p.y)
    const value = surface.height(q.x, q.y)
    observations.push({ position: q, value })
    if (value > best.value) best = { position: q, value }
    return { position: q, value }
  }

  /**
   * Prior variance from the spread of what she has seen.
   *
   * Fixing it up front would need to know the surface's altitude range, which
   * differs by two orders of magnitude across the benchmark set — Ackley spans
   * about 22 and Eggholder about 1900. A variance calibrated for one makes the
   * other's uncertainty either invisible or overwhelming.
   */
  const priorVariance = (): number => {
    if (observations.length < 2) return 1
    const mean = observations.reduce((s, o) => s + o.value, 0) / observations.length
    const v =
      observations.reduce((s, o) => s + (o.value - mean) ** 2, 0) / (observations.length - 1)
    return Math.max(v, 1e-9)
  }

  const emit = (
    step: number,
    current: Individual,
    model: PosteriorGrid | undefined,
    done: boolean,
    termination: Termination,
  ): BayesianState => ({
    step,
    position: current.position,
    value: current.value,
    best,
    done,
    termination,
    observations: observations.slice(),
    ...(model ? { model } : {}),
    meta: {
      observations: observations.length,
      lengthScale,
      variance: priorVariance(),
      // How much of the domain she still has no opinion about. Falls toward
      // zero as the cairns accumulate, and is the number the fog is drawn from.
      meanUncertainty: model
        ? model.sd.reduce((s, v) => s + v, 0) / model.sd.length / Math.sqrt(priorVariance())
        : 0,
    },
  })

  // The random opening. A model fitted to one point has nothing to say, so the
  // first few are drawn blind — this is a real part of the method, not a
  // shortcut, and it is why she is allowed to look uninformed at the start.
  let current: Individual = observe(
    start ?? { x: uniform(rng, d.xMin, d.xMax), y: uniform(rng, d.yMin, d.yMax) },
  )
  yield emit(0, current, undefined, false, null)

  for (let step = 1; step <= maxSteps; step++) {
    const exploring = observations.length < initialSamples

    let next: Vec2
    let grid: PosteriorGrid | undefined

    if (exploring) {
      next = { x: uniform(rng, d.xMin, d.xMax), y: uniform(rng, d.yMin, d.yMax) }
    } else {
      const gp = fitGaussianProcess(observations, {
        lengthScale,
        variance: priorVariance(),
        noise: priorVariance() * 1e-6,
      })
      grid = posteriorGrid(gp, surface, best.value, resolution, xi)
      next = grid.argmax
    }

    current = observe(next)

    // The model shown alongside a step is the one that *chose* it, so a reader
    // pausing on a frame sees the acquisition peak the kangaroo is standing on
    // rather than a map redrawn to include where she has just landed.
    if (step === maxSteps) {
      return emit(step, current, recordModel ? grid : undefined, true, 'max-steps')
    }
    yield emit(step, current, recordModel ? grid : undefined, false, null)
  }

  return emit(maxSteps, current, undefined, true, 'max-steps')
}
