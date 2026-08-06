import {
  SURFACES,
  SURFACES_BY_NAME,
  bayesianOptimization,
  createSampledSurface,
  createTrueSurface,
  geneticAlgorithm,
  gradientAscent,
  hillClimber,
  simulatedAnnealing,
  type OptimizerFactory,
  type Surface,
  type Vec2,
} from '@kangaroos/core'

/**
 * Naming and configuring the searches, in one place.
 *
 * Extracted from `SearchFigure` when the tool page needed the same list. Two
 * copies of this would have been the obvious way to get the tool built quickly
 * and the fastest possible route to a tool that quietly disagrees with the
 * article about what "annealing" is configured as.
 */

export type AlgorithmName =
  | 'hill-climber'
  | 'gradient-ascent'
  | 'gradient-ascent-raw'
  | 'annealing'
  | 'genetic'
  | 'bayesian'

export interface AlgorithmSpec {
  readonly id: AlgorithmName
  readonly label: string
  /** One line, for the tool's own UI. */
  readonly blurb: string
  /** Which knobs mean anything for this one. */
  readonly knobs: readonly ('rate' | 'decay' | 'population' | 'kappa')[]
  readonly defaultSteps: number
}

export const ALGORITHMS: readonly AlgorithmSpec[] = [
  {
    id: 'hill-climber',
    label: 'Hill climber',
    blurb: 'Jump somewhere nearby at random. Keep it only if it is higher.',
    knobs: ['decay'],
    defaultSteps: 220,
  },
  {
    id: 'gradient-ascent',
    label: 'Gradient ascent',
    blurb: 'Measure the slope and step a fixed distance uphill.',
    knobs: ['rate', 'decay'],
    defaultSteps: 220,
  },
  {
    id: 'gradient-ascent-raw',
    label: 'Gradient ascent, raw',
    blurb: 'Step size proportional to steepness — a real learning rate, and it can throw her off the mountain.',
    knobs: ['rate', 'decay'],
    defaultSteps: 220,
  },
  {
    id: 'annealing',
    label: 'Simulated annealing',
    blurb: 'Drunk at first, accepting downhill moves; sobers up as it goes.',
    knobs: [],
    defaultSteps: 700,
  },
  {
    id: 'genetic',
    label: 'Genetic algorithm',
    blurb: 'A whole population. The high ones breed, the low ones do not.',
    knobs: ['population'],
    defaultSteps: 70,
  },
  {
    id: 'bayesian',
    label: 'Bayesian optimization',
    blurb: 'Draws a map from where she has stood, then picks the most promising place she has not.',
    knobs: ['kappa'],
    defaultSteps: 40,
  },
]

export const ALGORITHMS_BY_ID = Object.freeze(
  Object.fromEntries(ALGORITHMS.map((a) => [a.id, a])),
) as Record<AlgorithmName, AlgorithmSpec>

/** The analytic surfaces, plus the two synthetic ones Act 4 builds. */
export const SURFACE_OPTIONS: readonly { value: string; label: string; group: string }[] = [
  ...SURFACES.map((s) => ({ value: s.name, label: s.name, group: 'Benchmark' })),
  { value: 'data:20', label: '20 examples', group: 'Built from data' },
  { value: 'data:200', label: '200 examples', group: 'Built from data' },
  { value: 'truth', label: 'The true landscape', group: 'Built from data' },
  { value: 'dem:everest', label: 'Everest', group: 'Real terrain' },
  { value: 'dem:k2', label: 'K2', group: 'Real terrain' },
  { value: 'dem:himalaya', label: 'The Himalaya', group: 'Real terrain' },
  { value: 'dem:chapel-hill', label: 'Chapel Hill, NC', group: 'Real terrain' },
  { value: 'dem:australia', label: 'Australia', group: 'Real terrain' },
  { value: 'dem:indian-ocean', label: 'The Indian Ocean', group: 'Real terrain' },
]

/** The region name for a `dem:` spec, or null for everything else. */
export function demRegionOf(spec: string): string | null {
  return spec.startsWith('dem:') ? spec.slice(4) : null
}

export function resolveSurface(spec: string, dataSeed: number): Surface {
  if (spec === 'truth') return createTrueSurface()
  if (spec.startsWith('data:')) {
    return createSampledSurface({ count: Number(spec.slice(5)) || 20, seed: dataSeed })
  }
  return SURFACES_BY_NAME[spec] ?? SURFACES_BY_NAME.Himmelblau!
}

export interface FactoryOptions {
  readonly rate?: number
  readonly stepDecay?: number
  readonly start?: Vec2
  readonly maxSteps?: number
  readonly populationSize?: number
  /** Exploration dial for Bayesian optimization's UCB acquisition. */
  readonly kappa?: number
  /**
   * Carry the posterior grids on every state. Only the Bayesian scene draws
   * them, and four runs of forty steps at 48x48x3 is 1.1 million doubles that
   * a plain search view never looks at.
   */
  readonly recordModel?: boolean
}

/**
 * The algorithm as a factory, so one run and many runs are configured
 * identically.
 *
 * This is what keeps a multistart honest: every kangaroo runs the same
 * algorithm with the same options and differs only in its seed, which is what
 * makes the spread of outcomes attributable to where she landed rather than to
 * how she was tuned.
 */
export function makeFactory(name: AlgorithmName, opts: FactoryOptions = {}): OptimizerFactory {
  const start = opts.start
  const steps = opts.maxSteps
  switch (name) {
    case 'gradient-ascent':
      return (s, rng) =>
        gradientAscent(s, rng, { stepDecay: opts.stepDecay ?? 0.99, maxSteps: steps ?? 220, start })
    case 'gradient-ascent-raw':
      // The learning-rate figure: hop length tracks slope, as backprop's does.
      return (s, rng) =>
        gradientAscent(s, rng, {
          normalize: false,
          stepSize: opts.rate ?? 0.01,
          stepDecay: opts.stepDecay ?? 1,
          maxSteps: steps ?? 220,
          start,
        })
    case 'annealing':
      return (s, rng) =>
        simulatedAnnealing(s, rng, { recordProposals: true, maxSteps: steps ?? 700, start })
    case 'genetic':
      return (s, rng) =>
        geneticAlgorithm(s, rng, {
          maxSteps: steps ?? 70,
          populationSize: opts.populationSize ?? 24,
          start,
        })
    case 'bayesian':
      return (s, rng) =>
        bayesianOptimization(s, rng, {
          maxSteps: steps ?? 40,
          acquisition: 'ucb',
          kappa: opts.kappa ?? 1.5,
          recordModel: opts.recordModel ?? true,
          start,
        })
    default:
      return (s, rng) =>
        hillClimber(s, rng, {
          recordProposals: true,
          stepDecay: opts.stepDecay ?? 1,
          maxSteps: steps ?? 220,
          start,
        })
  }
}
