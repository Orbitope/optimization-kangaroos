import { dataSeries } from '@contentkit/tokens'
import { createSampledSurface, createSceneTransform, type SceneTransform } from '@kangaroos/core'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

import { buildTerrainGeometry } from './geometry.js'

export interface GhostTerrainProps {
  surface: Parameters<typeof buildTerrainGeometry>[0]
  transform: SceneTransform
  color: string
  resolution?: number
  opacity?: number
  /** Draw as a wire lattice instead of a solid skin. */
  wireframe?: boolean
  /**
   * Additive blending. Off by default.
   *
   * Additive is order-independent and reads nicely for two or three layers,
   * but it saturates: five stacked skins over any bright base come out white,
   * and every hue is lost. Normal blending at low opacity keeps the layers
   * distinguishable, which is the entire point of colouring them separately.
   */
  additive?: boolean
}

/**
 * One landscape drawn as a translucent skin, for stacking against others.
 *
 * Flat-shaded in a single colour rather than using the elevation ramp: the
 * point of a stack is to compare *shapes*, and giving each layer its own
 * height-varying colours makes the overlaps unreadable.
 */
export function GhostTerrain({
  surface,
  transform,
  color,
  resolution = 96,
  opacity = 0.22,
  wireframe = false,
  additive = false,
}: GhostTerrainProps) {
  const geometry = useMemo(() => {
    const built = buildTerrainGeometry(surface, transform, resolution)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(built.positions, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(built.normals, 3))
    g.setIndex(new THREE.BufferAttribute(built.indices, 1))
    g.computeBoundingSphere()
    return g
  }, [surface, transform, resolution])

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        // Depth-write off so the layers show through each other; with it on,
        // the nearest skin would occlude the rest and there would be no stack.
        depthWrite: false,
        side: THREE.DoubleSide,
        wireframe,
      }),
    [color, opacity, wireframe, additive],
  )

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  return <mesh geometry={geometry} material={material} renderOrder={2} />
}

export interface DataShiftStackProps {
  /** How many independent draws to overlay. */
  draws?: number
  /** Examples per draw. */
  count: number
  /** Base seed; draw `i` uses `seed + i`. */
  seed?: number
  /** Shared world transform, so every layer is measured on the same axis. */
  transform: SceneTransform
  resolution?: number
  opacity?: number
  wireframe?: boolean
  additive?: boolean
}

/**
 * Several independent draws of the same size, stacked.
 *
 * The whole overfitting argument in one still frame. Where the truth has a real
 * mountain, every draw builds one in the same place and the layers converge
 * into a tight, bright bundle. Where a hill was an accident of sampling, one
 * lone coloured ghost sits by itself with nothing underneath it.
 *
 * Crucially every layer shares one `SceneTransform`. Letting each draw
 * normalise to its own height range would rescale them independently and the
 * comparison would be meaningless.
 */
export function DataShiftStack({
  draws = 5,
  count,
  seed = 0,
  transform,
  resolution = 96,
  opacity = 0.2,
  wireframe = false,
  additive = false,
}: DataShiftStackProps) {
  const surfaces = useMemo(
    () =>
      Array.from({ length: draws }, (_, i) => createSampledSurface({ count, seed: seed + i * 977 })),
    [draws, count, seed],
  )

  return (
    <>
      {surfaces.map((s, i) => (
        <GhostTerrain
          key={i}
          surface={s}
          transform={transform}
          color={dataSeries(i)}
          resolution={resolution}
          opacity={opacity}
          wireframe={wireframe}
          additive={additive}
        />
      ))}
    </>
  )
}

/**
 * A transform shared across draws, fixed to the underlying truth.
 *
 * Pinning the height range to the truth rather than to any one draw keeps the
 * vertical scale still while the data is reshuffled — otherwise the whole
 * terrain would breathe every time, and the moving bumps would be impossible
 * to pick out from the rescaling.
 */
export function useSharedTransform(
  truth: Parameters<typeof createSceneTransform>[0],
  verticalScale?: number,
): SceneTransform {
  return useMemo(
    () => createSceneTransform(truth, { verticalScale }),
    [truth, verticalScale],
  )
}
