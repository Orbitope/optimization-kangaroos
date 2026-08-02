import { CKColor, CKMarker } from '@contentkit/tokens'
import type { Vec3 } from '@kangaroos/core'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { buildTrailGeometry } from './geometry.js'

export interface HopTrailProps {
  /** One point per state, in world space. */
  points: readonly Vec3[]
  /** How much of the run to show, 0..1. */
  reveal: number
  color?: string
  /** Arc samples per hop. Higher is smoother; 16 is already hard to fault. */
  samplesPerHop?: number
  /** Fraction of the run over which an old segment fades out. 0 disables. */
  fade?: number
  opacity?: number
}

/**
 * The arcs the kangaroo leaves behind.
 *
 * The whole run is uploaded once and revealed by moving a single uniform.
 * Rebuilding or re-slicing the buffer each frame is the obvious alternative and
 * it is what makes long runs stutter — a 64k-point genetic run would churn
 * megabytes per second of garbage for no visual difference.
 */
export function HopTrail({
  points,
  reveal,
  color = CKColor.coralBright,
  samplesPerHop = 16,
  fade = 0,
  opacity = 0.95,
}: HopTrailProps) {
  const geometry = useMemo(() => {
    const built = buildTrailGeometry(points, samplesPerHop)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(built.positions, 3))
    g.setAttribute('aProgress', new THREE.BufferAttribute(built.progress, 1))
    g.computeBoundingSphere()
    return g
  }, [points, samplesPerHop])

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      // Additive, so the trace is always brighter than whatever it crosses.
      // A single-tone line cannot otherwise stay legible over the elevation
      // ramp — the ramp sweeps the whole luminance axis and is guaranteed to
      // match the trail's own brightness somewhere along it.
      blending: THREE.AdditiveBlending,
      uniforms: {
        uReveal: { value: 0 },
        uFade: { value: fade },
        uOpacity: { value: opacity },
        // THREE.Color converts the sRGB hex into the working space for us.
        uColor: { value: new THREE.Color(color) },
      },
      vertexShader: /* glsl */ `
        attribute float aProgress;
        varying float vProgress;
        void main() {
          vProgress = aProgress;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uReveal;
        uniform float uFade;
        uniform float uOpacity;
        uniform vec3 uColor;
        varying float vProgress;

        void main() {
          // Nothing beyond the playhead has happened yet.
          if (vProgress > uReveal) discard;

          float alpha = uOpacity;
          if (uFade > 0.0) {
            float age = uReveal - vProgress;
            alpha *= clamp(1.0 - age / uFade, 0.08, 1.0);
          }
          gl_FragColor = vec4(uColor, alpha);
        }
      `,
    })
  }, [color, fade, opacity])

  // Uniform writes are cheap; this is the only per-frame work the trail does.
  material.uniforms.uReveal!.value = Math.min(1, Math.max(0, reveal))
  material.uniforms.uFade!.value = fade
  material.uniforms.uOpacity!.value = opacity

  // THREE.Line has no unambiguous R3F intrinsic — <line> collides with SVG's
  // in the JSX namespace — so build the object and hand it over directly.
  const line = useMemo(() => {
    const l = new THREE.Line(geometry, material)
    l.frustumCulled = false
    return l
  }, [geometry, material])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  return <primitive object={line} />
}

/**
 * Ghost arcs for proposals the optimizer looked at and turned down.
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
}: {
  from: Vec3
  probes: readonly Vec3[]
  /** Progress through the current step, used to fade the probes back out. */
  t: number
  color?: string
}) {
  const ref = useRef<THREE.LineSegments>(null)

  const geometry = useMemo(() => {
    const positions = new Float32Array(probes.length * 6)
    probes.forEach((p, i) => {
      positions.set([from.x, from.y, from.z, p.x, p.y, p.z], i * 6)
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return g
  }, [from, probes])

  useEffect(() => () => geometry.dispose(), [geometry])

  // Brightest as the step begins, gone by the time the kangaroo lands.
  const alpha = 0.5 * (1 - Math.min(1, Math.max(0, t)))

  return (
    <lineSegments ref={ref} geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial color={color} transparent opacity={alpha} depthWrite={false} />
    </lineSegments>
  )
}
