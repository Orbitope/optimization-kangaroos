import { agentSeries, CKAgentSeries, CKColor, CKMarker, hexToInt } from '@contentkit/tokens'
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
  /**
   * The lead run, for anything that reads per-step detail — rejected probes,
   * temperature, gradient magnitude. With several runs on screen only one can
   * own the readout, and it is the longest, since that is the one still moving
   * when the others have stopped.
   */
  readonly states: readonly OptimizerState[]
  readonly transform: SceneTransform
  /** The lead run's world path. Its length drives the playhead. */
  readonly path: readonly Vec3[]
  /**
   * One world path per kangaroo on screen, or null for a lone searcher.
   *
   * A genetic algorithm's population and a set of independent runs from
   * different starts are the same rendering problem — N agents hopping at once,
   * N trails — so they share one field. What differs is only how they were
   * produced, which the scene does not need to know.
   */
  readonly agentPaths: readonly Vec3[][] | null
  /**
   * Resting heading per agent, in radians.
   *
   * A run that has finished has `from === to`, and `hopPose` cannot recover a
   * direction from a zero-length step — so without this every kangaroo that
   * arrives snaps round to face north, all at different moments, which reads as
   * a bug. This is the direction of each path's last real move.
   */
  readonly restHeadings: readonly number[] | null
}

function pathsToRestHeadings(paths: readonly Vec3[][]): number[] {
  return paths.map((p) => {
    for (let i = p.length - 1; i > 0; i--) {
      const dx = p[i]!.x - p[i - 1]!.x
      const dz = p[i]!.z - p[i - 1]!.z
      if (Math.hypot(dx, dz) > 1e-9) return Math.atan2(dx, dz)
    }
    return 0
  })
}

/**
 * Precompute everything positional for one or more runs.
 *
 * Doing this once per run rather than per frame is the difference between a
 * scene that holds 60fps and one that recomputes a few thousand coordinate
 * transforms every time the playhead moves.
 *
 * There are three cases and deliberately one hook, because a figure has to
 * choose between them at render time and React will not allow a conditional
 * hook:
 *
 * - **Several runs.** Independent searches from different starts. One shared
 *   transform, which is the point — they are searching the same landscape, so
 *   they must share a vertical scale or their altitudes stop being comparable,
 *   and comparing where they ended up is the entire reason to show more than
 *   one. Runs are different lengths, and that is content rather than a wrinkle
 *   to smooth over: one kangaroo settling at step 40 while another is still
 *   climbing at step 300 is what "this algorithm is unreliable" looks like.
 * - **One run with a population.** A genetic algorithm. Same rendering shape,
 *   different provenance.
 * - **One lone searcher.** `agentPaths` is null and the scene draws a single
 *   kangaroo. A crowd of one would be drawn a shade smaller and in the wrong
 *   colour, which is a silly reason to have a special case, but it is still the
 *   correct output.
 */
export function useMultiRunView(
  surface: Surface,
  runs: readonly (readonly OptimizerState[])[],
  options: { verticalScale?: number } = {},
): RunView {
  const transform = useMemo(
    () => createSceneTransform(surface, { verticalScale: options.verticalScale }),
    [surface, options.verticalScale],
  )

  return useMemo(() => {
    if (runs.length > 1) {
      const agentPaths = runs.map((r) => statesToWorld(r, transform))
      // The lead run is the longest, since that is the one still moving when
      // the others have stopped — it has to own the playhead or the animation
      // ends while somebody is mid-climb.
      let lead = 0
      for (let i = 1; i < agentPaths.length; i++) {
        if (agentPaths[i]!.length > agentPaths[lead]!.length) lead = i
      }
      return {
        states: runs[lead] ?? [],
        transform,
        path: agentPaths[lead] ?? [],
        agentPaths,
        restHeadings: pathsToRestHeadings(agentPaths),
      }
    }

    const states = runs[0] ?? []
    const path = statesToWorld(states, transform)

    const size = states[0]?.population?.length ?? 0
    let agentPaths: Vec3[][] | null = null
    if (size > 0) {
      // Transposed: one path per individual, so a crowd member's hop is a
      // lookup rather than a search through every generation.
      agentPaths = Array.from({ length: size }, () => [] as Vec3[])
      for (const s of states) {
        s.population?.forEach((ind, i) => {
          agentPaths![i]?.push(transform.toWorld(ind.position.x, ind.position.y, ind.value))
        })
      }
    }

    return {
      states,
      transform,
      path,
      agentPaths,
      restHeadings: agentPaths ? pathsToRestHeadings(agentPaths) : null,
    }
  }, [runs, transform])
}

/** The single-run case, for callers that never show more than one kangaroo. */
export function useRunView(
  surface: Surface,
  states: readonly OptimizerState[],
  options: { verticalScale?: number } = {},
): RunView {
  const runs = useMemo(() => [states], [states])
  return useMultiRunView(surface, runs, options)
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
  /** Named elevation ramp. Omit for the ContentKit default. */
  ramp?: string
  /** Draw the terrain surface. Off when ghost layers are the subject. */
  showTerrain?: boolean
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
  ramp,
  showTerrain = true,
}: SearchSceneProps) {
  const { states, transform, path, agentPaths, restHeadings } = view
  const cursor = hopAt(path.length, frame, framesPerStep)

  const from = path[cursor.index] ?? { x: 0, y: 0, z: 0 }
  const to = path[cursor.index + 1] ?? from
  // Progress in steps, not in fraction-of-the-lead-run. Each agent turns this
  // into its own reveal below, so a run that ends at step 40 finishes drawing
  // its trail at step 40 rather than dribbling on until the longest run stops.
  const elapsed = cursor.index + cursor.t
  const reveal = path.length < 2 ? 1 : elapsed / (path.length - 1)

  const crowdHops = useMemo(() => {
    if (!agentPaths) return null
    return agentPaths.map((p, i) => ({
      from: p[Math.min(cursor.index, p.length - 1)] ?? { x: 0, y: 0, z: 0 },
      to: p[Math.min(cursor.index + 1, p.length - 1)] ?? { x: 0, y: 0, z: 0 },
      previousHeading: restHeadings?.[i] ?? 0,
    }))
  }, [agentPaths, restHeadings, cursor.index])

  /**
   * Whether each agent gets its own colour.
   *
   * The threshold is the agent scale's length, and it is a real claim rather
   * than a convenience: nobody tracks twenty-four kangaroos by hue. Past four,
   * individual identity is not information the reader can use, so the crowd is
   * drawn as a crowd — one colour, thinner and dimmer trails — and what reads
   * instead is the shape of the swarm, which is the point of a population
   * method anyway.
   */
  const distinct = agentPaths !== null && agentPaths.length <= CKAgentSeries.length

  const crowdColors = useMemo(
    () => (distinct ? agentPaths!.map((_, i) => agentSeries(i)) : undefined),
    [distinct, agentPaths],
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

      {showTerrain && (
      <Terrain
        surface={surface}
        transform={transform}
        resolution={terrainResolution}
        wireframe={wireframe}
        contours={contours}
        ramp={ramp}
      />
      )}

      {showGradients && <GradientField surface={surface} transform={transform} />}

      {showTrail && !agentPaths && <HopTrail points={path} reveal={reveal} width={trailWidth} />}
      {showTrail &&
        agentPaths?.map((p, i) => (
          <HopTrail
            key={i}
            points={p}
            reveal={p.length < 2 ? 1 : Math.min(1, elapsed / (p.length - 1))}
            color={distinct ? agentSeries(i) : CKMarker.fill}
            samplesPerHop={distinct ? 12 : 8}
            width={trailWidth * (distinct ? 0.8 : 0.55)}
            opacity={distinct ? 0.85 : 0.45}
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
