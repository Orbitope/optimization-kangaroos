import { CKColor, CKMarker } from '@contentkit/tokens'
import type { Vec3 } from '@kangaroos/core'
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
  width = 3,
  opacity = 0.95,
  halo = true,
}: HopTrailProps) {
  const size = useThree((s) => s.size)

  const { geometry, segments } = useMemo(() => {
    const built = buildTrailGeometry(points, samplesPerHop)
    const g = new LineGeometry()
    // setPositions wants a plain array of xyz triples; a zero-length run would
    // produce a geometry with no instances, which renders as nothing.
    g.setPositions(built.positions.length > 0 ? Array.from(built.positions) : [0, 0, 0, 0, 0, 0])
    return { geometry: g, segments: Math.max(0, built.pointCount - 1) }
  }, [points, samplesPerHop])

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
export function RejectedProbes({
  from,
  probes,
  t,
  color = CKMarker.ringOuter,
  width = 1.5,
}: {
  from: Vec3
  probes: readonly Vec3[]
  /** Progress through the current step, used to fade the probes back out. */
  t: number
  color?: string
  width?: number
}) {
  const size = useThree((s) => s.size)

  const geometry = useMemo(() => {
    const positions: number[] = []
    for (const p of probes) positions.push(from.x, from.y, from.z, p.x, p.y, p.z)
    const g = new LineSegmentsGeometry()
    g.setPositions(positions.length > 0 ? positions : [0, 0, 0, 0, 0, 0])
    return g
  }, [from, probes])

  const material = useMemo(
    () =>
      new LineMaterial({
        color: new THREE.Color(color).getHex(),
        linewidth: width,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [color, width],
  )

  const segments = useMemo(() => {
    const s = new LineSegments2(geometry, material)
    s.frustumCulled = false
    return s
  }, [geometry, material])

  material.resolution.set(size.width, size.height)
  // Brightest as the step begins, gone by the time the kangaroo lands.
  material.opacity = 0.45 * (1 - Math.min(1, Math.max(0, t)))

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  if (probes.length === 0) return null
  return <primitive object={segments} />
}
