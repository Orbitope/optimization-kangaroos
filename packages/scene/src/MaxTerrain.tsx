import { dataSeries } from '@contentkit/tokens'
import { createSampledSurface, type SceneTransform, type Surface } from '@kangaroos/core'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import { buildMaxTerrainGeometry } from './geometry.js'

export interface MaxTerrainProps {
  /** The landscapes to compare. */
  surfaces: readonly Surface[]
  /** One colour per surface, in the same order. */
  colors: readonly string[]
  transform: SceneTransform
  resolution?: number
  /** Contour lines across the altitude range. 0 turns them off. */
  contours?: number
  /** Desaturate where the winner barely won. 0 is plain argmax. */
  marginFade?: number
}

/**
 * Several landscapes shown as one surface: whichever is tallest at each point,
 * painted in that landscape's own colour.
 *
 * This replaces an earlier attempt that stacked the landscapes as translucent
 * skins. That version was unusable, and not for want of tuning — transparency
 * has to solve an ordering problem with no good answer when five surfaces
 * overlap. Additive blending saturates to white, alpha blending depends on draw
 * order, and either way the middle of the frame, where most of the terrain is,
 * turns to mud.
 *
 * A maximum surface is opaque. It sorts correctly for nothing, needs no
 * blending, and asks a sharper question: at this spot, whose hill is on top?
 * A broad patch of one colour is ground a single draw invented that no other
 * draw supports. Fine speckle means the draws are within a hair of each other,
 * which is what agreement looks like.
 */
export function MaxTerrain({
  surfaces,
  colors,
  transform,
  resolution = 160,
  contours = 18,
  marginFade = 0,
}: MaxTerrainProps) {
  const geometry = useMemo(() => {
    const built = buildMaxTerrainGeometry(surfaces, colors, transform, resolution, marginFade)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(built.positions, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(built.normals, 3))
    g.setAttribute('color', new THREE.BufferAttribute(built.colors, 3))
    g.setAttribute('aHeight01', new THREE.BufferAttribute(built.heights01, 1))
    g.setIndex(new THREE.BufferAttribute(built.indices, 1))
    g.computeBoundingSphere()
    return g
  }, [surfaces, colors, transform, resolution, marginFade])

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.02,
      side: THREE.FrontSide,
    })

    m.onBeforeCompile = (shader) => {
      shader.uniforms.uContours = { value: contours }
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aHeight01;\nvarying float vHeight01;',
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeight01 = aHeight01;')
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uContours;\nvarying float vHeight01;',
        )
        .replace(
          '#include <dithering_fragment>',
          /* glsl */ `
          #include <dithering_fragment>
          if (uContours > 0.0) {
            float bands = vHeight01 * uContours;
            float w = fwidth(bands);
            float line = smoothstep(0.0, w * 1.2, 0.5 - abs(fract(bands) - 0.5) - w * 0.6);
            gl_FragColor.rgb *= mix(1.0, 0.6, line);
          }
          `,
        )
    }
    m.customProgramCacheKey = () => `maxcontours:${contours}`
    return m
  }, [contours])

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  return <mesh geometry={geometry} material={material} receiveShadow castShadow />
}

export interface DataShiftMaxProps {
  /** How many independent draws to compare. */
  draws?: number
  /** Examples per draw. */
  count: number
  /** Base seed; each draw offsets from it. */
  seed?: number
  /**
   * Shared world transform. Every draw must be measured on the same vertical
   * axis, or "whose hill is tallest" is a comparison between different rulers.
   */
  transform: SceneTransform
  resolution?: number
  contours?: number
  marginFade?: number
}

/**
 * Independent draws of the same sample size, compared as one max surface.
 *
 * The overfitting argument in a single still. Reshuffling the data is the
 * animated version of the same fact; this is what it looks like held still.
 */
export function DataShiftMax({
  draws = 5,
  count,
  seed = 0,
  transform,
  resolution = 160,
  contours = 18,
  marginFade = 0,
}: DataShiftMaxProps) {
  const surfaces = useMemo(
    () =>
      Array.from({ length: draws }, (_, i) => createSampledSurface({ count, seed: seed + i * 977 })),
    [draws, count, seed],
  )
  const colors = useMemo(
    () => Array.from({ length: draws }, (_, i) => dataSeries(i)),
    [draws],
  )

  return (
    <MaxTerrain
      surfaces={surfaces}
      colors={colors}
      transform={transform}
      resolution={resolution}
      contours={contours}
      marginFade={marginFade}
    />
  )
}
