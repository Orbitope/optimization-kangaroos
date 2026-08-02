import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ackley,
  clusterOptima,
  collect,
  geneticAlgorithm,
  gradientAscent,
  hillClimber,
  himmelblau,
  mulberry32,
  quantile,
  quantileBands,
  runEnsemble,
  schwefel,
  shubert,
  simulatedAnnealing,
} from '../dist/index.js'

// ── proposals ──────────────────────────────────────────────────────────────

test('proposals are off unless asked for', () => {
  for (const s of collect(hillClimber(himmelblau, mulberry32(1)))) {
    assert.equal(s.proposals, undefined)
  }
  for (const s of collect(simulatedAnnealing(himmelblau, mulberry32(1)))) {
    assert.equal(s.proposals, undefined)
  }
})

test('the hill climber records every direction it tried', () => {
  const states = collect(hillClimber(himmelblau, mulberry32(1), { recordProposals: true }))

  let sawRejection = false
  for (const s of states.slice(1)) {
    assert.ok(Array.isArray(s.proposals), `step ${s.step} recorded nothing`)
    // At most one proposal is accepted, and it must be the last one tried —
    // the search breaks out of the loop as soon as something sticks.
    const accepted = s.proposals!.filter((p) => p.accepted)
    assert.ok(accepted.length <= 1, `step ${s.step} accepted ${accepted.length} proposals`)
    if (accepted.length === 1) {
      assert.equal(s.proposals![s.proposals!.length - 1]!.accepted, true)
      assert.deepEqual(accepted[0]!.position, s.position)
    }
    if (s.proposals!.some((p) => !p.accepted)) sawRejection = true
  }
  assert.ok(sawRejection, 'a hill climber that never rejects anything is not searching')
})

test('recorded proposal values match the surface', () => {
  for (const s of collect(hillClimber(himmelblau, mulberry32(7), { recordProposals: true }))) {
    for (const p of s.proposals ?? []) {
      assert.ok(Math.abs(himmelblau.height(p.position.x, p.position.y) - p.value) < 1e-9)
    }
  }
})

test('recording proposals does not change the search', () => {
  // The RNG must be consumed identically either way, or the 3D view would show
  // a different run than the charts.
  const plain = collect(hillClimber(schwefel, mulberry32(3)))
  const recorded = collect(hillClimber(schwefel, mulberry32(3), { recordProposals: true }))
  assert.equal(plain.length, recorded.length)
  plain.forEach((s, i) => {
    assert.deepEqual(s.position, recorded[i]!.position)
    assert.equal(s.value, recorded[i]!.value)
  })
})

test('annealing records the Metropolis probability it gambled on', () => {
  const states = collect(simulatedAnnealing(schwefel, mulberry32(2), { recordProposals: true }))

  let downhillTaken = 0
  for (const s of states.slice(1)) {
    assert.equal(s.proposals?.length, 1)
    const p = s.proposals![0]!
    assert.ok(p.acceptProbability !== undefined)
    // Late in a cooled run, exp(delta / T) underflows to exactly 0 for a steep
    // downhill move. That is the correct probability, not a bug.
    assert.ok(p.acceptProbability! >= 0 && p.acceptProbability! <= 1)
    assert.ok(Number.isFinite(p.acceptProbability!))
    if (p.accepted && p.value < s.best.value) downhillTaken++
  }
  // Leaving good ground is the entire mechanism; a run that never does it is
  // just an expensive hill climber.
  assert.ok(downhillTaken > 0, 'annealing never took a downhill move')
})

test('an uphill proposal is always certain', () => {
  for (const s of collect(simulatedAnnealing(himmelblau, mulberry32(9), { recordProposals: true }))) {
    for (const p of s.proposals ?? []) {
      if (p.value >= s.value) continue
      assert.ok(p.acceptProbability! < 1, 'a downhill move should be a gamble')
    }
  }
})

// ── ensembles ──────────────────────────────────────────────────────────────

const seeds = Array.from({ length: 20 }, (_, i) => i)

test('an ensemble runs every seed it was given', () => {
  const r = runEnsemble(himmelblau, (s, rng) => hillClimber(s, rng), { seeds })
  assert.equal(r.runs.length, seeds.length)
  assert.deepEqual(
    r.runs.map((x) => x.seed),
    seeds,
  )
  assert.equal(r.surface, 'Himmelblau')
})

test('traces are monotonic best-so-far and end on the reported best', () => {
  const r = runEnsemble(schwefel, (s, rng) => simulatedAnnealing(s, rng), { seedCount: 8 })
  for (const run of r.runs) {
    assert.equal(run.trace.length, run.steps + 1)
    for (let i = 1; i < run.trace.length; i++) {
      assert.ok(run.trace[i]! >= run.trace[i - 1]!, `seed ${run.seed} regressed at ${i}`)
    }
    assert.equal(run.trace[run.trace.length - 1], run.bestValue)
  }
})

test('convergedAt is where the best value was first reached', () => {
  const r = runEnsemble(himmelblau, (s, rng) => gradientAscent(s, rng), { seedCount: 10 })
  for (const run of r.runs) {
    assert.equal(run.trace[run.convergedAt], run.bestValue)
    if (run.convergedAt > 0) {
      assert.ok(run.trace[run.convergedAt - 1]! < run.bestValue, `seed ${run.seed}`)
    }
  }
})

test('ensembles are reproducible', () => {
  const run = () => runEnsemble(ackley, (s, rng) => geneticAlgorithm(s, rng), { seeds })
  const a = run()
  const b = run()
  a.runs.forEach((x, i) => {
    assert.equal(x.bestValue, b.runs[i]!.bestValue)
    assert.deepEqual(x.bestPosition, b.runs[i]!.bestPosition)
  })
})

test('success rate is null when the surface has no declared optimum', () => {
  // Shubert has eighteen tied maxima; reporting 0% would be a lie, not a result.
  const r = runEnsemble(shubert, (s, rng) => hillClimber(s, rng), { seedCount: 5 })
  assert.equal(r.successRate, null)
})

test('success rate lands between 0 and 1 and reflects difficulty', () => {
  const hc = runEnsemble(ackley, (s, rng) => hillClimber(s, rng), { seeds })
  const ga = runEnsemble(ackley, (s, rng) => geneticAlgorithm(s, rng), { seeds })

  for (const r of [hc, ga]) {
    assert.ok(r.successRate !== null && r.successRate >= 0 && r.successRate <= 1)
  }
  // Ackley is a near-flat plain with one narrow spike. A population should beat
  // a lone blind climber, and this is the figure that shows it.
  assert.ok(ga.successRate! > hc.successRate!, `GA ${ga.successRate} vs HC ${hc.successRate}`)
})

test('on Himmelblau every run succeeds, in four different places', () => {
  // All four maxima are worth exactly 0, so a value-based success rate is
  // degenerate here — everyone wins. The real result is *where* they ended up.
  const r = runEnsemble(himmelblau, (s, rng) => gradientAscent(s, rng, { stepDecay: 0.99 }), {
    seedCount: 80,
  })
  assert.ok(r.successRate! > 0.9, `success rate was ${r.successRate}`)

  const clusters = clusterOptima(r, 0.5)
  assert.equal(clusters.length, 4, `found ${clusters.length} basins, expected 4`)

  const known = [
    { x: 3, y: 2 },
    { x: -2.805118, y: 3.131312 },
    { x: -3.77931, y: -3.283186 },
    { x: 3.584428, y: -1.848126 },
  ]
  for (const c of clusters) {
    assert.ok(
      known.some((k) => Math.hypot(k.x - c.position.x, k.y - c.position.y) < 0.1),
      `cluster at (${c.position.x}, ${c.position.y}) is not a known optimum`,
    )
    assert.ok(c.share > 0.05, `a basin with only ${c.share} share looks like noise`)
  }
  assert.ok(Math.abs(clusters.reduce((s, c) => s + c.share, 0) - 1) < 1e-9)
})

test('on Schwefel the local slope leads away from the summit', () => {
  // The honest case for a success rate: one global optimum, and following the
  // gradient from a random start almost never reaches it. This is the figure
  // that justifies every global method in Act 3.
  const climb = runEnsemble(schwefel, (s, rng) => gradientAscent(s, rng, { stepDecay: 0.99 }), {
    seedCount: 40,
  })
  const anneal = runEnsemble(schwefel, (s, rng) => simulatedAnnealing(s, rng), { seedCount: 40 })

  assert.ok(climb.successRate! < 0.4, `gradient ascent succeeded ${climb.successRate} of the time`)
  assert.ok(
    anneal.successRate! > climb.successRate!,
    `annealing ${anneal.successRate} should beat gradient ascent ${climb.successRate}`,
  )

  // And it scatters: many runs, many different summits.
  assert.ok(clusterOptima(climb, 20).length > 3, 'gradient ascent should land all over Schwefel')
})

test('clusterOptima validates its radius and collapses everything at a huge one', () => {
  const r = runEnsemble(himmelblau, (s, rng) => gradientAscent(s, rng, { stepDecay: 0.99 }), {
    seedCount: 20,
  })
  assert.throws(() => clusterOptima(r, 0), /must be positive/)
  const one = clusterOptima(r, 1e6)
  assert.equal(one.length, 1)
  assert.equal(one[0]!.count, 20)
  assert.equal(one[0]!.share, 1)
})

test('a constant step size makes the kangaroo overshoot the peak forever', () => {
  // The email's complaint about standard backprop, reproduced exactly: "If the
  // kangaroo ever gets near the peak, she may jump back and forth across the
  // peak without ever landing on it. If you use a decaying step size, the
  // kangaroo gets tired and makes smaller and smaller hops, so if she ever gets
  // near the peak she has a better chance of actually landing on it."
  const near = (r: { runs: readonly { bestValue: number }[] }) =>
    r.runs.filter((x) => x.bestValue > -0.05).length / r.runs.length

  const constant = runEnsemble(himmelblau, (s, rng) => gradientAscent(s, rng), { seedCount: 60 })
  const decaying = runEnsemble(
    himmelblau,
    (s, rng) => gradientAscent(s, rng, { stepDecay: 0.99 }),
    { seedCount: 60 },
  )

  assert.ok(
    near(decaying) > near(constant) + 0.4,
    `decaying ${near(decaying)} vs constant ${near(constant)} — the effect should be large`,
  )
})

test('a tighter epsilon cannot raise the success rate', () => {
  const loose = runEnsemble(himmelblau, (s, rng) => gradientAscent(s, rng), {
    seeds,
    successEpsilon: 0.2,
  })
  const tight = runEnsemble(himmelblau, (s, rng) => gradientAscent(s, rng), {
    seeds,
    successEpsilon: 0.0001,
  })
  assert.ok(tight.successRate! <= loose.successRate!)
})

test('an empty ensemble is an error, not an empty result', () => {
  assert.throws(() => runEnsemble(himmelblau, (s, rng) => hillClimber(s, rng), { seeds: [] }), /at least one seed/)
})

// ── quantiles ──────────────────────────────────────────────────────────────

test('quantile interpolates and clamps', () => {
  const xs = [0, 1, 2, 3, 4]
  assert.equal(quantile(xs, 0), 0)
  assert.equal(quantile(xs, 0.5), 2)
  assert.equal(quantile(xs, 1), 4)
  assert.equal(quantile(xs, 0.25), 1)
  assert.equal(quantile([7], 0.5), 7)
  assert.equal(quantile(xs, -1), 0)
  assert.equal(quantile(xs, 9), 4)
  assert.throws(() => quantile([], 0.5), /quantile of nothing/)
})

test('bands span the longest run and stay ordered', () => {
  const r = runEnsemble(schwefel, (s, rng) => hillClimber(s, rng), { seeds })
  const bands = quantileBands(r)
  assert.equal(bands.length, r.maxSteps + 1)

  for (const b of bands) {
    assert.ok(b.lower <= b.median && b.median <= b.upper, `step ${b.step} is out of order`)
  }
  for (let i = 1; i < bands.length; i++) {
    assert.ok(bands[i]!.median >= bands[i - 1]!.median, 'the median of a best-so-far cannot fall')
  }
})

test('short runs are padded forward, not dropped', () => {
  // A run that converged at step 40 still has that altitude at step 400.
  // Truncating instead would make the median lurch each time a run drops out.
  const r = runEnsemble(himmelblau, (s, rng) => hillClimber(s, rng), { seeds })
  const shortest = Math.min(...r.runs.map((x) => x.steps))
  assert.ok(shortest < r.maxSteps, 'need runs of differing length to test padding')

  const bands = quantileBands(r)
  const final = bands[bands.length - 1]!
  const sorted = r.runs.map((x) => x.bestValue).sort((a, b) => a - b)
  assert.ok(Math.abs(final.median - quantile(sorted, 0.5)) < 1e-9)
})
