import {
  SURFACES_BY_NAME,
  collect,
  createSampledSurface,
  createTrueSurface,
  geneticAlgorithm,
  gradientAscent,
  hillClimber,
  hopDuration,
  mulberry32,
  simulatedAnnealing,
  type OptimizerState,
  type Surface,
} from '@kangaroos/core'
import { SearchScene, useRunView } from '@kangaroos/scene'
import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'

import { NearViewport } from './Figure.js'

export type AlgorithmName =
  | 'hill-climber'
  | 'gradient-ascent'
  | 'gradient-ascent-raw'
  | 'annealing'
  | 'genetic'

export interface SearchFigureProps {
  /** A benchmark surface name, or `data:<count>` / `truth` for Act 4. */
  surface?: string
  algorithm?: AlgorithmName
  seed?: number
  dataSeed?: number
  /** Learning rate for the raw-gradient variant. */
  rate?: number
  stepDecay?: number
  framesPerStep?: number
  height?: number
  showGradients?: boolean
  showProbes?: boolean
  contours?: number
  ramp?: string
  caption?: string
  /** Loop the run rather than stopping on the last frame. */
  loop?: boolean
}

function resolveSurface(spec: string, dataSeed: number): Surface {
  if (spec === 'truth') return createTrueSurface()
  if (spec.startsWith('data:')) {
    return createSampledSurface({ count: Number(spec.slice(5)) || 20, seed: dataSeed })
  }
  return SURFACES_BY_NAME[spec] ?? SURFACES_BY_NAME.Himmelblau!
}

function runAlgorithm(
  name: AlgorithmName,
  surface: Surface,
  seed: number,
  opts: { rate?: number; stepDecay?: number },
): OptimizerState[] {
  const rng = mulberry32(seed)
  switch (name) {
    case 'gradient-ascent':
      return collect(
        gradientAscent(surface, rng, { stepDecay: opts.stepDecay ?? 0.99, maxSteps: 220 }),
      )
    case 'gradient-ascent-raw':
      // The learning-rate figure: hop length tracks slope, as backprop's does.
      return collect(
        gradientAscent(surface, rng, {
          normalize: false,
          stepSize: opts.rate ?? 0.01,
          stepDecay: opts.stepDecay ?? 1,
          maxSteps: 220,
        }),
      )
    case 'annealing':
      return collect(simulatedAnnealing(surface, rng, { recordProposals: true, maxSteps: 700 }))
    case 'genetic':
      return collect(geneticAlgorithm(surface, rng, { maxSteps: 70, populationSize: 24 }))
    default:
      return collect(hillClimber(surface, rng, { recordProposals: true, maxSteps: 220 }))
  }
}

/**
 * One 3D search, playing on a loop.
 *
 * Deliberately not interactive beyond orbiting. An article figure that demands
 * you find and press play mostly does not get watched; it should be running by
 * the time the reader's eye arrives.
 */
export function SearchFigure({
  surface: surfaceName = 'Himmelblau',
  algorithm = 'hill-climber',
  seed = 1,
  dataSeed = 0,
  rate,
  stepDecay,
  framesPerStep = 7,
  height = 420,
  showGradients = false,
  showProbes = false,
  contours = 22,
  ramp,
  caption,
  loop = true,
}: SearchFigureProps) {
  return (
    <figure className="figure figure-scene">
      <NearViewport minHeight={height}>
        <SearchFigureBody
          surfaceName={surfaceName}
          algorithm={algorithm}
          seed={seed}
          dataSeed={dataSeed}
          rate={rate}
          stepDecay={stepDecay}
          framesPerStep={framesPerStep}
          height={height}
          showGradients={showGradients}
          showProbes={showProbes}
          contours={contours}
          ramp={ramp}
          loop={loop}
        />
      </NearViewport>
      {caption && <figcaption className="figure-caption">{caption}</figcaption>}
    </figure>
  )
}

function SearchFigureBody(props: {
  surfaceName: string
  algorithm: AlgorithmName
  seed: number
  dataSeed: number
  rate?: number
  stepDecay?: number
  framesPerStep: number
  height: number
  showGradients: boolean
  showProbes: boolean
  contours: number
  ramp?: string
  loop: boolean
}) {
  const surface = useMemo(
    () => resolveSurface(props.surfaceName, props.dataSeed),
    [props.surfaceName, props.dataSeed],
  )
  const states = useMemo(
    () => runAlgorithm(props.algorithm, surface, props.seed, { rate: props.rate, stepDecay: props.stepDecay }),
    [props.algorithm, surface, props.seed, props.rate, props.stepDecay],
  )
  const view = useRunView(surface, states)

  const total = hopDuration(states.length, props.framesPerStep)
  const [frame, setFrame] = useState(0)
  const raf = useRef(0)

  useEffect(() => {
    let last: number | null = null
    const tick = (now: number) => {
      // rAF hands you the frame's start time, which can predate the moment this
      // effect ran; without the clamp the first delta is negative.
      const delta = last === null ? 0 : Math.max(0, (now - last) / (1000 / 60))
      last = now
      setFrame((f) => {
        const next = f + delta
        // A short beat on the final frame before restarting, so the last state
        // is readable rather than flashing past.
        return props.loop && next > total + 90 ? 0 : next
      })
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [total, props.loop])

  return (
    <div className="scene-shell" style={{ height: props.height }}>
      <Canvas shadows dpr={[1, 2]} camera={{ position: [1.9, 1.5, 1.9], fov: 42 }}>
        <SearchScene
          surface={surface}
          view={view}
          frame={frame}
          framesPerStep={props.framesPerStep}
          showGradients={props.showGradients}
          showProbes={props.showProbes}
          contours={props.contours}
          ramp={props.ramp}
        />
      </Canvas>
    </div>
  )
}
