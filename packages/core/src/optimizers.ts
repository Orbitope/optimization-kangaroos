/**
 * The four algorithms named in todo.todo, each written as a generator.
 *
 * Generators rather than a `step()` method with mutable internal state: a
 * widget drives one with `next()` on a rAF tick, the video renderer collects
 * the whole trajectory up front and indexes it by frame, and a test runs it to
 * completion in a loop. Same code, three consumers, no shared mutable object
 * to get out of sync.
 */

import {
  addVec,
  clampToDomain,
  domainDiagonal,
  inDomain,
  magnitude,
  normalize,
  scaleVec,
  type Surface,
  type Vec2,
} from './surface.js'
import { randInt, randNormal, randUnitVector, uniform, type Rng } from './rng.js'

export type OptimizerName =
  | 'hill-climber'
  | 'gradient-ascent'
  | 'simulated-annealing'
  | 'genetic-algorithm'

/** Why a run stopped. `null` while it is still going. */
export type Termination = 'converged' | 'max-steps' | 'stalled' | null

export interface Individual {
  readonly position: Vec2
  readonly value: number
}

/**
 * A candidate the optimizer looked at on this step.
 *
 * Recording the rejected ones matters for the 3D view: the hill climber trying
 * a dozen directions before one sticks, and annealing knowingly taking a
 * downhill move, are the two clearest teaching moments in the piece, and
 * neither is visible from the accepted trajectory alone.
 */
export interface Proposal extends Individual {
  readonly accepted: boolean
  /** Present for annealing: the Metropolis probability this was taken with. */
  readonly acceptProbability?: number
}

export interface OptimizerState {
  readonly step: number
  /** Where the kangaroo is now. */
  readonly position: Vec2
  readonly value: number
  /** The best point seen so far, which is not always where it is standing. */
  readonly best: Individual
  readonly done: boolean
  readonly termination: Termination
  /** Present for population methods. */
  readonly population?: readonly Individual[]
  /** Candidates evaluated this step. Only populated when `recordProposals`. */
  readonly proposals?: readonly Proposal[]
  /** Algorithm-specific readouts — temperature, step size, generation. */
  readonly meta: Readonly<Record<string, number>>
}

export interface BaseOptions {
  readonly maxSteps?: number
  /** Optional fixed start. Omit to parachute the kangaroo in at random. */
  readonly start?: Vec2
  /**
   * Record every candidate considered, not just the accepted one.
   *
   * Off by default. A single run costs almost nothing, but `runEnsemble` over
   * a hundred seeds would allocate hundreds of thousands of objects it never
   * looks at.
   */
  readonly recordProposals?: boolean
}

function randomStart(surface: Surface, rng: Rng): Vec2 {
  const d = surface.domain
  return { x: uniform(rng, d.xMin, d.xMax), y: uniform(rng, d.yMin, d.yMax) }
}

function at(surface: Surface, p: Vec2): Individual {
  return { position: p, value: surface.height(p.x, p.y) }
}

function better(a: Individual, b: Individual): Individual {
  return b.value > a.value ? b : a
}

// ── hill climber ───────────────────────────────────────────────────────────

export interface HillClimberOptions extends BaseOptions {
  /** Hop length, in domain units. Defaults to 2% of the domain diagonal. */
  readonly stepSize?: number
  /** Multiplied into the step size each step. 1 keeps hops the same size. */
  readonly stepDecay?: number
  /** Directions to try before giving up on a step. */
  readonly neighborAttempts?: number
  /** Consecutive failed steps before declaring the summit reached. */
  readonly patience?: number
}

/**
 * The blind kangaroo. Hop in a random direction; if it is not lower, stay.
 *
 * Per todo.todo, out-of-domain proposals do not count against patience — the
 * kangaroo bumping into the edge of the map is not evidence that it has found
 * a summit, and counting it as such makes runs near a boundary terminate early
 * and look converged when they are not.
 */
export function* hillClimber(
  surface: Surface,
  rng: Rng,
  opts: HillClimberOptions = {},
): Generator<OptimizerState, OptimizerState> {
  const maxSteps = opts.maxSteps ?? 500
  const stepDecay = opts.stepDecay ?? 1
  const attempts = opts.neighborAttempts ?? 12
  const patience = opts.patience ?? 3
  let stepSize = opts.stepSize ?? domainDiagonal(surface.domain) * 0.02

  const record = opts.recordProposals ?? false

  let current = at(surface, opts.start ?? randomStart(surface, rng))
  let best = current
  let stalledFor = 0
  let proposals: Proposal[] = []

  const emit = (step: number, done: boolean, termination: Termination): OptimizerState => ({
    step,
    position: current.position,
    value: current.value,
    best,
    done,
    termination,
    ...(record ? { proposals } : {}),
    meta: { stepSize, stalledFor, tried: proposals.length },
  })

  if (maxSteps < 1) return emit(0, true, 'max-steps')
  yield emit(0, false, null)

  for (let step = 1; step <= maxSteps; step++) {
    let moved = false
    let sawInBounds = false
    proposals = []

    for (let i = 0; i < attempts; i++) {
      const dir = randUnitVector(rng)
      const candidate = addVec(current.position, scaleVec(dir, stepSize))
      if (!inDomain(surface.domain, candidate.x, candidate.y)) continue

      sawInBounds = true
      const probe = at(surface, candidate)
      const accepted = probe.value >= current.value
      if (record) proposals.push({ ...probe, accepted })

      if (accepted) {
        current = probe
        best = better(best, probe)
        moved = true
        break
      }
    }

    // Only an in-bounds hop that failed to improve is evidence of a summit.
    if (moved) stalledFor = 0
    else if (sawInBounds) stalledFor++

    stepSize *= stepDecay

    if (stalledFor >= patience) return emit(step, true, 'converged')
    if (stepSize <= 0) return emit(step, true, 'stalled')
    // Emit the terminal state here rather than after the loop, so the last
    // step is not both yielded and returned.
    if (step === maxSteps) return emit(step, true, 'max-steps')

    yield emit(step, false, null)
  }

  throw new Error('unreachable: the loop returns on its final iteration')
}

// ── gradient ascent ────────────────────────────────────────────────────────

export interface GradientAscentOptions extends BaseOptions {
  /** Hop length along the gradient. Defaults to 1.5% of the domain diagonal. */
  readonly stepSize?: number
  readonly stepDecay?: number
  /**
   * Fraction of the previous hop carried into this one. The email's kangaroo
   * "has poor traction and can't make sharp turns".
   */
  readonly momentum?: number
  /**
   * Convergence threshold on gradient magnitude.
   *
   * todo.todo left open whether `tol` should mean the derivative or the change
   * in value. It is the derivative: a vanishing gradient is the actual
   * first-order optimality condition, and it does not change meaning when the
   * step size does. A value-change test cannot tell a summit apart from a step
   * size that has decayed to nothing — `valueTol` below covers that case
   * separately, and reports it as `stalled` rather than `converged`.
   */
  readonly gradientTol?: number
  /** Value change below which the run is considered stuck rather than done. */
  readonly valueTol?: number
  /**
   * Scale the gradient to unit length before stepping. Default `true`.
   *
   * True is the well-behaved default and false is what backprop actually does.
   * With it off, `stepSize` becomes a genuine **learning rate** — a plain
   * multiplier on the raw gradient — so hop length tracks how steep the ground
   * is. That is the whole of the email's complaint: "the distance the kangaroo
   * hops is related to the steepness of the terrain", tiny hops on a gentle
   * plain and dangerous ones on a mountainside. It cannot be demonstrated
   * while the gradient is normalized, because normalizing is precisely the fix.
   */
  readonly normalize?: boolean
}

/**
 * Steepest ascent. Take the gradient, normalize it, and hop `stepSize` along it.
 *
 * Normalizing is what todo.todo specified, and it matters: with a raw gradient,
 * hop length scales with steepness, which is precisely the failure the email
 * describes — "if the kangaroo starts on a gently sloping plain instead of a
 * mountain side, she will take very small hops... When she finally starts to
 * ascend a mountain, her hops get longer and more dangerous."
 */
export function* gradientAscent(
  surface: Surface,
  rng: Rng,
  opts: GradientAscentOptions = {},
): Generator<OptimizerState, OptimizerState> {
  const maxSteps = opts.maxSteps ?? 500
  const stepDecay = opts.stepDecay ?? 1
  const momentum = opts.momentum ?? 0
  const gradientTol = opts.gradientTol ?? 1e-6
  const valueTol = opts.valueTol ?? 0
  const normalizeStep = opts.normalize ?? true
  let stepSize = opts.stepSize ?? domainDiagonal(surface.domain) * 0.015

  let current = at(surface, opts.start ?? randomStart(surface, rng))
  let best = current
  let velocity: Vec2 = { x: 0, y: 0 }

  // Invariant: `grad` is always the gradient at `current.position`, so a state
  // reports the slope where the kangaroo is standing. Recomputing it at the top
  // of the loop instead left `meta.gradient` one step stale, which made the
  // reported slope disagree with the hop it produced.
  let grad = surface.gradient(current.position.x, current.position.y)

  const emit = (step: number, done: boolean, termination: Termination): OptimizerState => ({
    step,
    position: current.position,
    value: current.value,
    best,
    done,
    termination,
    meta: {
      stepSize,
      gradient: magnitude(grad),
      speed: magnitude(velocity),
      normalized: normalizeStep ? 1 : 0,
    },
  })

  if (maxSteps < 1) return emit(0, true, 'max-steps')
  yield emit(0, false, null)

  for (let step = 1; step <= maxSteps; step++) {
    const slope = magnitude(grad)

    if (!Number.isFinite(slope)) return emit(step, true, 'stalled')
    if (slope < gradientTol && momentum === 0) return emit(step, true, 'converged')

    // Normalized: hop length is a parameter. Raw: hop length is a consequence
    // of how steep the ground happens to be, and `stepSize` is a learning rate.
    const push = normalizeStep
      ? scaleVec(normalize(grad), stepSize)
      : scaleVec(grad, stepSize)
    velocity = addVec(scaleVec(velocity, momentum), push)

    const proposed = addVec(current.position, velocity)
    const landed = clampToDomain(surface.domain, proposed.x, proposed.y)

    // Momentum into a wall would otherwise keep pressing forever.
    if (landed.x !== proposed.x) velocity = { x: 0, y: velocity.y }
    if (landed.y !== proposed.y) velocity = { x: velocity.x, y: 0 }

    const previousValue = current.value
    current = at(surface, landed)
    grad = surface.gradient(current.position.x, current.position.y)
    best = better(best, current)
    stepSize *= stepDecay

    if (valueTol > 0 && Math.abs(current.value - previousValue) < valueTol) {
      return emit(step, true, 'stalled')
    }
    if (step === maxSteps) return emit(step, true, 'max-steps')

    yield emit(step, false, null)
  }

  throw new Error('unreachable: the loop returns on its final iteration')
}

// ── simulated annealing ────────────────────────────────────────────────────

export interface SimulatedAnnealingOptions extends BaseOptions {
  /** Starting temperature. Defaults to the surface's own vertical scale. */
  readonly temperature?: number
  /** Geometric cooling factor per step. */
  readonly cooling?: number
  /** Stop once temperature falls below this. */
  readonly minTemperature?: number
  /** Proposal spread, in domain units. Defaults to 5% of the diagonal. */
  readonly proposalScale?: number
}

/**
 * The drunk kangaroo: hop around at random, but sober up over time.
 *
 * Downhill hops are accepted with probability exp(delta / T), so early on she
 * will happily leave a summit, and late on she will not. `best` is tracked
 * separately from `position` because at any given moment she is very likely
 * standing somewhere worse than the best place she has been.
 */
export function* simulatedAnnealing(
  surface: Surface,
  rng: Rng,
  opts: SimulatedAnnealingOptions = {},
): Generator<OptimizerState, OptimizerState> {
  const maxSteps = opts.maxSteps ?? 2000
  const cooling = opts.cooling ?? 0.995
  const minTemperature = opts.minTemperature ?? 1e-4
  const scale = opts.proposalScale ?? domainDiagonal(surface.domain) * 0.05

  let current = at(surface, opts.start ?? randomStart(surface, rng))
  let best = current
  let temperature = opts.temperature ?? estimateVerticalScale(surface, rng)
  let accepted = 0
  let proposals: Proposal[] = []

  const record = opts.recordProposals ?? false

  const emit = (step: number, done: boolean, termination: Termination): OptimizerState => ({
    step,
    position: current.position,
    value: current.value,
    best,
    done,
    termination,
    ...(record ? { proposals } : {}),
    meta: { temperature, accepted, acceptRate: step === 0 ? 0 : accepted / step },
  })

  if (maxSteps < 1) return emit(0, true, 'max-steps')
  yield emit(0, false, null)

  for (let step = 1; step <= maxSteps; step++) {
    const proposal = clampToDomain(
      surface.domain,
      current.position.x + randNormal(rng) * scale,
      current.position.y + randNormal(rng) * scale,
    )
    const probe = at(surface, proposal)
    const delta = probe.value - current.value

    // Uphill is always taken; downhill depends on how drunk she still is.
    const chance = delta >= 0 ? 1 : Math.exp(delta / temperature)
    const take = delta >= 0 || rng.next() < chance

    if (record) proposals = [{ ...probe, accepted: take, acceptProbability: chance }]

    if (take) {
      current = probe
      best = better(best, probe)
      accepted++
    }

    temperature *= cooling
    if (temperature < minTemperature) return emit(step, true, 'converged')
    if (step === maxSteps) return emit(step, true, 'max-steps')

    yield emit(step, false, null)
  }

  throw new Error('unreachable: the loop returns on its final iteration')
}

/**
 * A rough measure of how much altitude varies on this surface, used as the
 * default starting temperature. Without it, one temperature cannot serve both
 * Himmelblau (range in the hundreds) and Ackley (range about 22).
 */
function estimateVerticalScale(surface: Surface, rng: Rng): number {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < 200; i++) {
    const p = randomStart(surface, rng)
    const v = surface.height(p.x, p.y)
    if (!Number.isFinite(v)) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const range = hi - lo
  return Number.isFinite(range) && range > 0 ? range / 4 : 1
}

// ── genetic algorithm ──────────────────────────────────────────────────────

export interface GeneticAlgorithmOptions extends BaseOptions {
  readonly populationSize?: number
  /** Fraction of the population that survives each cull. */
  readonly survivalRate?: number
  /** Mutation spread, in domain units. Defaults to 3% of the diagonal. */
  readonly mutationScale?: number
  /** Chance that a child is a blend of two parents rather than a clone. */
  readonly crossoverRate?: number
  /**
   * How far outside the parents a blended child may land, as a fraction of the
   * gap between them. This is the alpha of BLX-alpha.
   *
   * Zero is strict interpolation — every child lands *between* its parents —
   * and it is a diversity sink. The population's bounding box can then only
   * ever shrink, so under any selection pressure at all it contracts
   * geometrically onto its own centroid and the search collapses into one
   * basin long before it has finished looking. That is premature convergence,
   * and it is a real failure mode rather than an implementation detail: it was
   * what this code did, and on a four-summit landscape it went from four
   * occupied basins to one by generation ten.
   *
   * 0.5 is the value the literature settled on. It lets offspring overshoot,
   * which is what keeps a population able to widen as well as narrow.
   */
  readonly blendAlpha?: number
  /** Carry the single best individual through unchanged. */
  readonly elitism?: boolean
}

/**
 * "Every few years, you shoot the kangaroos at low altitudes and hope the ones
 * that are left will be fruitful, multiply, and ascend."
 *
 * Truncation selection, because that is exactly what the email describes —
 * sort by altitude, cull the bottom, breed from the survivors. Each yielded
 * state carries the whole population, so the widget can draw every kangaroo
 * and the cull reads as an event rather than a number changing.
 */
export function* geneticAlgorithm(
  surface: Surface,
  rng: Rng,
  opts: GeneticAlgorithmOptions = {},
): Generator<OptimizerState, OptimizerState> {
  const maxSteps = opts.maxSteps ?? 100
  const size = Math.max(2, opts.populationSize ?? 40)
  const survivalRate = Math.min(1, Math.max(1 / size, opts.survivalRate ?? 0.4))
  const mutationScale = opts.mutationScale ?? domainDiagonal(surface.domain) * 0.03
  const crossoverRate = opts.crossoverRate ?? 0.7
  const blendAlpha = opts.blendAlpha ?? 0.5
  const elitism = opts.elitism ?? true

  let population: Individual[] = Array.from({ length: size }, () =>
    at(surface, randomStart(surface, rng)),
  )
  population.sort((a, b) => b.value - a.value)
  let best = population[0]!

  const emit = (step: number, done: boolean, termination: Termination): OptimizerState => ({
    step,
    position: best.position,
    value: best.value,
    best,
    done,
    termination,
    population,
    meta: {
      generation: step,
      survivors: Math.max(1, Math.round(size * survivalRate)),
      meanValue: population.reduce((s, i) => s + i.value, 0) / population.length,
      spread: population[0]!.value - population[population.length - 1]!.value,
    },
  })

  if (maxSteps < 1) return emit(0, true, 'max-steps')
  yield emit(0, false, null)

  for (let step = 1; step <= maxSteps; step++) {
    const survivorCount = Math.max(1, Math.round(size * survivalRate))
    const survivors = population.slice(0, survivorCount)

    const next: Individual[] = elitism ? [survivors[0]!] : []
    while (next.length < size) {
      const a = survivors[randInt(rng, survivors.length)]!
      let childPos: Vec2

      if (survivors.length > 1 && rng.next() < crossoverRate) {
        const b = survivors[randInt(rng, survivors.length)]!
        // BLX-alpha. The child lands on the line through its parents, but may
        // fall beyond either of them by `blendAlpha` times their separation.
        // Restricting it to the segment between them — which is what this did
        // originally — means the population's extent can only shrink, and it
        // collapses onto its centroid within a few generations.
        //
        // Discrete per-axis swapping is the other classic choice and is worse
        // here: it confines offspring to the lattice their parents already
        // occupy, so a population that has lost a coordinate can never recover
        // it.
        const t = -blendAlpha + rng.next() * (1 + 2 * blendAlpha)
        childPos = {
          x: a.position.x + (b.position.x - a.position.x) * t,
          y: a.position.y + (b.position.y - a.position.y) * t,
        }
      } else {
        childPos = a.position
      }

      next.push(
        at(
          surface,
          clampToDomain(
            surface.domain,
            childPos.x + randNormal(rng) * mutationScale,
            childPos.y + randNormal(rng) * mutationScale,
          ),
        ),
      )
    }

    population = next.sort((a, b) => b.value - a.value)
    best = better(best, population[0]!)

    if (step === maxSteps) return emit(step, true, 'max-steps')
    yield emit(step, false, null)
  }

  throw new Error('unreachable: the loop returns on its final iteration')
}

// ── driving a run ──────────────────────────────────────────────────────────

/**
 * Run an optimizer to completion and collect every state.
 *
 * This is what the video renderer wants: the whole trajectory up front, so any
 * frame can be looked up by index without replaying from the start.
 */
export function collect(
  gen: Generator<OptimizerState, OptimizerState>,
  limit = 100_000,
): OptimizerState[] {
  const states: OptimizerState[] = []
  for (let i = 0; i < limit; i++) {
    const { value, done } = gen.next()
    states.push(value)
    if (done) return states
  }
  throw new Error(`Optimizer produced more than ${limit} states without finishing`)
}
