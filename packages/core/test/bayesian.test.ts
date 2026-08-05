import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SURFACES_BY_NAME,
  bayesianOptimization,
  cholesky,
  choleskySolve,
  collect,
  expectedImprovement,
  fitGaussianProcess,
  matern52,
  mulberry32,
  makeAcquisition,
  posteriorGrid,
  square,
  uniform,
  upperConfidenceBound,
  type Surface,
} from '../dist/index.js'

const OPTS = { lengthScale: 1, variance: 4, noise: 1e-8 }

/** A smooth bump, so the posterior has something learnable to converge onto. */
const bump: Surface = {
  name: 'bump',
  domain: square(-5, 5),
  height: (x, y) => 10 * Math.exp(-(x * x + y * y) / 8),
  gradient: (x, y) => {
    const h = 10 * Math.exp(-(x * x + y * y) / 8)
    return { x: (-h * x) / 4, y: (-h * y) / 4 }
  },
  globalOptimum: { x: 0, y: 0, height: 10 },
}

// ── linear algebra ─────────────────────────────────────────────────────────

test('cholesky factors a known matrix and reproduces it', () => {
  const a = [
    [4, 12, -16],
    [12, 37, -43],
    [-16, -43, 98],
  ]
  const l = cholesky(a, 3)
  assert.ok(l)

  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0
      for (let k = 0; k < 3; k++) sum += l![i]![k]! * l![j]![k]!
      assert.ok(Math.abs(sum - a[i]![j]!) < 1e-9, `L L^T [${i}][${j}] = ${sum}, want ${a[i]![j]}`)
    }
  }
})

test('cholesky returns null rather than NaN on a non-positive-definite matrix', () => {
  // Two identical observations produce exactly this, and the caller's fix is
  // more jitter — which it cannot do if the failure arrived as a silent NaN.
  assert.equal(cholesky([[1, 2], [2, 1]], 2), null)
  assert.equal(cholesky([[0, 0], [0, 0]], 2), null)
})

test('choleskySolve inverts the system it was given', () => {
  const a = [
    [4, 1, 0],
    [1, 3, 1],
    [0, 1, 2],
  ]
  const l = cholesky(a, 3)!
  const b = [1, 2, 3]
  const x = choleskySolve(l, b, 3)

  for (let i = 0; i < 3; i++) {
    let sum = 0
    for (let k = 0; k < 3; k++) sum += a[i]![k]! * x[k]!
    assert.ok(Math.abs(sum - b[i]!) < 1e-9, `row ${i}: ${sum} != ${b[i]}`)
  }
})

// ── kernel ─────────────────────────────────────────────────────────────────

test('matern52 peaks at zero distance and decays monotonically', () => {
  assert.equal(matern52(0, 1, 4), 4)
  let prev = Infinity
  for (let r = 0; r <= 8; r += 0.25) {
    const k = matern52(r, 1, 4)
    assert.ok(k <= prev + 1e-12, `kernel rose at r=${r}`)
    assert.ok(k >= 0, `kernel went negative at r=${r}`)
    prev = k
  }
  assert.ok(matern52(20, 1, 4) < 1e-6, 'kernel should be ~0 far beyond the length scale')
})

test('a longer length scale means slower decay', () => {
  assert.ok(matern52(2, 3, 1) > matern52(2, 1, 1))
})

// ── the posterior ──────────────────────────────────────────────────────────

test('the posterior interpolates its observations', () => {
  const obs = [
    { position: { x: -2, y: 0 }, value: 3 },
    { position: { x: 0, y: 0 }, value: 7 },
    { position: { x: 2, y: 1 }, value: -1 },
  ]
  const gp = fitGaussianProcess(obs, OPTS)

  for (const o of obs) {
    const { mean, sd } = gp.predict(o.position)
    assert.ok(Math.abs(mean - o.value) < 1e-4, `at ${JSON.stringify(o.position)}: ${mean} != ${o.value}`)
    assert.ok(sd < 1e-3, `uncertainty should vanish at an observation, got ${sd}`)
  }
})

test('uncertainty grows with distance from the nearest observation', () => {
  const gp = fitGaussianProcess([{ position: { x: 0, y: 0 }, value: 1 }], OPTS)
  let prev = -Infinity
  for (let r = 0; r <= 6; r += 0.5) {
    const { sd } = gp.predict({ x: r, y: 0 })
    assert.ok(sd >= prev - 1e-9, `uncertainty fell at r=${r}: ${sd} after ${prev}`)
    prev = sd
  }
  // Far away it reverts to the prior.
  assert.ok(Math.abs(prev - Math.sqrt(OPTS.variance)) < 1e-3, `far-field sd ${prev}`)
})

test('the posterior reverts to the mean of the observations, not to zero', () => {
  // With a zero prior, unexplored ground reads as a giant hole and the search
  // goes hunting for it — it would systematically avoid everywhere it has not
  // already been, which is exactly backwards.
  const obs = [
    { position: { x: -1, y: 0 }, value: 100 },
    { position: { x: 1, y: 0 }, value: 102 },
  ]
  const gp = fitGaussianProcess(obs, OPTS)
  const far = gp.predict({ x: 40, y: 40 })
  assert.ok(Math.abs(far.mean - 101) < 1e-6, `far-field mean ${far.mean}, want the observed mean`)
})

test('duplicate observations do not produce NaN', () => {
  const obs = [
    { position: { x: 1, y: 1 }, value: 5 },
    { position: { x: 1, y: 1 }, value: 5 },
    { position: { x: 1, y: 1 + 1e-12 }, value: 5 },
  ]
  const gp = fitGaussianProcess(obs, OPTS)
  const p = gp.predict({ x: 1, y: 1 })
  assert.ok(Number.isFinite(p.mean), `mean was ${p.mean}`)
  assert.ok(Number.isFinite(p.sd) && p.sd >= 0, `sd was ${p.sd}`)
})

test('an empty process is all prior', () => {
  const gp = fitGaussianProcess([], OPTS)
  const p = gp.predict({ x: 3, y: 3 })
  assert.equal(p.sd, Math.sqrt(OPTS.variance))
  assert.ok(Number.isFinite(p.mean))
})

// ── acquisition ────────────────────────────────────────────────────────────

test('expected improvement is never negative', () => {
  for (let mean = -5; mean <= 5; mean += 0.5) {
    for (const sd of [0, 0.01, 0.5, 3]) {
      const ei = expectedImprovement(mean, sd, 1)
      assert.ok(ei >= 0, `EI(${mean}, ${sd}) = ${ei}`)
    }
  }
})

test('expected improvement is zero where she is certain and no better off', () => {
  assert.equal(expectedImprovement(0.5, 0, 1), 0)
  assert.equal(expectedImprovement(5, 0, 1), 0)
})

test('expected improvement rewards uncertainty at equal means', () => {
  // The whole point of the method: a place she knows nothing about beats a
  // place she is confident is merely average.
  const certain = expectedImprovement(1, 0.01, 1, 0)
  const unsure = expectedImprovement(1, 2, 1, 0)
  assert.ok(unsure > certain, `${unsure} should beat ${certain}`)
})

test('expected improvement rewards height at equal uncertainty', () => {
  assert.ok(expectedImprovement(3, 1, 1) > expectedImprovement(0, 1, 1))
})

test('xi raises the bar, so marginal improvements stop counting', () => {
  assert.ok(expectedImprovement(1.05, 0.2, 1, 0) > expectedImprovement(1.05, 0.2, 1, 0.5))
})

// ── the grid ───────────────────────────────────────────────────────────────

test('the posterior grid is the requested size and its ranges bracket its values', () => {
  const gp = fitGaussianProcess(
    [
      { position: { x: -3, y: -3 }, value: 1 },
      { position: { x: 2, y: 2 }, value: 8 },
    ],
    OPTS,
  )
  const grid = posteriorGrid(gp, bump, 8, 16)

  assert.equal(grid.resolution, 16)
  assert.equal(grid.mean.length, 256)
  assert.equal(grid.sd.length, 256)
  assert.equal(grid.acquisition.length, 256)

  for (const v of grid.mean) {
    assert.ok(v >= grid.meanRange[0] - 1e-9 && v <= grid.meanRange[1] + 1e-9)
  }
  for (const v of grid.sd) assert.ok(v >= 0)
  for (const v of grid.acquisition) assert.ok(v >= 0)
})

test('the grid argmax really is the acquisition maximum', () => {
  const gp = fitGaussianProcess([{ position: { x: 0, y: 0 }, value: 5 }], OPTS)
  const grid = posteriorGrid(gp, bump, 5, 24)

  let best = -Infinity
  for (const v of grid.acquisition) if (v > best) best = v
  assert.equal(best, grid.acquisitionRange[1])

  const a = gp.predict(grid.argmax)
  const eiAtArgmax = expectedImprovement(a.mean, a.sd, 5)
  assert.ok(
    Math.abs(eiAtArgmax - best) < 1e-9,
    `argmax scores ${eiAtArgmax}, grid maximum is ${best}`,
  )
})

// ── the optimizer ──────────────────────────────────────────────────────────

test('the run is seeded and reproducible', () => {
  const a = collect(bayesianOptimization(bump, mulberry32(4), { maxSteps: 12 }))
  const b = collect(bayesianOptimization(bump, mulberry32(4), { maxSteps: 12 }))
  assert.equal(a.length, b.length)
  a.forEach((s, i) => {
    assert.deepEqual(s.position, b[i]!.position)
    assert.equal(s.value, b[i]!.value)
  })
})

test('every observation is a real altitude at a real place', () => {
  const states = collect(bayesianOptimization(bump, mulberry32(1), { maxSteps: 15 }))
  const last = states[states.length - 1]!

  for (const o of last.observations) {
    assert.ok(o.position.x >= -5 && o.position.x <= 5, `x out of domain: ${o.position.x}`)
    assert.ok(o.position.y >= -5 && o.position.y <= 5, `y out of domain: ${o.position.y}`)
    assert.ok(
      Math.abs(o.value - bump.height(o.position.x, o.position.y)) < 1e-12,
      'observation value must be the surface, not the model',
    )
  }
})

test('the terminal state is emitted exactly once', () => {
  const states = collect(bayesianOptimization(bump, mulberry32(2), { maxSteps: 10 }))
  assert.equal(states.filter((s) => s.done).length, 1)
  assert.equal(states[states.length - 1]!.done, true)
  assert.equal(states.length, 11, 'one state per step plus the initial sample')
  assert.equal(states[states.length - 1]!.step, 10)
})

test('best is monotonically non-decreasing', () => {
  const states = collect(bayesianOptimization(bump, mulberry32(3), { maxSteps: 20 }))
  for (let i = 1; i < states.length; i++) {
    assert.ok(
      states[i]!.best.value >= states[i - 1]!.best.value - 1e-12,
      `best fell at step ${i}`,
    )
  }
})

test('the model attached to a step is the one that chose it', () => {
  // A reader pausing on a frame should see the acquisition peak the kangaroo is
  // standing on, not a map redrawn to include where she has just landed.
  const states = collect(bayesianOptimization(bump, mulberry32(5), { maxSteps: 12 }))
  const withModel = states.filter((s) => s.model)
  assert.ok(withModel.length > 0, 'no models recorded')

  for (const s of withModel) {
    assert.ok(
      Math.hypot(s.position.x - s.model!.argmax.x, s.position.y - s.model!.argmax.y) < 1e-9,
      `stood at ${JSON.stringify(s.position)}, model chose ${JSON.stringify(s.model!.argmax)}`,
    )
  }
})

test('recordModel off keeps the grids out of the states', () => {
  const states = collect(
    bayesianOptimization(bump, mulberry32(1), { maxSteps: 10, recordModel: false }),
  )
  assert.equal(states.filter((s) => s.model).length, 0)
})

test('uncertainty falls as the cairns accumulate', () => {
  const states = collect(bayesianOptimization(bump, mulberry32(8), { maxSteps: 24 }))
  const withModel = states.filter((s) => s.model)
  const early = withModel[1]!.meta.meanUncertainty!
  const late = withModel[withModel.length - 1]!.meta.meanUncertainty!
  assert.ok(late < early, `uncertainty went from ${early} to ${late}`)
})

test('twenty deliberate hops beat five hundred blind ones on a smooth surface', () => {
  // The claim the section rests on, asserted rather than hoped for. Averaged
  // over seeds, because a single run of either can get lucky.
  let bo = 0
  for (let seed = 0; seed < 8; seed++) {
    const states = collect(bayesianOptimization(bump, mulberry32(seed), { maxSteps: 20 }))
    bo += states[states.length - 1]!.best.value
  }
  bo /= 8
  assert.ok(bo > 9.5, `Bayesian optimization averaged ${bo.toFixed(2)} of a possible 10`)
})

test('the model earns its keep — it beats random search at the same budget', () => {
  // The claim that justifies the whole section, and the honest form of it.
  // "Twenty hops beats five hundred" was never the right comparison: a hill
  // climber stalls after seven to thirty evaluations, so it never spends five
  // hundred. What Bayesian optimization actually offers is more per
  // evaluation, and the control that isolates that is random sampling of the
  // same budget on the same seeds.
  const BUDGET = 25
  const SEEDS = 12

  for (const name of ['Ackley', 'Schwefel', 'Eggholder'] as const) {
    const surface = SURFACES_BY_NAME[name]!
    let modelled = 0
    let blind = 0

    for (let seed = 0; seed < SEEDS; seed++) {
      const states = collect(
        bayesianOptimization(surface, mulberry32(seed), { maxSteps: BUDGET, recordModel: false }),
      )
      modelled += states[states.length - 1]!.best.value

      const rng = mulberry32(seed)
      const d = surface.domain
      let best = -Infinity
      for (let i = 0; i <= BUDGET; i++) {
        const x = uniform(rng, d.xMin, d.xMax)
        const y = uniform(rng, d.yMin, d.yMax)
        best = Math.max(best, surface.height(x, y))
      }
      blind += best
    }

    assert.ok(
      modelled / SEEDS > blind / SEEDS,
      `${name}: modelled ${(modelled / SEEDS).toFixed(1)} did not beat random ${(blind / SEEDS).toFixed(1)}`,
    )
  }
})

test('the length scale is not a knife edge', () => {
  // Documented as the most consequential setting, which invites tuning it to
  // one surface. Across a wide sweep the outcome barely moves — what the
  // length scale really governs is how the belief surface *looks*, which is
  // the reason to leave the default alone rather than chase a benchmark.
  const surface = SURFACES_BY_NAME.Ackley!
  const scores = [0.12, 0.18, 0.35].map((lengthScaleFraction) => {
    let total = 0
    for (let seed = 0; seed < 8; seed++) {
      const states = collect(
        bayesianOptimization(surface, mulberry32(seed), {
          maxSteps: 25,
          recordModel: false,
          lengthScaleFraction,
        }),
      )
      total += states[states.length - 1]!.best.value
    }
    return total / 8
  })

  const spread = Math.max(...scores) - Math.min(...scores)
  assert.ok(spread < 4, `length scale swung the result by ${spread.toFixed(1)}: ${scores}`)
})

// ── the exploration dial ───────────────────────────────────────────────────

test('kappa sweeps from pure exploitation to pure exploration', () => {
  // The claim that a slider on this figure would be honest. Measured, not
  // asserted: how far each new sample lands from the nearest place she has
  // already stood. Exploitation means going back to what worked, so that
  // distance is small; exploration means going somewhere new, so it is large.
  const surface = SURFACES_BY_NAME.Himmelblau!
  const d = surface.domain

  const novelty = (kappa: number) => {
    let total = 0
    let count = 0
    for (let seed = 0; seed < 10; seed++) {
      const states = collect(
        bayesianOptimization(surface, mulberry32(seed), {
          maxSteps: 24,
          acquisition: 'ucb',
          kappa,
          recordModel: false,
        }),
      )
      const seen = states[states.length - 1]!.observations
      // Skip the random opening — it is the same regardless of kappa, so
      // including it would dilute the effect being measured.
      for (let i = 6; i < seen.length; i++) {
        let nearest = Infinity
        for (let j = 0; j < i; j++) {
          nearest = Math.min(
            nearest,
            Math.hypot(
              seen[i]!.position.x - seen[j]!.position.x,
              seen[i]!.position.y - seen[j]!.position.y,
            ),
          )
        }
        total += nearest
        count++
      }
    }
    return total / count / Math.hypot(d.xMax - d.xMin, d.yMax - d.yMin)
  }

  const exploit = novelty(0)
  const middle = novelty(2)
  const explore = novelty(12)

  assert.ok(
    exploit < middle && middle < explore,
    `kappa should sweep novelty monotonically, got ${exploit.toFixed(4)} -> ${middle.toFixed(4)} -> ${explore.toFixed(4)}`,
  )
  // And it must be a real swing rather than a rounding artefact.
  assert.ok(
    explore > exploit * 3,
    `kappa 12 should explore far more than kappa 0: ${explore.toFixed(4)} vs ${exploit.toFixed(4)}`,
  )
})

test('pure exploitation is worse than the balanced setting, which is the point', () => {
  // If kappa 0 did just as well there would be no trade-off to teach.
  const surface = SURFACES_BY_NAME.Ackley!
  const mean = (kappa: number) => {
    let total = 0
    for (let seed = 0; seed < 12; seed++) {
      const states = collect(
        bayesianOptimization(surface, mulberry32(seed), {
          maxSteps: 25,
          acquisition: 'ucb',
          kappa,
          recordModel: false,
        }),
      )
      total += states[states.length - 1]!.best.value
    }
    return total / 12
  }
  assert.ok(mean(2) > mean(0), `balanced ${mean(2).toFixed(2)} should beat greedy ${mean(0).toFixed(2)}`)
})

test('ucb is the mean plus kappa standard deviations, exactly', () => {
  assert.equal(upperConfidenceBound(3, 0.5, 0), 3)
  assert.equal(upperConfidenceBound(3, 0.5, 2), 4)
  assert.equal(upperConfidenceBound(-1, 2, 1.5), 2)
})

test('makeAcquisition returns the function it was asked for', () => {
  const ei = makeAcquisition('ei', { xi: 0 })
  assert.equal(ei(2, 1, 1), expectedImprovement(2, 1, 1, 0))

  const ucb = makeAcquisition('ucb', { kappa: 3 })
  // Shifted by the incumbent, so zero means the same thing in both modes.
  assert.equal(ucb(2, 1, 1), 2 + 3 * 1 - 1)
})

test('posteriorGrid still accepts a bare xi, so old call sites keep working', () => {
  const gp = fitGaussianProcess([{ position: { x: 0, y: 0 }, value: 5 }], OPTS)
  const viaNumber = posteriorGrid(gp, bump, 5, 12, 0.01)
  const viaFunction = posteriorGrid(gp, bump, 5, 12, makeAcquisition('ei', { xi: 0.01 }))
  assert.deepEqual(Array.from(viaNumber.acquisition), Array.from(viaFunction.acquisition))
})
