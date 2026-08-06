import {
  SURFACES_BY_NAME,
  createSampledSurface,
  createTrueSurface,
  geneticAlgorithm,
  gradientAscent,
  hillClimber,
  hopDuration,
  runMultistart,
  simulatedAnnealing,
  type OptimizerFactory,
  type Surface,
  type Vec2,
} from '@kangaroos/core'
import { SearchScene, useMultiRunView } from '@kangaroos/scene'
import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useDemSurface } from '../lib/dem.js'
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
  /**
   * How many kangaroos to drop, each from a different seed.
   *
   * One search shows how an algorithm moves. Several show whether it can be
   * relied on, which is a different question and usually the more important
   * one — four runs fanning out to four different summits says more about a
   * hill climber than any single run of it can.
   *
   * Four is where individual colour runs out. More than that still renders,
   * but as one uniformly coloured crowd — nobody tracks six kangaroos by hue,
   * so past that point the shape of the swarm is the only readable thing and
   * the figure may as well say so.
   */
  runs?: number
  dataSeed?: number
  /** Learning rate for the raw-gradient variant. */
  rate?: number
  stepDecay?: number
  /**
   * Fixed starting point, in domain coordinates.
   *
   * Worth pinning wherever the figure is about *how she moves* rather than
   * about where she happens to land. The learning-rate figures needed it
   * badly: seed 4 parachutes her in at (4.2, -1.7), which is 0.7 units from a
   * summit, so every one of them opened with her already at the top. "Too
   * small a rate" then looked like hopping on the spot, and the decaying rate
   * looked like it went nowhere — both true, and neither the point.
   */
  startX?: number
  startY?: number
  /** Cap on iterations, when the default is more than the figure can show. */
  maxSteps?: number
  framesPerStep?: number
  height?: number
  showGradients?: boolean
  showProbes?: boolean
  contours?: number
  ramp?: string
  /** Sight radius as a fraction of the domain's shorter side. Omit for no fog. */
  fog?: number
  /** `trail` for everywhere she has been, `window` for only what she senses now. */
  fogMode?: 'trail' | 'window'
  /** `generations` for a population that stands still and fades by age. */
  populationStyle?: 'hop' | 'generations'
  /**
   * Trail stroke width in screen pixels.
   *
   * Worth turning down wherever the trail is not the subject. On the
   * rejected-probe figure the default 3.5 is thick enough to bury the spokes it
   * is supposed to be contrasted against.
   */
  trailWidth?: number
  /**
   * Where to view the landscape from. Only the direction — the distance is
   * solved so the terrain fills the plate at whatever size it is drawn.
   */
  camera?: { readonly azimuth?: number; readonly elevation?: number; readonly fill?: number }
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

/**
 * The algorithm as a factory, so one run and many runs are configured
 * identically.
 *
 * This is what keeps a multistart figure honest: every kangaroo runs the same
 * algorithm with the same options and differs only in its seed, which is what
 * makes the spread of outcomes attributable to where she landed rather than to
 * how she was tuned.
 */
function makeFactory(
  name: AlgorithmName,
  opts: { rate?: number; stepDecay?: number; start?: Vec2; maxSteps?: number },
): OptimizerFactory {
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
        geneticAlgorithm(s, rng, { maxSteps: steps ?? 70, populationSize: 24, start })
    default:
      return (s, rng) =>
        hillClimber(s, rng, { recordProposals: true, maxSteps: steps ?? 220, start })
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
  runs = 1,
  dataSeed = 0,
  rate,
  stepDecay,
  startX,
  startY,
  maxSteps,
  framesPerStep = 7,
  height = 420,
  showGradients = false,
  showProbes = false,
  contours = 22,
  ramp,
  fog,
  fogMode = 'trail',
  populationStyle,
  trailWidth,
  camera,
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
          runs={runs}
          dataSeed={dataSeed}
          rate={rate}
          stepDecay={stepDecay}
          startX={startX}
          startY={startY}
          maxSteps={maxSteps}
          framesPerStep={framesPerStep}
          height={height}
          showGradients={showGradients}
          showProbes={showProbes}
          contours={contours}
          ramp={ramp}
          fog={fog}
          fogMode={fogMode}
          populationStyle={populationStyle}
          trailWidth={trailWidth}
          camera={camera}
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
  runs: number
  dataSeed: number
  rate?: number
  stepDecay?: number
  startX?: number
  startY?: number
  maxSteps?: number
  framesPerStep: number
  height: number
  showGradients: boolean
  showProbes: boolean
  contours: number
  ramp?: string
  fog?: number
  fogMode: 'trail' | 'window'
  populationStyle?: 'hop' | 'generations'
  trailWidth?: number
  camera?: { readonly azimuth?: number; readonly elevation?: number; readonly fill?: number }
  loop: boolean
}) {
  // Real terrain arrives over the network, so it cannot come from the
  // synchronous resolver. The hook is called unconditionally with null for
  // analytic surfaces, which is the rule about hooks, not a style choice.
  const demRegion = props.surfaceName.startsWith('dem:') ? props.surfaceName.slice(4) : null
  const dem = useDemSurface(demRegion)

  // A stand-in while a region is in flight, so every hook below runs against a
  // real surface and none of them needs a null branch. It is never drawn — the
  // shell renders a placeholder until `dem` arrives.
  const analytic = useMemo(
    () => resolveSurface(demRegion ? 'Himmelblau' : props.surfaceName, props.dataSeed),
    [demRegion, props.surfaceName, props.dataSeed],
  )
  const surface = dem?.surface ?? analytic
  const pending = demRegion !== null && dem === null

  const runs = useMemo(() => {
    const factory = makeFactory(props.algorithm, {
      rate: props.rate,
      stepDecay: props.stepDecay,
      // A pinned start applies to the lead run only; several runs from one
      // point would not be a multistart.
      start:
        props.startX !== undefined && props.startY !== undefined && props.runs <= 1
          ? { x: props.startX, y: props.startY }
          : undefined,
      maxSteps: props.maxSteps,
    })
    // Seeds run from `seed`, so a figure showing four runs and a figure showing
    // one both start with the same kangaroo. The single run is the first of the
    // four rather than a different search entirely, which is what lets one
    // figure be read as a close-up of another.
    const seeds = Array.from({ length: Math.max(1, props.runs) }, (_, i) => props.seed + i)
    return runMultistart(surface, factory, { seeds })
  }, [
    props.algorithm,
    surface,
    props.seed,
    props.runs,
    props.rate,
    props.stepDecay,
    props.startX,
    props.startY,
    props.maxSteps,
  ])

  const view = useMultiRunView(surface, runs, { verticalScale: dem?.verticalScale })

  // The longest run owns the clock — ending the animation when the *first*
  // kangaroo settles would cut away from everyone still climbing.
  const total = hopDuration(view.path.length, props.framesPerStep)
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

  if (pending) {
    return (
      <div className="scene-shell scene-loading" style={{ height: props.height }}>
        <span>Loading terrain…</span>
      </div>
    )
  }

  return (
    <div className="scene-shell" style={{ height: props.height }}>
      {/*
        No camera position. `FitCamera` inside the scene solves for one from
        the canvas aspect, so the terrain fills the plate at every width
        instead of sitting small in the middle of a 2.3:1 letterbox.
      */}
      <Canvas shadows dpr={[1, 2]} camera={{ fov: 42 }}>
        <SearchScene
          surface={surface}
          view={view}
          frame={frame}
          framesPerStep={props.framesPerStep}
          showGradients={props.showGradients}
          showProbes={props.showProbes}
          contours={props.contours}
          ramp={props.ramp}
          populationStyle={props.populationStyle}
          trailWidth={props.trailWidth}
          camera={props.camera}
          fog={
            props.fog
              ? {
                  radius:
                    Math.min(
                      surface.domain.xMax - surface.domain.xMin,
                      surface.domain.yMax - surface.domain.yMin,
                    ) * props.fog,
                  mode: props.fogMode,
                }
              : undefined
          }
        />
      </Canvas>
    </div>
  )
}
