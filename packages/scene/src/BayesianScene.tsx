import { CKColor, CKMarker, hexToInt } from '@contentkit/tokens'
import {
  createSceneTransform,
  hopAt,
  type BayesianState,
  type PosteriorGrid,
  type SceneTransform,
  type Vec2,
  type Surface,
  type Vec3,
} from '@kangaroos/core'
import { OrbitControls } from '@react-three/drei'
import { useMemo } from 'react'

import { BeliefTerrain, Cairns, NextTarget } from './BeliefTerrain.js'
import { statesToWorld } from './geometry.js'
import { HopTrail } from './HopTrail.js'
import { Kangaroo } from './Kangaroo.js'
import { SceneLighting, Terrain } from './Terrain.js'

const FLAT_ARC = { apexRatio: 0.1 } as const

/**
 * Bilinear sample of a posterior grid at a domain point.
 *
 * The ring marking her next target has to sit on the ground she is *standing*
 * on, which is her belief — not on the true altitude there. Using the true
 * value put the ring underneath the belief surface wherever she had
 * underestimated the terrain, so it floated in space below the mesh, which
 * reads as a rendering fault rather than as a disagreement between map and
 * world.
 */
function sampleGrid(grid: PosteriorGrid, surface: Surface, p: Vec2): number {
  const d = surface.domain
  const n = grid.resolution
  const fx = ((p.x - d.xMin) / (d.xMax - d.xMin)) * (n - 1)
  const fy = ((p.y - d.yMin) / (d.yMax - d.yMin)) * (n - 1)
  const i0 = Math.min(n - 1, Math.max(0, Math.floor(fx)))
  const j0 = Math.min(n - 1, Math.max(0, Math.floor(fy)))
  const i1 = Math.min(n - 1, i0 + 1)
  const j1 = Math.min(n - 1, j0 + 1)
  const tx = fx - i0
  const ty = fy - j0

  const a = grid.mean[j0 * n + i0]!
  const b = grid.mean[j0 * n + i1]!
  const c = grid.mean[j1 * n + i0]!
  const e = grid.mean[j1 * n + i1]!
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + e * tx * ty
}

export interface BeliefView {
  readonly states: readonly BayesianState[]
  readonly transform: SceneTransform
  readonly path: readonly Vec3[]
}

/**
 * One transform for the whole run, built from the *true* surface.
 *
 * Deliberately not from the posterior. Her belief's altitude range changes
 * every step as she learns, and a transform derived from it would rescale the
 * world underneath her — the mountains would appear to grow while she stood
 * still, which is a different and much less interesting claim than the one this
 * section is making. Pinning the vertical scale to the truth means the belief
 * surface visibly rises toward the real terrain instead of the frame chasing
 * it.
 */
export function useBeliefView(
  surface: Surface,
  states: readonly BayesianState[],
  options: { verticalScale?: number } = {},
): BeliefView {
  const transform = useMemo(
    () => createSceneTransform(surface, { verticalScale: options.verticalScale }),
    [surface, options.verticalScale],
  )
  return useMemo(
    () => ({ states, transform, path: statesToWorld(states, transform) }),
    [states, transform],
  )
}

export interface BayesianSceneProps {
  surface: Surface
  view: BeliefView
  frame: number
  framesPerStep?: number
  /**
   * Draw the real landscape instead of her belief.
   *
   * A separate figure rather than a ghost layer under the belief surface. Two
   * translucent terrains have the same ordering problem that killed the
   * overlay in the training-data act, and here it would be worse — the fog is
   * already using transparency to mean something. Two opaque figures sharing a
   * camera and a vertical scale compare perfectly well, and the reader can look
   * back and forth as long as they like.
   */
  showTruth?: boolean
  contours?: number
  ramp?: string
  fogStrength?: number
  orbit?: boolean
}

/**
 * Twenty deliberate hops, on a landscape she is drawing as she goes.
 *
 * The one figure in the piece where the ground the kangaroo stands on is not
 * the real ground. That is the point, and it is why the belief surface is
 * rendered solid and the truth is not rendered at all by default: she cannot
 * see the truth, and neither, for most of this section, should the reader.
 */
export function BayesianScene({
  surface,
  view,
  frame,
  framesPerStep = 22,
  contours = 16,
  ramp,
  fogStrength = 0.85,
  showTruth = false,
  orbit = true,
}: BayesianSceneProps) {
  const { states, transform, path } = view
  const cursor = hopAt(path.length, frame, framesPerStep)

  const from = path[cursor.index] ?? { x: 0, y: 0, z: 0 }
  const to = path[cursor.index + 1] ?? from
  const reveal = path.length < 2 ? 1 : (cursor.index + cursor.t) / (path.length - 1)

  // The model that *chose* this step, so a reader pausing mid-hop sees the map
  // she decided from rather than one already updated with where she landed.
  const grid: PosteriorGrid | undefined = useMemo(() => {
    for (let i = Math.min(cursor.index, states.length - 1); i >= 0; i--) {
      const m = states[i]?.model
      if (m) return m
    }
    return undefined
  }, [states, cursor.index])

  const observations = useMemo(
    () => states[Math.min(cursor.index, states.length - 1)]?.observations ?? [],
    [states, cursor.index],
  )

  const target = states[Math.min(cursor.index + 1, states.length - 1)]

  return (
    <>
      <color attach="background" args={[hexToInt(CKColor.void)]} />
      <fog attach="fog" args={[hexToInt(CKColor.void), 3.2, 7]} />
      <SceneLighting />

      {showTruth ? (
        <Terrain surface={surface} transform={transform} contours={contours} ramp={ramp} />
      ) : (
        grid && (
        <BeliefTerrain
          grid={grid}
          surface={surface}
          transform={transform}
          contours={contours}
          ramp={ramp}
          fogStrength={fogStrength}
        />
        )
      )}

      <Cairns observations={observations} transform={transform} />

      {target && grid && !showTruth && (
        <NextTarget
          target={target.position}
          height={sampleGrid(grid, surface, target.position)}
          transform={transform}
          t={cursor.t}
        />
      )}

      {/*
        A flatter arc than everywhere else in the piece. The default apex is
        proportional to hop distance and uncapped, which is the right choice
        when the reader is meant to notice that a step was enormous. Here every
        step is a deliberate jump to the other side of the map, so the arcs
        carry no information and, at full height, tower over the terrain they
        are annotating.
      */}
      <HopTrail
        points={path}
        reveal={reveal}
        width={3.5}
        color={CKMarker.fill}
        hop={FLAT_ARC}
      />
      <Kangaroo from={from} to={to} t={cursor.t} hop={FLAT_ARC} />

      {orbit && (
        <OrbitControls
          makeDefault
          enablePan={false}
          minDistance={1.4}
          maxDistance={5}
          maxPolarAngle={Math.PI * 0.49}
          target={[0, 0.1, 0]}
        />
      )}
    </>
  )
}
