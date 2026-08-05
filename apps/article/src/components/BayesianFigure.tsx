import {
  SURFACES_BY_NAME,
  bayesianOptimization,
  collect,
  createSampledSurface,
  hopDuration,
  mulberry32,
  type BayesianState,
  type Surface,
} from '@kangaroos/core'
import { BayesianScene, useBeliefView } from '@kangaroos/scene'
import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'

import { NearViewport } from './Figure.js'

/**
 * A benchmark name, or `data:<count>` for a landscape built from examples.
 *
 * The default is `data:40`, and the choice is load-bearing rather than
 * aesthetic. Measured over the domain, her final belief correlates 0.94 with
 * that landscape and only 0.71 with Himmelblau — whose four narrow peaks over a
 * range of nearly nine hundred units simply cannot be learned from twenty
 * samples, so the belief surface stays a flat plane for the whole run and the
 * section's whole claim goes unillustrated. It also shares its generator with
 * act four, which is a bonus: the same landscape, once as something she models
 * and once as something built out of data.
 */
function resolveSurface(spec: string): Surface {
  if (spec.startsWith('data:')) {
    return createSampledSurface({ count: Number(spec.slice(5)) || 40, seed: 1 })
  }
  return SURFACES_BY_NAME[spec] ?? SURFACES_BY_NAME.Himmelblau!
}

export interface BayesianFigureProps {
  surface?: string
  /** Render the real landscape instead of her belief, for the comparison. */
  showTruth?: boolean
  seed?: number
  steps?: number
  /** Frames per hop. Slower than the blind methods on purpose — see below. */
  framesPerStep?: number
  height?: number
  contours?: number
  fogStrength?: number
  caption?: string
  loop?: boolean
}

/**
 * The kangaroo who draws her own map.
 *
 * Paced far slower than the other figures. Every other method in the piece is
 * making hundreds of cheap decisions and the animation has to keep up; this one
 * makes twenty expensive ones, and each is worth stopping on — the belief
 * surface changes shape between hops, and at this speed the reader can watch it
 * happen rather than seeing terrain flicker.
 */
export function BayesianFigure({
  surface: surfaceName = 'data:40',
  showTruth = false,
  seed = 3,
  steps = 22,
  framesPerStep = 26,
  height = 460,
  contours = 16,
  fogStrength = 0.85,
  caption,
  loop = true,
}: BayesianFigureProps) {
  return (
    <figure className="figure figure-scene">
      <NearViewport minHeight={height}>
        <BayesianFigureBody
          surfaceName={surfaceName}
          showTruth={showTruth}
          seed={seed}
          steps={steps}
          framesPerStep={framesPerStep}
          height={height}
          contours={contours}
          fogStrength={fogStrength}
          loop={loop}
        />
      </NearViewport>
      {caption && <figcaption className="figure-caption">{caption}</figcaption>}
    </figure>
  )
}

function BayesianFigureBody(props: {
  surfaceName: string
  showTruth: boolean
  seed: number
  steps: number
  framesPerStep: number
  height: number
  contours: number
  fogStrength: number
  loop: boolean
}) {
  const surface = useMemo(() => resolveSurface(props.surfaceName), [props.surfaceName])

  const states = useMemo(
    () =>
      collect(
        bayesianOptimization(surface, mulberry32(props.seed), {
          maxSteps: props.steps,
          resolution: 56,
        }),
      ) as BayesianState[],
    [surface, props.seed, props.steps],
  )

  const view = useBeliefView(surface, states)
  const total = hopDuration(view.path.length, props.framesPerStep)

  const [frame, setFrame] = useState(0)
  const raf = useRef(0)

  useEffect(() => {
    let last: number | null = null
    const tick = (now: number) => {
      const delta = last === null ? 0 : Math.max(0, (now - last) / (1000 / 60))
      last = now
      setFrame((f) => {
        const next = f + delta
        return props.loop && next > total + 150 ? 0 : next
      })
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [total, props.loop])

  return (
    <div className="scene-shell" style={{ height: props.height }}>
      <Canvas shadows dpr={[1, 2]} camera={{ position: [1.9, 1.5, 1.9], fov: 42 }}>
        <BayesianScene
          surface={surface}
          view={view}
          frame={frame}
          framesPerStep={props.framesPerStep}
          contours={props.contours}
          fogStrength={props.fogStrength}
          showTruth={props.showTruth}
        />
      </Canvas>
    </div>
  )
}
