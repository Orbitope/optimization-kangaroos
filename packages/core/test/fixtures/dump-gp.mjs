/**
 * Dump our GP posterior and acquisition values for cross-validation.
 *
 * Emits JSON that `validate-against-sklearn.py` re-derives with scikit-learn
 * and scipy. Nothing in this file asserts anything — it exists so the check is
 * against a genuinely independent implementation rather than against our own
 * arithmetic restated.
 */
import { writeFileSync } from 'node:fs'

import {
  expectedImprovement,
  fitGaussianProcess,
  matern52,
  mulberry32,
} from '../../dist/index.js'

const rng = mulberry32(20260805)
const uniform = (lo, hi) => lo + (hi - lo) * rng.next()

const CASES = []

// A spread of sizes and geometries, including the awkward ones: a single
// observation, near-duplicate points, and a tight cluster beside a lone
// outlier — the configurations where a hand-rolled Cholesky goes wrong.
const SHAPES = [
  { n: 1, spread: 4, label: 'single' },
  { n: 3, spread: 4, label: 'sparse' },
  { n: 8, spread: 4, label: 'medium' },
  { n: 25, spread: 4, label: 'dense' },
  { n: 40, spread: 6, label: 'large' },
  { n: 12, spread: 0.2, label: 'clustered' },
]

for (const shape of SHAPES) {
  for (const options of [
    { lengthScale: 0.5, variance: 1, noise: 1e-8 },
    { lengthScale: 1.5, variance: 4, noise: 1e-6 },
    { lengthScale: 3, variance: 0.25, noise: 1e-3 },
  ]) {
    const observations = Array.from({ length: shape.n }, () => {
      const x = uniform(-shape.spread, shape.spread)
      const y = uniform(-shape.spread, shape.spread)
      return { position: { x, y }, value: Math.sin(x) * Math.cos(y) * 3 + x * 0.4 }
    })

    const gp = fitGaussianProcess(observations, options)
    const best = Math.max(...observations.map((o) => o.value))

    // Test points on a grid plus the observations themselves, since exact
    // interpolation at the data is the property most likely to be subtly off.
    const query = []
    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) {
        query.push({ x: -5 + (10 * i) / 6, y: -5 + (10 * j) / 6 })
      }
    }
    query.push(...observations.map((o) => o.position))

    CASES.push({
      label: `${shape.label}/ls${options.lengthScale}`,
      options,
      observations,
      best,
      query,
      predictions: query.map((p) => gp.predict(p)),
      ei: query.map((p) => {
        const { mean, sd } = gp.predict(p)
        return expectedImprovement(mean, sd, best, 0.01)
      }),
    })
  }
}

// The kernel on its own, so a disagreement can be localised to the kernel
// rather than to the solve.
const kernelSamples = []
for (let i = 0; i <= 40; i++) {
  const r = (i * 6) / 40
  kernelSamples.push({ r, lengthScale: 1.3, variance: 2.5, k: matern52(r, 1.3, 2.5) })
}

writeFileSync(
  new URL('gp-fixture.json', import.meta.url),
  JSON.stringify({ cases: CASES, kernelSamples }, null, 1),
)
console.log(`wrote ${CASES.length} cases, ${CASES.reduce((n, c) => n + c.query.length, 0)} query points`)
