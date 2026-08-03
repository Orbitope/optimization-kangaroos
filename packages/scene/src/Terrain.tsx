import { CKColor, hexToInt } from '@contentkit/tokens'
import type { SceneTransform, Surface } from '@kangaroos/core'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import { buildTerrainGeometry, elevationLutLinear } from './geometry.js'

export interface TerrainProps {
  surface: Surface
  transform: SceneTransform
  /** Vertices per side. 256 is ~65k verts, which is comfortable. */
  resolution?: number
  /** Draw the triangle edges over the shaded surface. */
  wireframe?: boolean
  /** Contour lines across the altitude range. 0 turns them off. */
  contours?: number
  /** How much a contour darkens the surface, 0..1. */
  contourStrength?: number
  /** Named elevation ramp. Omit for the ContentKit default. */
  ramp?: string
}

/**
 * The landscape.
 *
 * Geometry is memoized on the inputs that actually change its contents. A
 * 256x256 rebuild is tens of milliseconds, so doing it per render would drop
 * frames every time an unrelated slider moves.
 */
export function Terrain({
  surface,
  transform,
  resolution = 192,
  wireframe,
  contours = 22,
  contourStrength = 0.42,
  ramp,
}: TerrainProps) {
  const geometry = useMemo(() => {
    const built = buildTerrainGeometry(surface, transform, resolution, elevationLutLinear(256, ramp))
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(built.positions, 3))
    // Supplied, not computed: these come from the exact analytic gradients, and
    // computeVertexNormals() would replace them with face averages.
    g.setAttribute('normal', new THREE.BufferAttribute(built.normals, 3))
    g.setAttribute('color', new THREE.BufferAttribute(built.colors, 3))
    g.setAttribute('aHeight01', new THREE.BufferAttribute(built.heights01, 1))
    g.setIndex(new THREE.BufferAttribute(built.indices, 1))
    g.computeBoundingSphere()
    return g
  }, [surface, transform, resolution, ramp])

  /**
   * Contours are drawn in the fragment shader rather than extracted as
   * geometry. Marching squares would give real, stylable isolines, but it also
   * means rebuilding a few thousand line segments every time the surface or
   * the height mapping changes. In the shader they cost nothing, sit exactly on
   * the surface with no z-fighting, and `fwidth` keeps them a constant width on
   * screen no matter how close the camera gets.
   */
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.02,
      side: THREE.FrontSide,
    })

    m.onBeforeCompile = (shader) => {
      shader.uniforms.uContours = { value: contours }
      shader.uniforms.uContourStrength = { value: contourStrength }

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aHeight01;\nvarying float vHeight01;',
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeight01 = aHeight01;')

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uContours;\nuniform float uContourStrength;\nvarying float vHeight01;',
        )
        .replace(
          '#include <dithering_fragment>',
          /* glsl */ `
          #include <dithering_fragment>
          if (uContours > 0.0) {
            float bands = vHeight01 * uContours;
            float dist = abs(fract(bands) - 0.5);
            // Screen-space width: without fwidth the lines alias into moire
            // wherever the terrain is steep and the bands crowd together.
            float w = fwidth(bands);
            float line = smoothstep(0.0, w * 1.2, 0.5 - dist - w * 0.6);
            gl_FragColor.rgb *= mix(1.0, 1.0 - uContourStrength, line);
          }
          `,
        )
    }

    // Changing onBeforeCompile after first use needs a recompile signal.
    m.customProgramCacheKey = () => `contours:${contours}:${contourStrength}`
    return m
  }, [contours, contourStrength])

  // Three.js does not free GPU buffers on unmount by itself, and an article
  // that swaps surfaces would leak a 65k-vertex mesh every time.
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  material.wireframe = Boolean(wireframe)

  return <mesh geometry={geometry} material={material} receiveShadow castShadow />
}

/** Warm key light, cool fill — the ContentKit amber/steel pairing in 3D. */
export function SceneLighting() {
  return (
    <>
      <ambientLight intensity={0.62} color={hexToInt(CKColor.steelBright)} />
      <directionalLight
        position={[2.5, 3, 1.5]}
        intensity={2.0}
        color={hexToInt(CKColor.amberBright)}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight
        position={[-2, 1.2, -2]}
        intensity={0.8}
        color={hexToInt(CKColor.steel)}
      />
    </>
  )
}
