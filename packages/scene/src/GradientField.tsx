import { CKColor } from '@contentkit/tokens'
import type { SceneTransform, Surface } from '@kangaroos/core'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

import { buildArrowField } from './geometry.js'

/** Shaft plus head, built once, pointing along +Z with its base at the origin. */
function useArrowGeometry(): THREE.BufferGeometry {
  return useMemo(() => {
    const shaft = new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6)
    shaft.rotateX(Math.PI / 2)
    shaft.translate(0, 0, 0.3)

    const head = new THREE.ConeGeometry(0.14, 0.4, 8)
    head.rotateX(Math.PI / 2)
    head.translate(0, 0, 0.8)

    const merged = new THREE.BufferGeometry()
    const parts = [shaft.toNonIndexed(), head.toNonIndexed()]
    const total = parts.reduce((n, g) => n + g.attributes.position!.count, 0)

    const positions = new Float32Array(total * 3)
    const normals = new Float32Array(total * 3)
    let offset = 0
    for (const g of parts) {
      positions.set(g.attributes.position!.array as Float32Array, offset * 3)
      normals.set(g.attributes.normal!.array as Float32Array, offset * 3)
      offset += g.attributes.position!.count
      g.dispose()
    }
    shaft.dispose()
    head.dispose()

    merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
    merged.computeBoundingSphere()
    return merged
  }, [])
}

export interface GradientFieldProps {
  surface: Surface
  transform: SceneTransform
  /** Arrows per side. 24 is dense enough to read as a field, sparse enough to see through. */
  resolution?: number
  /** World length of a full-strength arrow. */
  scale?: number
  /** Lift above the terrain, so arrows don't z-fight with the surface. */
  hover?: number
  /** Overall fade, for bringing the field in and out with the narrative. */
  opacity?: number
}

/**
 * Uphill arrows across the whole surface.
 *
 * Shown during the gradient-ascent section and hidden for the blind searches —
 * which is itself the point. The hill climber genuinely cannot see these, and
 * turning them off is the most direct way to say so.
 */
export function GradientField({
  surface,
  transform,
  resolution = 24,
  scale = 0.075,
  hover = 0.012,
  opacity = 0.85,
}: GradientFieldProps) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const geometry = useArrowGeometry()
  const field = useMemo(
    () => buildArrowField(surface, transform, resolution),
    [surface, transform, resolution],
  )

  const scratch = useMemo(() => new THREE.Object3D(), [])
  // Steel to cyan, not steel to amber. Amber sits ΔE 4 from the terrain's own
  // uplands on the cartographic ramp — a strong arrow drawn in it disappears
  // into the hillside it is describing. Cyan clears ΔE 14 across the ramp and
  // its one weak spot, the snow cap, is where gradients are near zero anyway,
  // so nothing bright is ever drawn there.
  const weak = useMemo(() => new THREE.Color(CKColor.steel), [])
  const strong = useMemo(() => new THREE.Color('#5FD8F0'), [])

  useLayoutEffect(() => {
    const m = mesh.current
    if (!m) return
    const colour = new THREE.Color()

    for (let i = 0; i < field.count; i++) {
      const strength = field.strengths[i]!
      scratch.position.set(
        field.positions[i * 3]!,
        field.positions[i * 3 + 1]! + hover,
        field.positions[i * 3 + 2]!,
      )
      scratch.rotation.set(0, field.headings[i]!, 0)
      // Length tracks steepness; girth barely does, so flat regions still show
      // a visible tick rather than vanishing.
      scratch.scale.set(scale * (0.5 + strength * 0.5), scale, scale * (0.35 + strength * 0.9))
      scratch.updateMatrix()
      m.setMatrixAt(i, scratch.matrix)
      m.setColorAt(i, colour.copy(weak).lerp(strong, strength))
    }

    m.count = field.count
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
    m.computeBoundingSphere()
  }, [field, scale, hover, scratch, weak, strong])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, field.count]} key={field.count}>
      <meshStandardMaterial
        roughness={0.5}
        transparent={opacity < 1}
        opacity={opacity}
        depthWrite={opacity >= 1}
      />
    </instancedMesh>
  )
}

/**
 * The single arrow at the kangaroo's feet.
 *
 * Prechelt's bowling ball made literal: this is the direction the ball rolls
 * out of the teflon ditch, and its length is the step the kangaroo is about to
 * take — not a normalized decoration.
 */
export function LocalGradientArrow({
  position,
  heading,
  length,
  color = CKColor.amberBright,
}: {
  position: { x: number; y: number; z: number }
  heading: number
  length: number
  color?: string
}) {
  const geometry = useArrowGeometry()
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh
      geometry={geometry}
      position={[position.x, position.y + 0.02, position.z]}
      rotation={[0, heading, 0]}
      scale={[length * 0.55, length * 0.55, length]}
    >
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} roughness={0.4} />
    </mesh>
  )
}
