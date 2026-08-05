import { CKColor, hexToInt } from '@contentkit/tokens'
import type { PosteriorGrid, SceneTransform, Surface, Vec2 } from '@kangaroos/core'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import { buildBeliefGeometry, elevationLutLinear } from './geometry.js'

export interface BeliefTerrainProps {
  grid: PosteriorGrid
  surface: Surface
  transform: SceneTransform
  /** How completely doubt drains the colour, 0..1. */
  fogStrength?: number
  contours?: number
  contourStrength?: number
  ramp?: string
}

/**
 * The landscape as she believes it to be.
 *
 * Contours fade out with uncertainty as well as being drawn from height. That
 * is not decoration: a contour line is a claim about where a specific altitude
 * runs, and drawing crisp isolines across ground she has never visited would
 * be the figure asserting something the model does not support. Where she is
 * ignorant the lines dissolve, which is what an unsurveyed region looks like on
 * a real map.
 */
export function BeliefTerrain({
  grid,
  surface,
  transform,
  fogStrength = 0.85,
  contours = 16,
  contourStrength = 0.42,
  ramp,
}: BeliefTerrainProps) {
  const geometry = useMemo(() => {
    const built = buildBeliefGeometry(grid, surface, transform, elevationLutLinear(256, ramp), {
      fogStrength,
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(built.positions, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(built.normals, 3))
    g.setAttribute('color', new THREE.BufferAttribute(built.colors, 3))
    g.setAttribute('aHeight01', new THREE.BufferAttribute(built.heights01, 1))
    g.setAttribute('aDoubt', new THREE.BufferAttribute(built.uncertainty, 1))
    g.setIndex(new THREE.BufferAttribute(built.indices, 1))
    g.computeBoundingSphere()
    return g
  }, [grid, surface, transform, ramp, fogStrength])

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.02,
      side: THREE.FrontSide,
    })

    m.onBeforeCompile = (shader) => {
      shader.uniforms.uContours = { value: contours }
      shader.uniforms.uContourStrength = { value: contourStrength }

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aHeight01;\nattribute float aDoubt;\nvarying float vHeight01;\nvarying float vDoubt;',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvHeight01 = aHeight01;\nvDoubt = aDoubt;',
        )

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uContours;\nuniform float uContourStrength;\nvarying float vHeight01;\nvarying float vDoubt;',
        )
        .replace(
          '#include <dithering_fragment>',
          /* glsl */ `
          #include <dithering_fragment>
          if (uContours > 0.0) {
            float bands = vHeight01 * uContours;
            float dist = abs(fract(bands) - 0.5);
            float w = fwidth(bands);
            float line = smoothstep(0.0, w * 1.2, 0.5 - dist - w * 0.6);
            // Survey lines stop where the survey does.
            float confidence = 1.0 - smoothstep(0.15, 0.75, vDoubt);
            gl_FragColor.rgb *= mix(1.0, 1.0 - uContourStrength, line * confidence);
          }
          `,
        )
    }

    m.customProgramCacheKey = () => `belief:${contours}:${contourStrength}`
    return m
  }, [contours, contourStrength])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  return <mesh geometry={geometry} material={material} receiveShadow castShadow />
}

export interface CairnsProps {
  /** Every place she has actually stood, in domain coordinates. */
  observations: readonly { readonly position: Vec2; readonly value: number }[]
  transform: SceneTransform
  size?: number
  /** How many of the most recent to highlight. */
  color?: string
}

/**
 * A marker at every place she has actually stood.
 *
 * These are the only hard facts in the frame. Everything else — the height of
 * the ground, the colour, the contour lines — is inference, and the cairns are
 * what it is inferred from. Drawn as a bright vertical pin rather than a dome
 * so they stay countable against a surface that is itself full of bumps.
 */
export function Cairns({ observations, transform, size = 0.02, color = CKColor.textBright }: CairnsProps) {
  const mesh = useMemo(() => {
    const g = new THREE.ConeGeometry(0.5, 2.2, 6)
    g.translate(0, 1.1, 0)
    return g
  }, [])

  const scratch = useMemo(() => new THREE.Object3D(), [])
  const ref = useMemo(() => ({ current: null as THREE.InstancedMesh | null }), [])

  const positions = useMemo(
    () => observations.map((o) => transform.toWorld(o.position.x, o.position.y, o.value)),
    [observations, transform],
  )

  useEffect(() => {
    const m = ref.current
    if (!m) return
    positions.forEach((p, i) => {
      scratch.position.set(p.x, p.y, p.z)
      scratch.rotation.set(0, 0, 0)
      scratch.scale.set(size, size, size)
      scratch.updateMatrix()
      m.setMatrixAt(i, scratch.matrix)
    })
    m.count = positions.length
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [positions, size, scratch, ref])

  useEffect(() => () => mesh.dispose(), [mesh])

  return (
    <instancedMesh
      ref={(v) => {
        ref.current = v
      }}
      args={[mesh, undefined, Math.max(1, positions.length)]}
      key={positions.length}
      castShadow
    >
      <meshStandardMaterial
        color={hexToInt(color)}
        emissive={hexToInt(color)}
        emissiveIntensity={0.35}
        roughness={0.4}
      />
    </instancedMesh>
  )
}

export interface NextTargetProps {
  /** Where the acquisition function peaks — where she is going next. */
  target: Vec2
  /** Her belief about the altitude there, so the ring sits on the surface. */
  height: number
  transform: SceneTransform
  color?: string
  /** 0..1 through the current step, for the pulse. */
  t?: number
}

/**
 * A ring on the ground where she has decided to go next.
 *
 * The acquisition function is not drawn as a surface. A translucent heat sheet
 * over terrain is the thing that failed for the training-data act, and it would
 * fail worse here, competing with the fog for the same visual channel. The
 * decision is what the reader needs, and the reason for it is already legible
 * in the two channels the belief surface uses: she goes to high ground, or she
 * goes to grey ground.
 */
export function NextTarget({ target, height, transform, color = '#5FD8F0', t = 0 }: NextTargetProps) {
  const p = transform.toWorld(target.x, target.y, height)
  // Widest at the start of the hop and closing as she arrives, so the ring
  // reads as an intention rather than as a label on where she already is.
  const scale = 0.055 * (1.6 - 0.9 * Math.min(1, Math.max(0, t)))

  return (
    <mesh position={[p.x, p.y + 0.012, p.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[scale * 0.68, scale, 32]} />
      <meshBasicMaterial color={hexToInt(color)} transparent opacity={0.85} side={THREE.DoubleSide} />
    </mesh>
  )
}
