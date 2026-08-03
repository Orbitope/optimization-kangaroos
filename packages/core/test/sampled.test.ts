import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_FEATURES,
  collect,
  createBatchSurface,
  createSampledSurface,
  createTrueSurface,
  domainDiagonal,
  drawExamples,
  gradientAscent,
  himmelblau,
  inDomain,
  magnitude,
  mulberry32,
  sampleHeightGrid,
  uniform,
} from '../dist/index.js'

const truth = createTrueSurface()

/** Mean absolute difference between two surfaces on a grid. */
function divergence(a: { height(x: number, y: number): number }, b: typeof truth, n = 48) {
  const { xMin, xMax, yMin, yMax } = truth.domain
  let sum = 0
  for (let j = 0; j < n; j++) {
    const y = yMin + ((yMax - yMin) * j) / (n - 1)
    for (let i = 0; i < n; i++) {
      const x = xMin + ((xMax - xMin) * i) / (n - 1)
      sum += Math.abs(a.height(x, y) - b.height(x, y))
    }
  }
  return sum / (n * n)
}

// ── drawing examples ───────────────────────────────────────────────────────

test('examples are drawn near the features, in the right proportions', () => {
  const examples = drawExamples(4000, mulberry32(1))
  assert.equal(examples.length, 4000)

  const total = DEFAULT_FEATURES.reduce((s, f) => s + f.weight, 0)
  const counts = DEFAULT_FEATURES.map(
    (f) => examples.filter((e) => Math.hypot(e.x - f.x, e.y - f.y) < f.sigma).length,
  )
  // The heaviest feature must attract more examples than the lightest.
  assert.ok(counts[0]! > counts[4]! * 2, `got ${counts}`)
  assert.ok(total > 0)
})

test('drawing is reproducible and validated', () => {
  assert.deepEqual(drawExamples(20, mulberry32(9)), drawExamples(20, mulberry32(9)))
  assert.notDeepEqual(drawExamples(20, mulberry32(9)), drawExamples(20, mulberry32(10)))
  assert.throws(() => drawExamples(0, mulberry32(1)), />= 1/)
  assert.throws(() => drawExamples(5, mulberry32(1), []), /at least one feature/)
})

// ── the landscape ──────────────────────────────────────────────────────────

test('a sampled landscape is finite and positive everywhere', () => {
  const s = createSampledSurface({ count: 40, seed: 2 })
  for (let i = 0; i < 500; i++) {
    const rng = mulberry32(i)
    const x = uniform(rng, s.domain.xMin, s.domain.xMax)
    const y = uniform(rng, s.domain.yMin, s.domain.yMax)
    assert.ok(Number.isFinite(s.height(x, y)) && s.height(x, y) >= 0)
    const g = s.gradient(x, y)
    assert.ok(Number.isFinite(g.x) && Number.isFinite(g.y))
  }
})

test('analytic gradients match central differences', () => {
  const s = createSampledSurface({ count: 60, seed: 3 })
  const h = domainDiagonal(s.domain) * 1e-6
  for (let i = 0; i < 200; i++) {
    const rng = mulberry32(1000 + i)
    const x = uniform(rng, s.domain.xMin + 1, s.domain.xMax - 1)
    const y = uniform(rng, s.domain.yMin + 1, s.domain.yMax - 1)
    const a = s.gradient(x, y)
    const numeric = {
      x: (s.height(x + h, y) - s.height(x - h, y)) / (2 * h),
      y: (s.height(x, y + h) - s.height(x, y - h)) / (2 * h),
    }
    const scale = Math.max(1e-6, magnitude(a), magnitude(numeric))
    assert.ok(
      Math.hypot(a.x - numeric.x, a.y - numeric.y) / scale < 1e-3,
      `at (${x}, ${y}): ${JSON.stringify(a)} vs ${JSON.stringify(numeric)}`,
    )
  }
})

test('more examples means a landscape closer to the truth', () => {
  // The core claim of Act 4, asserted rather than asserted-at.
  const errors = [10, 40, 160, 640, 2560].map((count) =>
    divergence(createSampledSurface({ count, seed: 7 }), truth),
  )
  for (let i = 1; i < errors.length; i++) {
    assert.ok(errors[i]! < errors[i - 1]!, `error rose from ${errors[i - 1]} to ${errors[i]}`)
  }
  assert.ok(errors[4]! < errors[0]! / 4, `2560 examples barely beat 10: ${errors}`)
})

test('the truth is the exact limit, not an approximation', () => {
  // Averaging many independent draws must converge on createTrueSurface(),
  // which is computed in closed form. If the closed form were wrong this is
  // where it would show.
  const draws = Array.from({ length: 24 }, (_, k) =>
    createSampledSurface({ count: 3000, seed: 500 + k }),
  )
  const averaged = {
    height: (x: number, y: number) =>
      draws.reduce((s, d) => s + d.height(x, y), 0) / draws.length,
  }
  const peak = sampleHeightGrid(truth, 48).max
  assert.ok(divergence(averaged, truth) < peak * 0.02, 'averaged draws did not match the limit')
})

test('reshuffling moves small bumps and leaves big mountains alone', () => {
  // The beat the section is built on. Same truth, different draw.
  const a = createSampledSurface({ count: 30, seed: 11 })
  const b = createSampledSurface({ count: 30, seed: 12 })

  // Near the dominant feature both draws agree; out in the tail they do not.
  const big = DEFAULT_FEATURES[0]!
  const atBig = Math.abs(a.height(big.x, big.y) - b.height(big.x, big.y))
  const peak = sampleHeightGrid(truth, 48).max

  let tailDisagreement = 0
  for (let i = 0; i < 400; i++) {
    const rng = mulberry32(3000 + i)
    const x = uniform(rng, a.domain.xMin, a.domain.xMax)
    const y = uniform(rng, a.domain.yMin, a.domain.yMax)
    if (truth.height(x, y) > peak * 0.25) continue
    tailDisagreement = Math.max(tailDisagreement, Math.abs(a.height(x, y) - b.height(x, y)))
  }
  assert.ok(
    tailDisagreement > atBig,
    `low ground should be less stable than the summit: ${tailDisagreement} vs ${atBig}`,
  )
})

test('small samples disagree with each other far more than large ones', () => {
  const spread = (count: number) => {
    const a = createSampledSurface({ count, seed: 21 })
    const b = createSampledSurface({ count, seed: 22 })
    return divergence(a, b as never)
  }
  assert.ok(spread(10) > spread(1000) * 3, `${spread(10)} vs ${spread(1000)}`)
})

test('a small sample usually produces a summit that is not the real one', () => {
  // The overfitting claim, measured. Climb the sampled landscape, then ask
  // what the true landscape says about where she ended up.
  const peak = sampleHeightGrid(truth, 64).max
  let misled = 0
  const trials = 40

  for (let seed = 0; seed < trials; seed++) {
    const data = createSampledSurface({ count: 12, seed })
    const run = collect(gradientAscent(data, mulberry32(seed), { stepDecay: 0.99, maxSteps: 300 }))
    const at = run[run.length - 1]!.best.position
    if (truth.height(at.x, at.y) < peak * 0.6) misled++
  }
  assert.ok(misled > trials * 0.3, `only ${misled}/${trials} runs were misled by 12 examples`)
})

test('a large sample mostly lands somewhere genuinely high', () => {
  const peak = sampleHeightGrid(truth, 64).max
  let good = 0
  const trials = 40

  for (let seed = 0; seed < trials; seed++) {
    const data = createSampledSurface({ count: 2000, seed })
    const run = collect(gradientAscent(data, mulberry32(seed), { stepDecay: 0.99, maxSteps: 300 }))
    const at = run[run.length - 1]!.best.position
    if (truth.height(at.x, at.y) > peak * 0.6) good++
  }
  assert.ok(good > trials * 0.6, `only ${good}/${trials} runs found real high ground`)
})

test('optimizers treat a sampled landscape like any other surface', () => {
  const data = createSampledSurface({ count: 50, seed: 4 })
  for (const s of collect(gradientAscent(data, mulberry32(1), { maxSteps: 100 }))) {
    assert.ok(inDomain(data.domain, s.position.x, s.position.y))
    assert.ok(Number.isFinite(s.value))
  }
})

// ── mini-batches ───────────────────────────────────────────────────────────

test('consecutive batches build different worlds', () => {
  const a = createBatchSurface(4, 0, {})
  const b = createBatchSurface(4, 1, {})
  assert.ok(divergence(a, b as never) > 0, 'the ground should move between steps')
})

test('a batch run replays identically', () => {
  const first = createBatchSurface(4, 7, { seed: 3 })
  const again = createBatchSurface(4, 7, { seed: 3 })
  assert.equal(first.height(0, 0), again.height(0, 0))
  assert.notEqual(createBatchSurface(4, 7, { seed: 4 }).height(0, 0), first.height(0, 0))
})

test('batches average toward the truth even though each is wild', () => {
  // Why online training works at all: no single world is right, but the pull
  // averages out. Sarle's earthquakes, stated as a property.
  const steps = Array.from({ length: 200 }, (_, i) => createBatchSurface(4, i, { seed: 1 }))
  const averaged = {
    height: (x: number, y: number) => steps.reduce((s, b) => s + b.height(x, y), 0) / steps.length,
  }
  const single = divergence(steps[0]!, truth)
  const many = divergence(averaged, truth)
  assert.ok(many < single / 2, `one batch ${single}, averaged ${many}`)
})

// ── the learning-rate switch ───────────────────────────────────────────────

test('raw gradient mode makes hop length track steepness', () => {
  // Act 2b's whole point. Normalized, every hop is the same length; raw, the
  // hop is a multiple of the slope, which is what a learning rate really is.
  const run = collect(
    gradientAscent(himmelblau, mulberry32(5), {
      normalize: false,
      // Small enough that no hop clamps against the domain wall. At a rate a
      // reader would actually try, the first hop from this corner is half the
      // width of the map — which is the section's point, but makes the
      // proportionality untestable because the clamp truncates it.
      stepSize: 0.0005,
      maxSteps: 60,
      start: { x: -4.5, y: 4.2 },
    }),
  )

  const lengths: number[] = []
  const slopes: number[] = []
  for (let i = 1; i < run.length; i++) {
    lengths.push(
      Math.hypot(
        run[i]!.position.x - run[i - 1]!.position.x,
        run[i]!.position.y - run[i - 1]!.position.y,
      ),
    )
    slopes.push(run[i - 1]!.meta.gradient!)
  }

  // Every hop should be stepSize * slope, up to the domain clamp.
  for (let i = 0; i < Math.min(lengths.length, 20); i++) {
    assert.ok(
      Math.abs(lengths[i]! - slopes[i]! * 0.0005) < 1e-9,
      `hop ${i}: moved ${lengths[i]}, slope was ${slopes[i]}`,
    )
  }
  assert.ok(Math.max(...lengths) > Math.min(...lengths) * 5, 'hop length should vary a lot')
})

test('a raw-gradient hop from steep ground can leave the map entirely', () => {
  // "her hops get longer and more dangerous, and she may hop off the mountain
  // altogether." At a plausible-looking rate the very first hop is enormous.
  const run = collect(
    gradientAscent(himmelblau, mulberry32(5), {
      normalize: false,
      stepSize: 0.02,
      maxSteps: 5,
      start: { x: -4.5, y: 4.2 },
    }),
  )
  const first = Math.hypot(
    run[1]!.position.x - run[0]!.position.x,
    run[1]!.position.y - run[0]!.position.y,
  )
  const width = himmelblau.domain.xMax - himmelblau.domain.xMin
  assert.ok(first > width * 0.09, `first hop covered only ${first} of ${width}`)
})

test('normalized mode is unchanged and still the default', () => {
  const a = collect(gradientAscent(himmelblau, mulberry32(5), { maxSteps: 40 }))
  const b = collect(gradientAscent(himmelblau, mulberry32(5), { normalize: true, maxSteps: 40 }))
  a.forEach((s, i) => assert.deepEqual(s.position, b[i]!.position))
  assert.equal(a[0]!.meta.normalized, 1)
})

test('too large a learning rate overshoots the peak', () => {
  // "she may jump back and forth across the peak without ever landing on it"
  const near = (rate: number) => {
    let best = -Infinity
    for (let seed = 0; seed < 12; seed++) {
      const run = collect(
        gradientAscent(himmelblau, mulberry32(seed), {
          normalize: false,
          stepSize: rate,
          maxSteps: 200,
        }),
      )
      best = Math.max(best, run[run.length - 1]!.best.value)
    }
    return best
  }
  assert.ok(near(0.01) > near(0.2), 'a huge learning rate should do worse, not better')
})
