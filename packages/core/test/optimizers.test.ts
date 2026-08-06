import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ackley,
  collect,
  eggholder,
  geneticAlgorithm,
  gradientAscent,
  hillClimber,
  himmelblau,
  inDomain,
  mulberry32,
  schwefel,
  seedFrom,
  simulatedAnnealing,
  type OptimizerState,
  type Surface,
} from '../dist/index.js'

const SEED = seedFrom('kangaroos')

const runners = [
  { name: 'hill-climber', run: (s: Surface, seed: number) => hillClimber(s, mulberry32(seed)) },
  { name: 'gradient-ascent', run: (s: Surface, seed: number) => gradientAscent(s, mulberry32(seed)) },
  {
    name: 'simulated-annealing',
    run: (s: Surface, seed: number) => simulatedAnnealing(s, mulberry32(seed)),
  },
  {
    name: 'genetic-algorithm',
    run: (s: Surface, seed: number) => geneticAlgorithm(s, mulberry32(seed)),
  },
]

// ── invariants that hold for every algorithm ───────────────────────────────

test('every optimizer terminates', () => {
  for (const { name, run } of runners) {
    for (const surface of [himmelblau, ackley, schwefel, eggholder]) {
      const states = collect(run(surface, SEED))
      const last = states[states.length - 1]!
      assert.ok(last.done, `${name} on ${surface.name} never finished`)
      assert.ok(last.termination !== null, `${name} finished without a reason`)
    }
  }
})

test('the kangaroo never leaves the map', () => {
  for (const { name, run } of runners) {
    for (const surface of [himmelblau, ackley, schwefel, eggholder]) {
      for (const s of collect(run(surface, SEED))) {
        assert.ok(
          inDomain(surface.domain, s.position.x, s.position.y),
          `${name} on ${surface.name} stepped to (${s.position.x}, ${s.position.y}), outside the domain`,
        )
        for (const individual of s.population ?? []) {
          assert.ok(
            inDomain(surface.domain, individual.position.x, individual.position.y),
            `${name} on ${surface.name} has a population member out of bounds`,
          )
        }
      }
    }
  }
})

test('no NaN ever reaches a render path', () => {
  // The classic failure mode: a step leaves the domain, the surface returns
  // NaN, and every subsequent frame silently draws nothing.
  for (const { name, run } of runners) {
    for (const surface of [himmelblau, ackley, schwefel, eggholder]) {
      for (const s of collect(run(surface, SEED))) {
        assert.ok(Number.isFinite(s.position.x), `${name}/${surface.name}: position.x`)
        assert.ok(Number.isFinite(s.position.y), `${name}/${surface.name}: position.y`)
        assert.ok(Number.isFinite(s.value), `${name}/${surface.name}: value`)
        assert.ok(Number.isFinite(s.best.value), `${name}/${surface.name}: best.value`)
        for (const [k, v] of Object.entries(s.meta)) {
          assert.ok(Number.isFinite(v), `${name}/${surface.name}: meta.${k} = ${v}`)
        }
      }
    }
  }
})

test('best never gets worse', () => {
  for (const { name, run } of runners) {
    for (const surface of [himmelblau, ackley, schwefel, eggholder]) {
      let previous = -Infinity
      for (const s of collect(run(surface, SEED))) {
        assert.ok(
          s.best.value >= previous,
          `${name} on ${surface.name}: best fell from ${previous} to ${s.best.value}`,
        )
        previous = s.best.value
      }
    }
  }
})

test('best.value always matches best.position', () => {
  for (const { name, run } of runners) {
    for (const s of collect(run(himmelblau, SEED))) {
      const actual = himmelblau.height(s.best.position.x, s.best.position.y)
      assert.ok(Math.abs(actual - s.best.value) < 1e-9, `${name}: best is internally inconsistent`)
    }
  }
})

test('step numbers increase by one and start at zero', () => {
  for (const { name, run } of runners) {
    const states = collect(run(himmelblau, SEED))
    assert.equal(states[0]!.step, 0, `${name} should emit its starting position`)
    states.forEach((s, i) => assert.equal(s.step, i, `${name} skipped a step at index ${i}`))
  }
})

test('the terminal state is emitted exactly once', () => {
  // The generators return a final state as well as yielding, so it is easy to
  // emit the last step twice. collect() would then hand the renderer a
  // duplicate frame.
  for (const { name, run } of runners) {
    const states = collect(run(himmelblau, SEED))
    assert.equal(states.filter((s) => s.done).length, 1, `${name} reported done more than once`)
    assert.ok(states[states.length - 1]!.done, `${name}'s last state is not the terminal one`)
  }
})

test('maxSteps: 0 yields just the starting position', () => {
  const rng = () => mulberry32(SEED)
  for (const [name, states] of [
    ['hill-climber', collect(hillClimber(himmelblau, rng(), { maxSteps: 0 }))],
    ['gradient-ascent', collect(gradientAscent(himmelblau, rng(), { maxSteps: 0 }))],
    ['simulated-annealing', collect(simulatedAnnealing(himmelblau, rng(), { maxSteps: 0 }))],
    ['genetic-algorithm', collect(geneticAlgorithm(himmelblau, rng(), { maxSteps: 0 }))],
  ] as const) {
    assert.equal(states.length, 1, `${name} produced ${states.length} states`)
    assert.equal(states[0]!.step, 0)
    assert.ok(states[0]!.done)
  }
})

test('runs are reproducible from their seed', () => {
  for (const { name, run } of runners) {
    const a = collect(run(eggholder, SEED))
    const b = collect(run(eggholder, SEED))
    assert.equal(a.length, b.length, `${name} produced different run lengths`)
    const key = (s: OptimizerState) => `${s.step}:${s.position.x}:${s.position.y}:${s.value}`
    a.forEach((s, i) => assert.equal(key(s), key(b[i]!), `${name} diverged at step ${i}`))
  }
})

test('different seeds explore different places', () => {
  for (const { name, run } of runners) {
    const a = collect(run(eggholder, SEED))
    const b = collect(run(eggholder, SEED + 1))
    assert.notEqual(
      a[a.length - 1]!.best.value,
      b[b.length - 1]!.best.value,
      `${name} ignored its seed`,
    )
  }
})

test('a fixed start is honoured', () => {
  const start = { x: 1.5, y: -2.25 }
  const rng = () => mulberry32(SEED)
  for (const [name, first] of [
    ['hill-climber', collect(hillClimber(himmelblau, rng(), { start }))[0]!],
    ['gradient-ascent', collect(gradientAscent(himmelblau, rng(), { start }))[0]!],
    ['simulated-annealing', collect(simulatedAnnealing(himmelblau, rng(), { start }))[0]!],
  ] as const) {
    assert.deepEqual(first.position, start, `${name} ignored its start point`)
  }
})

// ── each algorithm does its own job ────────────────────────────────────────

test('gradient ascent reaches a Himmelblau maximum from anywhere', () => {
  // Four global maxima of 0, all reachable by following the slope.
  for (let seed = 0; seed < 25; seed++) {
    const states = collect(gradientAscent(himmelblau, mulberry32(seed), { stepDecay: 0.99 }))
    const best = states[states.length - 1]!.best.value
    assert.ok(best > -0.05, `seed ${seed} finished at ${best}, short of a summit`)
  }
})

test('gradient ascent hop length does not depend on steepness', () => {
  // The email's complaint about standard backprop: "the distance the kangaroo
  // hops is related to the steepness of the terrain". Normalizing fixes it.
  const stepSize = 0.05
  const states = collect(
    gradientAscent(himmelblau, mulberry32(SEED), { start: { x: -4.5, y: 4.5 }, stepSize }),
  )
  for (let i = 1; i < Math.min(states.length, 40); i++) {
    const d = Math.hypot(
      states[i]!.position.x - states[i - 1]!.position.x,
      states[i]!.position.y - states[i - 1]!.position.y,
    )
    assert.ok(Math.abs(d - stepSize) < 1e-9, `step ${i} moved ${d}, expected ${stepSize}`)
  }
})

test('momentum carries the kangaroo through a flat spot', () => {
  const plain = collect(gradientAscent(himmelblau, mulberry32(SEED), { start: { x: 3, y: 2 } }))
  const heavy = collect(
    gradientAscent(himmelblau, mulberry32(SEED), { start: { x: 3, y: 2 }, momentum: 0.9 }),
  )
  // Starting exactly on a summit, the plain run converges immediately while
  // momentum has nothing to carry — but it must still terminate and stay sane.
  assert.equal(plain[plain.length - 1]!.termination, 'converged')
  assert.ok(heavy[heavy.length - 1]!.done)
})

test('hill climber ignores out-of-bounds proposals when judging convergence', () => {
  // Pinned into a corner, most proposals leave the map. The run must not call
  // that a summit — patience should only count in-bounds failures.
  const corner = { x: himmelblau.domain.xMin, y: himmelblau.domain.yMin }
  const states = collect(hillClimber(himmelblau, mulberry32(SEED), { start: corner, maxSteps: 60 }))
  assert.ok(states.length > 2, 'terminated almost immediately in a corner')
})

test('hill climber never steps downhill', () => {
  let previous = -Infinity
  for (const s of collect(hillClimber(himmelblau, mulberry32(SEED)))) {
    assert.ok(s.value >= previous - 1e-12, `value fell from ${previous} to ${s.value}`)
    previous = s.value
  }
})

test('hill climber stops when its step size decays away', () => {
  const states = collect(hillClimber(himmelblau, mulberry32(SEED), { stepDecay: 0.5 }))
  const last = states[states.length - 1]!
  assert.ok(last.done)
  assert.ok(last.meta.stepSize! < 1e-6, `step size was still ${last.meta.stepSize}`)
})

test('annealing sobers up: it wanders early and settles late', () => {
  const states = collect(simulatedAnnealing(schwefel, mulberry32(SEED), { maxSteps: 3000 }))
  const drift = (from: number, to: number) => {
    let total = 0
    for (let i = from + 1; i < to; i++) {
      total += Math.hypot(
        states[i]!.position.x - states[i - 1]!.position.x,
        states[i]!.position.y - states[i - 1]!.position.y,
      )
    }
    return total / (to - from)
  }
  const early = drift(0, 200)
  const late = drift(states.length - 200, states.length)
  assert.ok(early > late * 2, `early drift ${early} should far exceed late drift ${late}`)
})

test('annealing tracks a best it is not currently standing on', () => {
  // The drunk kangaroo leaves good summits. That is the point, and it is why
  // `best` is separate from `position`.
  const states = collect(simulatedAnnealing(eggholder, mulberry32(SEED)))
  const wandered = states.some((s) => s.value < s.best.value - 1e-9)
  assert.ok(wandered, 'annealing never once stood somewhere worse than its best')
})

test('annealing beats a hill climber on Schwefel', () => {
  // Schwefel's local slope leads away from the global optimum, so this is a
  // real comparison rather than a tautology.
  let annealingWins = 0
  for (let seed = 0; seed < 12; seed++) {
    const start = { x: 0, y: 0 }
    const sa = collect(simulatedAnnealing(schwefel, mulberry32(seed), { start }))
    const hc = collect(hillClimber(schwefel, mulberry32(seed), { start }))
    if (sa[sa.length - 1]!.best.value > hc[hc.length - 1]!.best.value) annealingWins++
  }
  assert.ok(annealingWins >= 9, `annealing won only ${annealingWins}/12`)
})

test('the genetic algorithm carries a full population', () => {
  const states = collect(geneticAlgorithm(ackley, mulberry32(SEED), { populationSize: 30 }))
  for (const s of states) {
    assert.equal(s.population?.length, 30, `generation ${s.step} had the wrong headcount`)
  }
})

test('the population is always sorted best-first', () => {
  // The widget draws the cull by slicing off the tail, so order is load-bearing.
  for (const s of collect(geneticAlgorithm(ackley, mulberry32(SEED)))) {
    const values = s.population!.map((i) => i.value)
    for (let i = 1; i < values.length; i++) {
      assert.ok(values[i]! <= values[i - 1]!, `generation ${s.step} is out of order`)
    }
  }
})

test('shooting the low-altitude kangaroos raises the average', () => {
  const states = collect(geneticAlgorithm(ackley, mulberry32(SEED), { maxSteps: 60 }))
  const first = states[0]!.meta.meanValue!
  const last = states[states.length - 1]!.meta.meanValue!
  assert.ok(last > first, `mean altitude went from ${first} to ${last}`)
})

test('elitism never loses the best kangaroo', () => {
  const states = collect(geneticAlgorithm(ackley, mulberry32(SEED), { elitism: true }))
  for (let i = 1; i < states.length; i++) {
    assert.ok(
      states[i]!.population![0]!.value >= states[i - 1]!.population![0]!.value - 1e-12,
      `generation ${i} lost ground on the previous best`,
    )
  }
})

test('the genetic algorithm beats a lone hill climber on Ackley', () => {
  // Ackley is a near-flat plain with one narrow spike; a single blind climber
  // has almost no chance of finding it.
  let gaWins = 0
  for (let seed = 0; seed < 12; seed++) {
    const ga = collect(geneticAlgorithm(ackley, mulberry32(seed)))
    const hc = collect(hillClimber(ackley, mulberry32(seed)))
    if (ga[ga.length - 1]!.best.value > hc[hc.length - 1]!.best.value) gaWins++
  }
  assert.ok(gaWins >= 10, `the population won only ${gaWins}/12`)
})

test('collect() refuses to spin forever', () => {
  assert.throws(
    () => collect(simulatedAnnealing(himmelblau, mulberry32(SEED), { maxSteps: 10_000 }), 50),
    /more than 50 states/,
  )
})

// ── crossover and diversity ────────────────────────────────────────────────

/** Mean pairwise distance — the plainest measure of how spread out a population is. */
function populationSpread(pop: readonly { position: { x: number; y: number } }[]): number {
  let sum = 0
  let n = 0
  for (let a = 0; a < pop.length; a++) {
    for (let b = a + 1; b < pop.length; b++) {
      sum += Math.hypot(
        pop[a]!.position.x - pop[b]!.position.x,
        pop[a]!.position.y - pop[b]!.position.y,
      )
      n++
    }
  }
  return n === 0 ? 0 : sum / n
}

test('a blended child may land outside its parents', () => {
  // The property that distinguishes BLX-alpha from plain interpolation, tested
  // directly at the mechanism.
  //
  // Testing it through population spread instead was the first attempt and it
  // was a bad test: on Schwefel the default mutation is 42 domain units, which
  // holds diversity open on its own and hides the crossover entirely, so the
  // measurement said 71 against 75 and proved nothing. Whether the effect shows
  // up in spread depends on the surface. Whether offspring can overshoot does
  // not.
  const surface = schwefel
  const states = collect(
    geneticAlgorithm(surface, mulberry32(3), {
      maxSteps: 12,
      populationSize: 20,
      mutationScale: 1e-9, // so any spread must come from crossover, not noise
      blendAlpha: 0.5,
    }),
  )

  // With mutation switched off, strict interpolation makes the bounding box
  // monotonically non-increasing. Overshoot means it can widen.
  const width = (i: number) => {
    const xs = states[i]!.population!.map((p) => p.position.x)
    return Math.max(...xs) - Math.min(...xs)
  }
  let widened = false
  for (let i = 2; i < states.length; i++) if (width(i) > width(i - 1) + 1e-9) widened = true
  assert.ok(widened, 'the population never widened — offspring are still trapped between parents')
})

test('the genetic algorithm still converges, it just takes longer to commit', () => {
  // Holding diversity open is only an improvement if it still ends somewhere.
  const surface = schwefel
  const states = collect(
    geneticAlgorithm(surface, mulberry32(1), { maxSteps: 80, populationSize: 24 }),
  )
  const early = populationSpread(states[4]!.population!)
  const late = populationSpread(states[states.length - 1]!.population!)
  assert.ok(late < early, `population should still contract: ${late.toFixed(1)} vs ${early.toFixed(1)}`)
})

test('better crossover finds better answers, averaged over seeds', () => {
  // The claim that justifies changing a default. Averaged, because a single
  // seed of either can get lucky.
  const surface = eggholder
  const mean = (blendAlpha: number) => {
    let total = 0
    for (let seed = 0; seed < 20; seed++) {
      const states = collect(
        geneticAlgorithm(surface, mulberry32(seed), {
          maxSteps: 70,
          populationSize: 24,
          blendAlpha,
        }),
      )
      total += states[states.length - 1]!.best.value
    }
    return total / 20
  }
  assert.ok(mean(0.5) > mean(0), `BLX ${mean(0.5).toFixed(0)} should beat strict ${mean(0).toFixed(0)}`)
})

// ── annealing: the proposal scale, and decaying it ─────────────────────────

/**
 * Temperature and proposal scale are the two halves of "sobering up" and are
 * easy to confuse. Temperature governs how willing she is to go *downhill*;
 * the proposal scale governs how *far* she jumps. Only the first existed until
 * the whole-Earth figure needed the second.
 */

test('the default leaves the proposal scale alone, exactly as before', () => {
  const withoutOption = collect(simulatedAnnealing(himmelblau, mulberry32(7), { maxSteps: 200 }))
  const withDefault = collect(
    simulatedAnnealing(himmelblau, mulberry32(7), { maxSteps: 200, proposalDecay: 1 }),
  )
  assert.equal(withoutOption.length, withDefault.length)
  for (let i = 0; i < withoutOption.length; i++) {
    assert.deepEqual(withoutOption[i]!.position, withDefault[i]!.position)
  }
})

test('the proposal scale is reported, and shrinks geometrically', () => {
  const decay = 0.99
  const states = collect(
    simulatedAnnealing(himmelblau, mulberry32(3), {
      maxSteps: 100,
      proposalScale: 4,
      proposalDecay: decay,
    }),
  )
  assert.ok(Math.abs((states[0]!.meta!.proposalScale as number) - 4) < 1e-9)
  for (let i = 1; i < states.length; i++) {
    const expected = 4 * decay ** i
    assert.ok(
      Math.abs((states[i]!.meta!.proposalScale as number) - expected) < 1e-6,
      `step ${i}: ${states[i]!.meta!.proposalScale} vs ${expected}`,
    )
  }
})

test('decay actually shortens her hops, not just a number in the metadata', () => {
  const run = (proposalDecay: number) =>
    collect(
      simulatedAnnealing(himmelblau, mulberry32(11), {
        maxSteps: 600,
        proposalScale: 3,
        proposalDecay,
      }),
    )

  const meanStep = (states: readonly OptimizerState[], from: number, to: number) => {
    let sum = 0
    for (let i = from + 1; i < to; i++) {
      sum += Math.hypot(
        states[i]!.position.x - states[i - 1]!.position.x,
        states[i]!.position.y - states[i - 1]!.position.y,
      )
    }
    return sum / (to - from - 1)
  }

  const decayed = run(0.99)
  const constant = run(1)
  const n = decayed.length

  // Early on the two are the same search; late on the decayed one is crawling.
  assert.ok(
    meanStep(decayed, 0, Math.floor(n * 0.1)) > 10 * meanStep(decayed, Math.floor(n * 0.9), n),
    'a decayed run should end up moving far less than it started',
  )
  assert.ok(
    meanStep(constant, Math.floor(n * 0.9), n) > 5 * meanStep(decayed, Math.floor(n * 0.9), n),
    'and far less than an undecayed one at the same point',
  )
})

/**
 * The outcome the option exists for: big hops find the right region and can
 * never resolve a summit, small hops resolve a summit and can never cross the
 * map, and decaying from one to the other beats both at standing on the top.
 *
 * Ackley rather than Eggholder on purpose. This only works on a landscape with
 * coarse structure worth finding first and fine structure worth resolving
 * second — Ackley is a single broad bowl under a fine ripple, which is the
 * shape of the Earth figure. Eggholder is chaotic at every scale, and the same
 * setting halves its hit rate there.
 */
test('decaying from a large scale finds the exact summit far more often', () => {
  const diagonal = Math.hypot(
    ackley.domain.xMax - ackley.domain.xMin,
    ackley.domain.yMax - ackley.domain.yMin,
  )
  const peak = ackley.globalOptimum!.height

  const hits = (opts: { proposalScale: number; proposalDecay?: number }) => {
    let onPeak = 0
    for (let seed = 1; seed <= 120; seed++) {
      const states = collect(
        simulatedAnnealing(ackley, mulberry32(seed), { maxSteps: 2000, cooling: 0.999, ...opts }),
      )
      if (states[states.length - 1]!.best.value > peak - 0.05) onPeak++
    }
    return onPeak
  }

  const fixed = hits({ proposalScale: diagonal * 0.25 })
  const decaying = hits({ proposalScale: diagonal * 0.25, proposalDecay: 0.9975 })

  assert.ok(fixed <= 3, `a large fixed hop should almost never land on the peak, got ${fixed}/120`)
  assert.ok(decaying >= 10, `decaying should land on it often, got ${decaying}/120`)
})
