import { useThree } from '@react-three/fiber'
import { useLayoutEffect } from 'react'
import type * as THREE from 'three'

import { solveFraming } from './framing.js'

export interface FitCameraProps {
  /**
   * Half-extents of the world box to frame, and its centre.
   *
   * The scene transform puts the domain in x,z ∈ [-1, 1] and the terrain in
   * y ∈ [0, verticalScale], so the defaults frame exactly that.
   */
  halfExtents?: readonly [number, number, number]
  centre?: readonly [number, number, number]
  /** Compass direction to view from, degrees clockwise from +Z. */
  azimuth?: number
  /** Angle above the horizon, degrees. 90 is straight down. */
  elevation?: number
  /** Fraction of the frame the box's projection is allowed to fill. */
  fill?: number
}

/**
 * Place the camera so the world box fills the canvas, whatever shape it is.
 *
 * The figures are 2.3:1 plates showing a square-plan landscape, and one fixed
 * camera position cannot serve that: a distance that frames the terrain
 * vertically leaves half the plate empty on either side, and one that fills it
 * horizontally crops the mountains. The old position was tuned by eye on one
 * figure at one width, and every other figure and every phone inherited it.
 *
 * So the direction is authored and the framing is solved for — see
 * `solveFraming`, which holds the maths and is tested on its own. This is only
 * the wiring: run it on mount and on every resize, and hand the result to both
 * the camera and the orbit controls.
 */
export function FitCamera({
  halfExtents = [1, 0.175, 1],
  centre = [0, 0.175, 0],
  azimuth = 45,
  elevation = 28,
  fill = 0.94,
}: FitCameraProps) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3; update(): void } | null

  const [hx, hy, hz] = halfExtents
  const [cx, cy, cz] = centre

  useLayoutEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    if (!cam.isPerspectiveCamera || size.width === 0 || size.height === 0) return

    const aspect = size.width / size.height
    const framing = solveFraming({
      halfExtents: [hx, hy, hz],
      centre: [cx, cy, cz],
      azimuth,
      elevation,
      fill,
      fov: cam.fov,
      aspect,
    })

    cam.aspect = aspect
    cam.position.copy(framing.position)
    // Generous, because the reader can orbit and dolly away from this framing.
    cam.near = Math.max(0.01, framing.distance * 0.02)
    cam.far = framing.distance * 6
    cam.lookAt(framing.target)
    cam.updateProjectionMatrix()

    // OrbitControls owns the camera once it mounts, so its target has to agree
    // or the first drag snaps the view back to wherever it thought it was.
    // Orbiting then pivots about the framing centre rather than the geometric
    // one, which is what a reader means when they drag: keep what I am looking
    // at where it is, and move around it.
    if (controls?.target) {
      controls.target.copy(framing.target)
      controls.update()
    }
  }, [camera, controls, size.width, size.height, hx, hy, hz, cx, cy, cz, azimuth, elevation, fill])

  return null
}
