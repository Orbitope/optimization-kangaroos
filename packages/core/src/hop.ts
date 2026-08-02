/**
 * The hop.
 *
 * The kangaroo model is a static mesh with no rig, which is the good case: the
 * whole animation is a matrix transform, so the arc can be derived from the
 * step vector instead of approximated by a canned cycle. That matters more than
 * it sounds. A fixed animation clip plays the same hop regardless of how far
 * the optimizer actually moved, which would quietly misrepresent step size —
 * the one quantity this article is about.
 */

export interface Vec3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface HopOptions {
  /**
   * Apex height as a fraction of horizontal distance. Deliberately uncapped:
   * a step twice as long launches twice as high. Clamping would make a wild
   * overshoot look like an ordinary hop, and the email's kangaroo mistakenly
   * jumping to Shanghai is supposed to look absurd.
   */
  readonly apexRatio?: number
  /** Floor on apex height, so a near-zero step still reads as a hop. */
  readonly minApex?: number
  /** Vertical scale at takeoff and landing. Below 1 is a crouch. */
  readonly squashLow?: number
  /** Added to `squashLow` at the apex. */
  readonly squashRange?: number
}

export interface HopPose {
  readonly position: Vec3
  /** Volume-conserving squash and stretch. */
  readonly scale: Vec3
  /** Yaw in radians, facing the direction of travel. */
  readonly heading: number
  /** Progress through this hop, 0..1. */
  readonly t: number
  /** Height above the straight line between endpoints, normalized 0..1. */
  readonly airborne: number
}

const DEFAULTS = {
  apexRatio: 0.3,
  minApex: 0.01,
  squashLow: 0.7,
  squashRange: 0.45,
} as const

/**
 * Pose partway through a single hop.
 *
 * Horizontal motion is linear in `t` and vertical is a parabola — which is not
 * a stylistic choice, it is what a projectile does. Constant horizontal
 * velocity with `4t(1-t)` vertical gives the arc its shape; the term peaks at
 * exactly 1 when `t = 0.5`.
 *
 * `previousHeading` is used when the step has no horizontal extent. A rejected
 * hill-climber proposal leaves the kangaroo where it was, and without this the
 * model would snap to an arbitrary facing.
 */
export function hopPose(
  from: Vec3,
  to: Vec3,
  t: number,
  options: HopOptions = {},
  previousHeading = 0,
): HopPose {
  const { apexRatio, minApex, squashLow, squashRange } = { ...DEFAULTS, ...options }
  const u = clamp01(t)

  const dx = to.x - from.x
  const dz = to.z - from.z
  const distance = Math.hypot(dx, dz)

  const apex = Math.max(minApex, distance * apexRatio)
  const lift = apex * 4 * u * (1 - u)

  // sin(pi*u) is 0 at both ends and 1 at the apex, so the kangaroo lands and
  // takes off crouched and is stretched out mid-flight.
  const vertical = squashLow + squashRange * Math.sin(Math.PI * u)
  const lateral = 1 / Math.sqrt(vertical)

  return {
    position: {
      x: from.x + dx * u,
      y: from.y + (to.y - from.y) * u + lift,
      z: from.z + dz * u,
    },
    scale: { x: lateral, y: vertical, z: lateral },
    heading: distance > 1e-9 ? Math.atan2(dx, dz) : previousHeading,
    t: u,
    airborne: apex === 0 ? 0 : lift / apex,
  }
}

/** Where a frame falls in a sequence of hops. */
export interface HopCursor {
  /** Index of the state being hopped *from*. */
  readonly index: number
  /** Progress into that hop, 0..1. */
  readonly t: number
  /** True once the sequence has played out. */
  readonly finished: boolean
}

/**
 * Map an absolute frame number onto a hop.
 *
 * The shared abstraction between the two consumers: a widget passes elapsed
 * frames from its animation loop, Remotion passes `useCurrentFrame()`. Neither
 * needs to know how the other advances time.
 */
export function hopAt(stateCount: number, frame: number, framesPerStep: number): HopCursor {
  if (!Number.isFinite(framesPerStep) || framesPerStep <= 0) {
    throw new Error(`framesPerStep must be a positive finite number, got ${framesPerStep}`)
  }
  if (stateCount <= 1) return { index: 0, t: 0, finished: true }

  const hops = stateCount - 1
  const position = Math.max(0, frame) / framesPerStep

  if (position >= hops) return { index: hops - 1, t: 1, finished: true }
  const index = Math.floor(position)
  return { index, t: position - index, finished: false }
}

/** Total frames a run occupies at a given pace. */
export function hopDuration(stateCount: number, framesPerStep: number): number {
  return Math.max(0, stateCount - 1) * framesPerStep
}

/**
 * Points along a hop arc, for building trail geometry.
 *
 * Returns `samples + 1` points so consecutive hops share an endpoint exactly
 * and the trail has no visible seam.
 */
export function hopArc(from: Vec3, to: Vec3, samples: number, options: HopOptions = {}): Vec3[] {
  if (!Number.isInteger(samples) || samples < 1) {
    throw new Error(`samples must be an integer >= 1, got ${samples}`)
  }
  return Array.from(
    { length: samples + 1 },
    (_, i) => hopPose(from, to, i / samples, options).position,
  )
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0
}
