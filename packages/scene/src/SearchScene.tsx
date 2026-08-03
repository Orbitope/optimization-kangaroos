import { CKColor, dataSeries, hexToInt } from '@contentkit/tokens'
import {
  createSceneTransform,
  hopAt,
  type OptimizerState,
  type SceneTransform,
  type Surface,
  type Vec3,
} from '@kangaroos/core'
import { OrbitControls } from '@react-three/drei'
import { useMemo } from 'react'

import { GradientField } from './GradientField.js'
import { statesToWorld } from './geometry.js'
import { HopTrail, RejectedProbes } from './HopTrail.js'
import { Kangaroo, KangarooCrowd } from './Kangaroo.js'
import { SceneLighting, Terrain } from './Terrain.js'

export interface RunView {
  readonly states: readonly OptimizerState[]
  readonly transform: SceneTransform
  /** One world position per state. */
  readonly path: readonly Vec3[]
  /** Per-state world positions for every population member, when present. */
  readonly populationPaths: readonly Vec3[][] | null
}

/**
 * Precompute everything positional for a run.
 *
 * Doing this once per run rather than per frame is the difference between a
 * scene that holds 60fps and one that recomputes a few thousand coordinate
 * transforms every time the playhead moves.
 */
export function useRunView(
  surface: Surface,
  states: readonly OptimizerState[],
  options: { verticalScale?: number } = {},
): RunView {
  const transform = useMemo(
    () => createSceneTransform(surface, { verticalScale: options.verticalScale }),
    [surface, options.verticalScale],
  )

  return useMemo(() => {
    const path = statesToWorld(states, transform)

    const size = states[0]?.population?.length ?? 0
    let populationPaths: Vec3[][] | null = null
    if (size > 0) {
      // Transposed: one path per individual, so a crowd member's hop is a
      // lookup rather than a search through every generation.
      populationPaths = Array.from({ length: size }, () => [] as Vec3[])
      for (const s of states) {
        s.population?.forEach((ind, i) => {
          populationPaths![i]?.push(transform.toWorld(ind.position.x, ind.position.y, ind.value))
        })
      }
    }

    return { states, transform, path, populationPaths }
  }, [states, transform])
}

export interface SearchSceneProps {
  surface: Surface
  view: RunView
  /** Elapsed frames since the run started. */
  frame: number
  framesPerStep?: number
  showGradients?: boolean
  showProbes?: boolean
  showTrail?: boolean
  /** Trail stroke width in screen pixels. */
  trailWidth?: number
  terrainResolution?: number
  /** Contour lines across the altitude range. 0 turns them off. */
  contours?: number
  wireframe?: boolean
  orbit?: boolean
}

/**
 * The whole search view: terrain, kangaroo or crowd, trails, arrows.
 *
 * Camera defaults to an orbitable overview rather than following the kangaroo.
 * Following is more cinematic, but the basin has to stay visible — seeing
 * *which* summit got missed is the entire lesson, and a follow-cam hides it.
 */
export function SearchScene({
  surface,
  view,
  frame,
  framesPerStep = 8,
  showGradients = false,
  showProbes = false,
  showTrail = true,
  trailWidth = 3.5,
  terrainResolution = 192,
  contours = 22,
  wireframe = false,
  orbit = true,
}: SearchSceneProps) {
  const { states, transform, path, populationPaths } = view
  const cursor = hopAt(path.length, frame, framesPerStep)

  const from = path[cursor.index] ?? { x: 0, y: 0, z: 0 }
  const to = path[cursor.index + 1] ?? from
  const reveal = path.length < 2 ? 1 : (cursor.index + cursor.t) / (path.length - 1)

  const crowdHops = useMemo(() => {
    if (!populationPaths) return null
    return populationPaths.map((p) => ({
      from: p[Math.min(cursor.index, p.length - 1)] ?? { x: 0, y: 0, z: 0 },
      to: p[Math.min(cursor.index + 1, p.length - 1)] ?? { x: 0, y: 0, z: 0 },
    }))
  }, [populationPaths, cursor.index])

  const crowdColors = useMemo(
    () => populationPaths?.map((_, i) => dataSeries(i)) ?? undefined,
    [populationPaths],
  )

  const probes = useMemo(() => {
    if (!showProbes) return []
    const proposals = states[cursor.index + 1]?.proposals ?? []
    return proposals
      .filter((p) => !p.accepted)
      .map((p) => transform.toWorld(p.position.x, p.position.y, p.value))
  }, [showProbes, states, cursor.index, transform])

  return (
    <>
      <color attach="background" args={[hexToInt(CKColor.void)]} />
      <fog attach="fog" args={[hexToInt(CKColor.void), 3.2, 7]} />
      <SceneLighting />

      <Terrain
        surface={surface}
        transform={transform}
        resolution={terrainResolution}
        wireframe={wireframe}
        contours={contours}
      />

      {showGradients && <GradientField surface={surface} transform={transform} />}

      {showTrail && !populationPaths && (
        <HopTrail points={path} reveal={reveal} width={trailWidth} />
      )}
      {showTrail &&
        populationPaths?.map((p, i) => (
          <HopTrail
            key={i}
            points={p}
            reveal={reveal}
            color={dataSeries(i)}
            samplesPerHop={8}
            width={trailWidth * 0.55}
            opacity={0.5}
          />
        ))}

      {probes.length > 0 && <RejectedProbes from={from} probes={probes} t={cursor.t} />}

      {crowdHops ? (
        <KangarooCrowd hops={crowdHops} t={cursor.t} colors={crowdColors} />
      ) : (
        <Kangaroo from={from} to={to} t={cursor.t} />
      )}

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
