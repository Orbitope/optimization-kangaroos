import { CKColor, hexToInt } from '@contentkit/tokens'
import { coverageToBytes, type Coverage, type SceneTransform, type Surface } from '@kangaroos/core'
import { useEffect, useMemo, useRef } from 'react'
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
  /**
   * Fog of war: what the searcher has actually sensed.
   *
   * The 3D answer to the same question the plan view asks, and it works for the
   * same reason — coverage is computed in the core over domain coordinates, so
   * both renderers are fogging the identical numbers rather than each deciding
   * separately what "seen" means. Here it arrives as a texture and the terrain
   * is darkened toward the void in the fragment shader, which costs one sample
   * per pixel and nothing per frame beyond re-uploading the bytes.
   */
  coverage?: Coverage
  /** How dark unseen ground goes, 0..1. 1 hides it completely. */
  fogStrength?: number
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
  coverage,
  fogStrength = 1,
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
   * Coverage as a single-channel texture.
   *
   * Allocated once per coverage size and rewritten in place, because this
   * changes every hop and reallocating a texture per frame would churn GPU
   * memory for no reason. `NearestFilter` on purpose: the coverage grid is
   * already smooth — the disc is feathered when it is stamped — so bilinear
   * filtering would only blur an edge that is deliberately soft already.
   */
  const fogTexture = useMemo(() => {
    if (!coverage) return null
    const t = new THREE.DataTexture(
      new Uint8Array(coverage.size * coverage.size),
      coverage.size,
      coverage.size,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    )
    t.minFilter = THREE.LinearFilter
    t.magFilter = THREE.LinearFilter
    t.needsUpdate = true
    return t
  }, [coverage?.size])

  useEffect(() => () => fogTexture?.dispose(), [fogTexture])

  // Uploaded every render rather than on a dirty flag: the caller mutates the
  // coverage buffer in place, so there is nothing for React to compare and a
  // memo here would show stale fog.
  if (fogTexture && coverage) {
    coverageToBytes(coverage, fogTexture.image.data as Uint8Array)
    fogTexture.needsUpdate = true
  }

  const uniforms = useRef({
    uContours: { value: contours },
    uContourStrength: { value: contourStrength },
    uFog: { value: null as THREE.DataTexture | null },
    uFogStrength: { value: 0 },
    uVoid: { value: new THREE.Color(CKColor.void) },
    // World half-extents in XZ. Not a constant since the transform started
    // preserving aspect: a whole-Earth region is twice as wide as it is deep,
    // and a hardcoded 1 fogs a stretched copy of the coverage grid.
    uHalf: { value: new THREE.Vector2(1, 1) },
  })
  uniforms.current.uFog.value = fogTexture
  uniforms.current.uFogStrength.value = fogTexture ? fogStrength : 0
  uniforms.current.uHalf.value.set(transform.halfExtentX, transform.halfExtentZ)

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
      Object.assign(shader.uniforms, uniforms.current)

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aHeight01;\nuniform vec2 uHalf;\nvarying float vHeight01;\nvarying vec2 vFogUv;',
        )
        .replace(
          '#include <begin_vertex>',
          // Domain maps to XZ spanning ±uHalf with domain +y at world -z, and
          // the coverage grid's row 0 is the northern edge — so v runs straight
          // from z with no flip. Getting this backwards fogs the wrong half of
          // the map, which looks plausible and is completely wrong.
          '#include <begin_vertex>\nvHeight01 = aHeight01;\nvFogUv = vec2(position.x / uHalf.x, position.z / uHalf.y) * 0.5 + 0.5;',
        )

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uContours;\nuniform float uContourStrength;\nuniform sampler2D uFog;\nuniform float uFogStrength;\nuniform vec3 uVoid;\nvarying float vHeight01;\nvarying vec2 vFogUv;',
        )
        .replace(
          '#include <dithering_fragment>',
          /* glsl */ `
          #include <dithering_fragment>
          float seen = 1.0;
          if (uFogStrength > 0.0) {
            seen = texture2D(uFog, vFogUv).r;
          }
          if (uContours > 0.0) {
            float bands = vHeight01 * uContours;
            float dist = abs(fract(bands) - 0.5);
            // Screen-space width: without fwidth the lines alias into moire
            // wherever the terrain is steep and the bands crowd together.
            float w = fwidth(bands);
            float line = smoothstep(0.0, w * 1.2, 0.5 - dist - w * 0.6);
            // Survey lines stop where the survey does — a crisp isoline across
            // ground she has never walked is the figure asserting something
            // nobody measured.
            gl_FragColor.rgb *= mix(1.0, 1.0 - uContourStrength, line * seen);
          }
          if (uFogStrength > 0.0) {
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uVoid, (1.0 - seen) * uFogStrength);
          }
          `,
        )
    }

    // Changing onBeforeCompile after first use needs a recompile signal.
    m.customProgramCacheKey = () => `contours:${contours}:${contourStrength}:${fogTexture ? 1 : 0}`
    return m
  }, [contours, contourStrength, fogTexture])

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
