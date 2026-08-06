import { CKColor, CKMarker } from '@contentkit/tokens'
import type { HopOptions, Vec3 } from '@kangaroos/core'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'

import { buildTrailGeometry } from './geometry.js'

export interface HopTrailProps {
  /** One point per state, in world space. */
  points: readonly Vec3[]
  /** How much of the run to show, 0..1. */
  reveal: number
  color?: string
  /** Arc samples per hop. Higher is smoother; 16 is already hard to fault. */
  samplesPerHop?: number
  /**
   * Arc shape, forwarded to `hopArc`.
   *
   * Worth overriding wherever hop length stops carrying meaning. The default
   * apex is proportional to distance and uncapped, which is exactly right when
   * the reader is meant to notice that a step was enormous — and wrong for
   * Bayesian optimization, where every hop is a deliberate cross-map jump and
   * the resulting arcs tower over the terrain they are supposed to annotate.
   */
  hop?: HopOptions
  /** Stroke width in screen pixels. */
  width?: number
  opacity?: number
  /** Draw a dark casing behind the stroke so it reads on any terrain. */
  halo?: boolean
}

/**
 * The arcs the kangaroo leaves behind.
 *
 * Fat lines rather than `THREE.Line`, because `linewidth` on a plain line is
 * silently ignored by every ANGLE-backed browser — you always get one pixel,
 * which is too thin to read against terrain.
 *
 * `Line2` builds each segment as an instance, which makes revealing the trail
 * a single integer write: `instanceCount` caps how many segments draw. The
 * whole run uploads once and never changes. Re-slicing the buffer per frame is
 * the obvious alternative and it is what makes long runs stutter.
 */
export function HopTrail({
  points,
  reveal,
  color = CKColor.coral,
  samplesPerHop = 16,
  hop,
  width = 3,
  opacity = 0.95,
  halo = true,
}: HopTrailProps) {
  const size = useThree((s) => s.size)

  const { geometry, segments } = useMemo(() => {
    const built = buildTrailGeometry(points, samplesPerHop, hop)
    const g = new LineGeometry()
    // setPositions wants a plain array of xyz triples; a zero-length run would
    // produce a geometry with no instances, which renders as nothing.
    g.setPositions(built.positions.length > 0 ? Array.from(built.positions) : [0, 0, 0, 0, 0, 0])
    return { geometry: g, segments: Math.max(0, built.pointCount - 1) }
  }, [points, samplesPerHop, hop])

  // Normal blending, not additive. Additive was the first attempt and it does
  // guarantee visibility, but bright coral over amber terrain saturates every
  // channel and the trail comes out white — legible, and the wrong colour.
  //
  // The casing is the same trick the marker ring uses: a wider dark stroke
  // behind a narrower bright one. A single tone cannot stay legible across a
  // full-range elevation ramp, because the ramp sweeps the whole luminance
  // axis and is guaranteed to match the trail's own brightness somewhere.
  const material = useMemo(
    () =>
      new LineMaterial({
        color: new THREE.Color(color).getHex(),
        linewidth: width,
        transparent: true,
        opacity,
        depthWrite: false,
      }),
    [color, width, opacity],
  )

  const haloMaterial = useMemo(
    () =>
      new LineMaterial({
        color: new THREE.Color(CKMarker.ringInner).getHex(),
        linewidth: width + 3,
        transparent: true,
        opacity: Math.min(1, opacity * 0.85),
        depthWrite: false,
      }),
    [width, opacity],
  )

  const line = useMemo(() => {
    const l = new Line2(geometry, material)
    l.frustumCulled = false
    l.renderOrder = 1
    return l
  }, [geometry, material])

  const haloLine = useMemo(() => {
    const l = new Line2(geometry, haloMaterial)
    l.frustumCulled = false
    l.renderOrder = 0
    return l
  }, [geometry, haloMaterial])

  // Screen-space width needs the drawing buffer size, or strokes scale wrongly
  // on resize and on high-DPI displays.
  material.resolution.set(size.width, size.height)
  material.linewidth = width
  material.opacity = opacity
  haloMaterial.resolution.set(size.width, size.height)
  haloMaterial.linewidth = width + 3

  geometry.instanceCount = Math.max(0, Math.round(Math.min(1, Math.max(0, reveal)) * segments))

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => () => haloMaterial.dispose(), [haloMaterial])

  return (
    <>
      {halo && <primitive object={haloLine} />}
      <primitive object={line} />
    </>
  )
}

/**
 * Ghost lines to proposals the optimizer looked at and turned down.
 *
 * The hill climber trying a dozen directions before one sticks is the clearest
 * picture of what "search" actually means, and it is invisible in the accepted
 * trajectory. Requires `recordProposals` on the run.
 */
export interface ProbeSegment {
  readonly from: Vec3
  readonly to: Vec3
}

export interface RejectedProbesProps {
  /** Every rejected proposal of the whole run, in step order. */
  segments: readonly ProbeSegment[]
  /** How many of them to show. Everything before the playhead stays drawn. */
  count: number
  color?: string
  width?: number
  opacity?: number
}

/**
 * Directions she tried and threw away.
 *
 * These used to be built per step and faded to nothing by the time she landed,
 * which made them useless for the thing the prose asks a reader to notice.
 * "Most jumps are wasted, and near the top she spends most of her effort
 * discovering that everything around her is lower" is a claim about
 * *accumulation* — it is only visible if the rejected spokes stay on the map
 * and pile up into a starburst around wherever she got stuck. A flicker that
 * lasts one step shows the opposite: that each attempt is a fleeting thing of
 * no consequence.
 *
 * So the geometry is built once for the entire run and revealed by moving
 * `instanceCount`, the same trick the trail uses. Showing three hundred more
 * spokes costs one integer write rather than a buffer rebuild.
 *
 * Normal blending, not additive. Additive was right when only a handful were
 * ever on screen at once; with the whole run drawn, the overlapping spokes near
 * a summit saturate to white and the densest region — the one carrying the
 * point — turns into a featureless blob.
 *
 * Azure rather than a grey. A neutral at low opacity over the ramp's tan
 * uplands reads as dirt on the lens rather than as a mark, and the first
 * attempt looked exactly like that. Azure is one of the four hues validated to
 * clear delta-E 17 against every stop of the elevation ramp, and it is not the
 * coral the accepted trail wears — so "tried" and "kept" separate by hue
 * instead of by brightness, which is the only channel the terrain has already
 * spent.
 */
export function RejectedProbes({
  segments,
  count,
  color = '#35C4F0',
  width = 1.8,
  opacity = 0.55,
}: RejectedProbesProps) {
  const size = useThree((s) => s.size)

  const geometry = useMemo(() => {
    const positions: number[] = []
    for (const seg of segments) {
      positions.push(seg.from.x, seg.from.y, seg.from.z, seg.to.x, seg.to.y, seg.to.z)
    }
    const g = new LineSegmentsGeometry()
    g.setPositions(positions.length > 0 ? positions : [0, 0, 0, 0, 0, 0])
    return g
  }, [segments])

  const material = useMemo(
    () =>
      new LineMaterial({
        color: new THREE.Color(color).getHex(),
        linewidth: width,
        transparent: true,
        depthWrite: false,
      }),
    [color, width],
  )

  const lines = useMemo(() => {
    const l = new LineSegments2(geometry, material)
    l.frustumCulled = false
    return l
  }, [geometry, material])

  material.resolution.set(size.width, size.height)
  material.opacity = opacity
  // The reveal. LineSegmentsGeometry is instanced, one instance per segment.
  geometry.instanceCount = Math.max(0, Math.min(segments.length, Math.floor(count)))

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  if (segments.length === 0) return null
  return <primitive object={lines} />
}
