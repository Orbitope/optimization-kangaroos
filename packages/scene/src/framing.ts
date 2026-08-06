import * as THREE from 'three'

export interface FramingRequest {
  /** Half-extents of the world box to frame. */
  readonly halfExtents: readonly [number, number, number]
  readonly centre: readonly [number, number, number]
  /** Compass direction to view from, degrees clockwise from +Z. */
  readonly azimuth: number
  /** Angle above the horizon, degrees. 90 is straight down. */
  readonly elevation: number
  /** Fraction of the frame the box's projection should fill. */
  readonly fill: number
  /** Vertical field of view, degrees. */
  readonly fov: number
  readonly aspect: number
}

export interface Framing {
  readonly position: THREE.Vector3
  /** Where the camera looks, and what an orbit should pivot about. */
  readonly target: THREE.Vector3
  readonly distance: number
}

/**
 * Solve for a camera that centres and fills a box on screen.
 *
 * Separated from the React component so it can be tested, which matters more
 * than usual here: the failure mode of a bad camera is a figure that looks
 * merely unremarkable rather than broken, and nobody notices for weeks.
 *
 * Iterative, and it has to be. The obvious closed form — require every corner
 * to fall inside the frustum planes — fits the box but frames it badly,
 * because the corners sit at different depths and perspective shrinks the far
 * ones. On the article's own 2:0.35:2 world box at 45°/28° it puts the near
 * corner 92% of the way to the bottom of the frame and the far one only 32% of
 * the way to the top: tight against the frustum, 62% of the frame used, and
 * visibly sagging. What wants centring and filling is the box's *projection*,
 * and that is not linear in the distance.
 *
 * So it iterates: pan until the projection is centred, then take the closest
 * distance that still contains the box, and repeat.
 *
 * Both halves have to be solved *exactly* or the loop oscillates instead of
 * converging. Panning by the measured NDC offset scaled at the target's depth
 * — the obvious move — overshoots by around 2× here, because the corner that
 * defines the bottom of the frame sits a third of the way nearer than the
 * target and therefore slides more than twice as far as that estimate. Fitting
 * the two extreme corners simultaneously, each at its own depth, removes the
 * overshoot; the residual is only the parallax of whichever corners take over
 * as extremes, which is what the iteration is for. Error falls by half a
 * decimal place per pass and ten passes land within 0.0002 of both targets —
 * a fifth of a pixel on a 960px plate. The loop runs once per resize.
 */
export function solveFraming(req: FramingRequest): Framing {
  const { halfExtents, centre, azimuth, elevation, fill, fov, aspect } = req
  const [hx, hy, hz] = halfExtents
  const [cx, cy, cz] = centre

  const vTan = Math.tan((fov * Math.PI) / 360)
  const hTan = vTan * aspect

  const az = (azimuth * Math.PI) / 180
  const el = (elevation * Math.PI) / 180

  // Unit vector from the target towards the camera.
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  ).normalize()

  // The camera's own basis. `up` is derived rather than assumed to be +Y, so a
  // near-overhead elevation still solves correctly.
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir)
  // Degenerate looking straight down; any horizontal axis will do.
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0)
  right.normalize()
  const up = new THREE.Vector3().crossVectors(dir, right).normalize()

  const corners: THREE.Vector3[] = []
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        corners.push(new THREE.Vector3(cx + sx * hx, cy + sy * hy, cz + sz * hz))
      }
    }
  }

  const target = new THREE.Vector3(cx, cy, cz)
  let distance = Math.max(Math.hypot(hx, hy, hz) * 2, 1e-3)

  const eye = new THREE.Vector3()
  const v = new THREE.Vector3()

  for (let pass = 0; pass < 10; pass++) {
    eye.copy(dir).multiplyScalar(distance).add(target)

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    // Depth of whichever corner currently defines each edge of the frame.
    let depthMinX = 1
    let depthMaxX = 1
    let depthMinY = 1
    let depthMaxY = 1

    for (const c of corners) {
      v.copy(c).sub(eye)
      // Depth along the view axis. Clamped rather than skipped: a corner
      // behind the eye means the guess was far too close, and a tiny depth
      // pushes the next distance out hard, which is the right response.
      const depth = Math.max(-v.dot(dir), 1e-4)
      const nx = v.dot(right) / (depth * hTan)
      const ny = v.dot(up) / (depth * vTan)
      if (nx < minX) {
        minX = nx
        depthMinX = depth
      }
      if (nx > maxX) {
        maxX = nx
        depthMaxX = depth
      }
      if (ny < minY) {
        minY = ny
        depthMinY = depth
      }
      if (ny > maxY) {
        maxY = ny
        depthMaxY = depth
      }
    }

    // Pan so the two extreme corners end up equidistant from the centre.
    // Sliding the camera by Δ along `up` moves a corner at depth d by
    // Δ/(d·vTan) in NDC, so the Δ that makes minY and maxY symmetric is their
    // sum divided by the sum of those two rates. Using the target's own depth
    // for both — the obvious shortcut — assumes a flat box and overshoots by
    // about 2× on this one.
    target.addScaledVector(right, (minX + maxX) / (1 / (depthMinX * hTan) + 1 / (depthMaxX * hTan)))
    target.addScaledVector(up, (minY + maxY) / (1 / (depthMinY * vTan) + 1 / (depthMaxY * vTan)))

    // Given that target, the closest distance that still contains every
    // corner. Exact: a corner `p` measured from the target is inside when
    // `distance ≥ p·dir + |p·right| / (hTan·fill)`, and likewise vertically.
    let fitted = 0
    for (const c of corners) {
      v.copy(c).sub(target)
      const depth = v.dot(dir)
      fitted = Math.max(
        fitted,
        depth + Math.abs(v.dot(right)) / (hTan * fill),
        depth + Math.abs(v.dot(up)) / (vTan * fill),
      )
    }
    distance = fitted
  }

  return {
    position: dir.clone().multiplyScalar(distance).add(target),
    target: target.clone(),
    distance,
  }
}

/**
 * Where a world point lands in normalised device coordinates, for a framing.
 *
 * Only used by the tests — but it is the same projection the solver runs
 * internally, so having one copy of it means a test cannot pass by reproducing
 * the solver's own mistake in the assertion.
 */
export function projectToNdc(
  point: readonly [number, number, number],
  framing: Framing,
  fov: number,
  aspect: number,
): { x: number; y: number } {
  const vTan = Math.tan((fov * Math.PI) / 360)
  const hTan = vTan * aspect

  const dir = framing.position.clone().sub(framing.target).normalize()
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir)
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0)
  right.normalize()
  const up = new THREE.Vector3().crossVectors(dir, right).normalize()

  const v = new THREE.Vector3(point[0], point[1], point[2]).sub(framing.position)
  const depth = Math.max(-v.dot(dir), 1e-6)
  return { x: v.dot(right) / (depth * hTan), y: v.dot(up) / (depth * vTan) }
}
