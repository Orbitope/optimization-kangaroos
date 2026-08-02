/**
 * Running the same algorithm many times and summarising what happened.
 *
 * A single 3D run shows *how* an algorithm searches. It cannot show how often
 * that works, and for these algorithms the answer is usually "less than you
 * would guess from one good run". Himmelblau is the sharpest case: four tied
 * global maxima mean "converged" and "found the best one" are different claims,
 * and only an ensemble makes the gap visible.
 */

import { collect, type OptimizerState } from './optimizers.js'
import { mulberry32, type Rng } from './rng.js'
import type { Surface, Vec2 } from './surface.js'

export type OptimizerFactory = (
  surface: Surface,
  rng: Rng,
) => Generator<OptimizerState, OptimizerState>

export interface RunSummary {
  readonly seed: number
  readonly steps: number
  readonly bestValue: number
  readonly bestPosition: Vec2
  readonly termination: string | null
  /** Step at which the final best was first reached. */
  readonly convergedAt: number
  /** Best-so-far after each step. Length is `steps + 1`. */
  readonly trace: Float64Array
}

export interface EnsembleResult {
  readonly surface: string
  readonly runs: readonly RunSummary[]
  /** Longest run in the ensemble; every trace is padded to this for charting. */
  readonly maxSteps: number
  /** Fraction of runs finishing within `successEpsilon` of the global optimum. */
  readonly successRate: number | null
  readonly successEpsilon: number
}

export interface EnsembleOptions {
  /** Seeds to run. Defaults to 0..n-1 via `seedCount`. */
  readonly seeds?: readonly number[]
  readonly seedCount?: number
  /**
   * How close to the declared global optimum counts as success, as a fraction
   * of the surface's altitude range. Surfaces without a declared optimum report
   * a null success rate rather than a misleading zero.
   */
  readonly successEpsilon?: number
}

export function runEnsemble(
  surface: Surface,
  factory: OptimizerFactory,
  options: EnsembleOptions = {},
): EnsembleResult {
  const seeds = options.seeds ?? Array.from({ length: options.seedCount ?? 30 }, (_, i) => i)
  if (seeds.length === 0) throw new Error('An ensemble needs at least one seed')
  const successEpsilon = options.successEpsilon ?? 0.01

  const runs: RunSummary[] = seeds.map((seed) => {
    const states = collect(factory(surface, mulberry32(seed)))
    const trace = new Float64Array(states.length)

    let convergedAt = 0
    states.forEach((s, i) => {
      trace[i] = s.best.value
      if (i > 0 && s.best.value > trace[i - 1]!) convergedAt = i
    })

    const last = states[states.length - 1]!
    return {
      seed,
      steps: states.length - 1,
      bestValue: last.best.value,
      bestPosition: last.best.position,
      termination: last.termination,
      convergedAt,
      trace,
    }
  })

  const maxSteps = Math.max(...runs.map((r) => r.steps))

  let successRate: number | null = null
  if (surface.globalOptimum) {
    // Scale the tolerance to the surface's own vertical range, so one epsilon
    // means the same thing on Ackley (range ~22) and Eggholder (range ~1900).
    const range = estimateRange(surface)
    const threshold = surface.globalOptimum.height - successEpsilon * range
    successRate = runs.filter((r) => r.bestValue >= threshold).length / runs.length
  }

  return { surface: surface.name, runs, maxSteps, successRate, successEpsilon }
}

/**
 * Best-so-far quantile bands across the ensemble, ready to chart.
 *
 * Traces are padded forward with their final value: a run that converged at
 * step 40 has genuinely still got that altitude at step 400, and truncating
 * instead would make the median jump every time a short run drops out.
 */
export interface QuantileBand {
  readonly step: number
  readonly lower: number
  readonly median: number
  readonly upper: number
}

export function quantileBands(result: EnsembleResult, lowerQ = 0.25, upperQ = 0.75): QuantileBand[] {
  const bands: QuantileBand[] = []
  const scratch = new Float64Array(result.runs.length)

  for (let step = 0; step <= result.maxSteps; step++) {
    result.runs.forEach((run, i) => {
      scratch[i] = run.trace[Math.min(step, run.trace.length - 1)]!
    })
    const sorted = Float64Array.from(scratch).sort()
    bands.push({
      step,
      lower: quantile(sorted, lowerQ),
      median: quantile(sorted, 0.5),
      upper: quantile(sorted, upperQ),
    })
  }
  return bands
}

/** A distinct summit that some share of the ensemble ended up on. */
export interface OptimumCluster {
  /** Mean final position of the runs that landed here. */
  readonly position: Vec2
  /** Best altitude reached by any run in the cluster. */
  readonly value: number
  readonly count: number
  /** Fraction of the ensemble, 0..1. */
  readonly share: number
}

/**
 * Group the ensemble by which summit it actually reached.
 *
 * Success rate answers "did it find the best altitude"; on a surface with tied
 * optima that question is degenerate. Himmelblau has four maxima all worth
 * exactly 0, so every run "succeeds" while landing in four visibly different
 * places — and *that* is the interesting figure. Clustering final positions is
 * the only way to show it.
 *
 * `radius` is in domain units. Greedy single-pass assignment, best runs first,
 * which is stable and good enough for basins this well separated.
 */
export function clusterOptima(result: EnsembleResult, radius: number): OptimumCluster[] {
  if (!(radius > 0)) throw new Error(`Cluster radius must be positive, got ${radius}`)

  const ordered = [...result.runs].sort((a, b) => b.bestValue - a.bestValue)
  const clusters: { xs: number[]; ys: number[]; value: number }[] = []

  for (const run of ordered) {
    const hit = clusters.find(
      (c) =>
        Math.hypot(
          run.bestPosition.x - mean(c.xs),
          run.bestPosition.y - mean(c.ys),
        ) <= radius,
    )
    if (hit) {
      hit.xs.push(run.bestPosition.x)
      hit.ys.push(run.bestPosition.y)
    } else {
      clusters.push({ xs: [run.bestPosition.x], ys: [run.bestPosition.y], value: run.bestValue })
    }
  }

  return clusters
    .map((c) => ({
      position: { x: mean(c.xs), y: mean(c.ys) },
      value: c.value,
      count: c.xs.length,
      share: c.xs.length / result.runs.length,
    }))
    .sort((a, b) => b.count - a.count)
}

function mean(xs: readonly number[]): number {
  return xs.reduce((s, v) => s + v, 0) / xs.length
}

/** Linear-interpolated quantile of an already-sorted array. */
export function quantile(sorted: ArrayLike<number>, q: number): number {
  if (sorted.length === 0) throw new Error('Cannot take a quantile of nothing')
  if (sorted.length === 1) return sorted[0]!
  const pos = Math.min(1, Math.max(0, q)) * (sorted.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo)
}

/** Rough altitude range, used to make `successEpsilon` surface-independent. */
function estimateRange(surface: Surface): number {
  const rng = mulberry32(0x5eed)
  const { xMin, xMax, yMin, yMax } = surface.domain
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < 2000; i++) {
    const v = surface.height(
      xMin + (xMax - xMin) * rng.next(),
      yMin + (yMax - yMin) * rng.next(),
    )
    if (!Number.isFinite(v)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const range = hi - lo
  return Number.isFinite(range) && range > 0 ? range : 1
}
