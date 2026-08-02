/**
 * Seeded randomness.
 *
 * Every optimizer here takes an explicit `Rng` rather than reaching for
 * `Math.random`. Three things depend on that: a reader can share a permalink to
 * the exact run they are looking at, the video renders identically on every
 * pass, and tests can assert on trajectories instead of on statistics.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
}

/**
 * mulberry32 — small, fast, and good enough for visual work. Not for anything
 * cryptographic.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

/** Hash a string to a seed, so runs can be named rather than numbered. */
export function seedFrom(text: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Uniform in [lo, hi). */
export function uniform(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng.next()
}

/** A random integer in [0, n). */
export function randInt(rng: Rng, n: number): number {
  return Math.floor(rng.next() * n)
}

/**
 * A uniformly distributed direction on the unit circle.
 *
 * The 2019 code returned this as an object and then array-destructured it at
 * the call site, so both components came back undefined.
 */
export function randUnitVector(rng: Rng): { x: number; y: number } {
  const a = rng.next() * Math.PI * 2
  return { x: Math.cos(a), y: Math.sin(a) }
}

/** Standard normal, via Box-Muller. Used for annealing proposals. */
export function randNormal(rng: Rng): number {
  let u = 0
  while (u === 0) u = rng.next()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * rng.next())
}
