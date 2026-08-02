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
}

/**
 * The landscape.
 *
 * Geometry is memoized on the inputs that actually change its contents. A
 * 256x256 rebuild is tens of milliseconds, so doing it per render would drop
 * frames every time an unrelated slider moves.
 */
export function Terrain({ surface, transform, resolution = 192, wireframe }: TerrainProps) {
  const geometry = useMemo(() => {
    const built = buildTerrainGeometry(surface, transform, resolution, elevationLutLinear())
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(built.positions, 3))
    // Supplied, not computed: these come from the exact analytic gradients, and
    // computeVertexNormals() would replace them with face averages.
    g.setAttribute('normal', new THREE.BufferAttribute(built.normals, 3))
    g.setAttribute('color', new THREE.BufferAttribute(built.colors, 3))
    g.setIndex(new THREE.BufferAttribute(built.indices, 1))
    g.computeBoundingSphere()
    return g
  }, [surface, transform, resolution])

  // Three.js does not free GPU buffers on unmount by itself, and an article
  // that swaps surfaces would leak a 65k-vertex mesh every time.
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <mesh geometry={geometry} receiveShadow castShadow>
      <meshStandardMaterial
        vertexColors
        roughness={0.92}
        metalness={0.02}
        wireframe={wireframe}
        side={THREE.FrontSide}
      />
    </mesh>
  )
}

/** Warm key light, cool fill — the ContentKit amber/steel pairing in 3D. */
export function SceneLighting() {
  return (
    <>
      <ambientLight intensity={0.35} color={hexToInt(CKColor.steelBright)} />
      <directionalLight
        position={[2.5, 3, 1.5]}
        intensity={2.1}
        color={hexToInt(CKColor.amberBright)}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <directionalLight
        position={[-2, 1.2, -2]}
        intensity={0.7}
        color={hexToInt(CKColor.steel)}
      />
    </>
  )
}
