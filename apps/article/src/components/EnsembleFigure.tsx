import { BasinChart, ConvergenceChart, SuccessChart } from '@kangaroos/charts'
import {
  SURFACES_BY_NAME,
  gradientAscent,
  hillClimber,
  runEnsemble,
  simulatedAnnealing,
  geneticAlgorithm,
  type EnsembleResult,
  type Surface,
} from '@kangaroos/core'
import { useMemo } from 'react'

import { NearViewport } from './Figure.js'

const FACTORIES = {
  'hill climber': (s: Surface, rng: never) => hillClimber(s, rng),
  'gradient ascent': (s: Surface, rng: never) => gradientAscent(s, rng, { stepDecay: 0.99 }),
  annealing: (s: Surface, rng: never) => simulatedAnnealing(s, rng),
  'genetic algorithm': (s: Surface, rng: never) => geneticAlgorithm(s, rng),
} as const

export type AlgoLabel = keyof typeof FACTORIES

function build(surface: Surface, labels: readonly AlgoLabel[], seeds: number) {
  return labels.map((label) => ({
    label,
    ensemble: runEnsemble(surface, FACTORIES[label] as never, { seedCount: seeds }) as EnsembleResult,
  }))
}

export interface EnsembleFigureProps {
  surface?: string
  algorithms?: readonly AlgoLabel[]
  seeds?: number
  chart?: 'convergence' | 'success' | 'basins'
  caption?: string
}

/**
 * A cross-run figure: the same algorithms, many seeds, summarised.
 *
 * Separate from the 3D scene on purpose. One run shows how a method searches;
 * only an ensemble shows how often that works, and the two answers are
 * frequently different.
 */
export function EnsembleFigure({
  surface: surfaceName = 'Himmelblau',
  algorithms = ['hill climber', 'gradient ascent', 'annealing'],
  seeds = 30,
  chart = 'convergence',
  caption,
}: EnsembleFigureProps) {
  return (
    <figure className="figure">
      <NearViewport minHeight={chart === 'convergence' ? 300 : 200}>
        <EnsembleBody surfaceName={surfaceName} algorithms={algorithms} seeds={seeds} chart={chart} />
      </NearViewport>
      {caption && <figcaption className="figure-caption">{caption}</figcaption>}
    </figure>
  )
}

function EnsembleBody({
  surfaceName,
  algorithms,
  seeds,
  chart,
}: {
  surfaceName: string
  algorithms: readonly AlgoLabel[]
  seeds: number
  chart: 'convergence' | 'success' | 'basins'
}) {
  const surface = SURFACES_BY_NAME[surfaceName] ?? SURFACES_BY_NAME.Himmelblau!
  const results = useMemo(() => build(surface, algorithms, seeds), [surface, algorithms, seeds])

  if (chart === 'success') return <SuccessChart results={results} />
  if (chart === 'basins') {
    return (
      <BasinChart
        ensemble={results[0]!.ensemble}
        radius={(surface.domain.xMax - surface.domain.xMin) * 0.05}
      />
    )
  }
  return <ConvergenceChart series={results} height={280} />
}
