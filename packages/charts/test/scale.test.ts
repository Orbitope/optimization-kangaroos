import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_MARGIN,
  extentOf,
  formatTick,
  layout,
  linearScale,
  nearestIndex,
  niceTicks,
  padExtent,
} from '../dist/scale.js'

test('a linear scale maps the domain onto the range and inverts', () => {
  const s = linearScale({ min: 0, max: 10 }, { min: 100, max: 300 })
  assert.equal(s(0), 100)
  assert.equal(s(10), 300)
  assert.equal(s(5), 200)
  assert.equal(s.invert(200), 5)
  // Extrapolation is allowed; clamping silently would hide out-of-range data.
  assert.equal(s(20), 500)
})

test('an inverted range works, which is what every y axis needs', () => {
  const y = linearScale({ min: 0, max: 1 }, { min: 200, max: 0 })
  assert.equal(y(0), 200)
  assert.equal(y(1), 0)
  assert.ok(y(0.25) > y(0.75), 'larger values must sit higher on screen')
})

test('a flat domain lands mid-range instead of dividing by zero', () => {
  // A constant series is common — an algorithm that converges immediately has
  // one for the rest of the run — and it must not produce NaN marks.
  const s = linearScale({ min: 3, max: 3 }, { min: 0, max: 100 })
  assert.equal(s(3), 50)
  assert.ok(Number.isFinite(s(99)))
})

test('non-finite input yields NaN rather than a wild coordinate', () => {
  const s = linearScale({ min: 0, max: 1 }, { min: 0, max: 100 })
  assert.ok(Number.isNaN(s(NaN)))
  assert.ok(Number.isNaN(s(Infinity)))
})

test('extentOf skips non-finite values', () => {
  assert.deepEqual(extentOf([3, 1, 4, 1, 5]), { min: 1, max: 5 })
  assert.deepEqual(extentOf([NaN, 2, Infinity, 7]), { min: 2, max: 7 })
  assert.equal(extentOf([]), null)
  assert.equal(extentOf([NaN, Infinity]), null)
})

test('padExtent opens a window around a flat extent', () => {
  const p = padExtent({ min: 0, max: 10 }, 0.1)
  assert.equal(p.min, -1)
  assert.equal(p.max, 11)
  // Without the special case a constant series would get a zero-height plot.
  const flat = padExtent({ min: 5, max: 5 })
  assert.ok(flat.max > flat.min)
})

test('ticks land on 1/2/5 multiples and stay inside the domain', () => {
  for (const [lo, hi] of [
    [0, 1],
    [0, 100],
    [-3.5, 8.2],
    [0, 0.004],
    [1200, 9800],
  ] as const) {
    const ticks = niceTicks({ min: lo, max: hi }, 5)
    assert.ok(ticks.length >= 2, `only ${ticks.length} ticks for ${lo}..${hi}`)
    for (const t of ticks) {
      assert.ok(t >= lo - 1e-9 && t <= hi + 1e-9, `tick ${t} outside ${lo}..${hi}`)
    }
    const step = ticks[1]! - ticks[0]!
    const mantissa = step / Math.pow(10, Math.floor(Math.log10(step)))
    assert.ok(
      [1, 2, 5, 10].some((m) => Math.abs(mantissa - m) < 1e-6),
      `step ${step} has mantissa ${mantissa}, not a 1/2/5 multiple`,
    )
  }
})

test('ticks are exact, not float-accumulated', () => {
  // Repeated addition of 0.1 gives 0.30000000000000004, which then prints as a
  // label. The rounding in niceTicks exists to stop that reaching the axis.
  for (const t of niceTicks({ min: 0, max: 1 }, 10)) {
    assert.equal(t, Number(t.toFixed(10)), `${t} carries float noise`)
  }
})

test('a degenerate domain yields one tick rather than looping forever', () => {
  assert.deepEqual(niceTicks({ min: 4, max: 4 }), [4])
  assert.deepEqual(niceTicks({ min: 0, max: NaN }), [0])
})

test('tick labels carry enough decimals for their step', () => {
  const coarse = [0, 25, 50, 75, 100]
  assert.equal(formatTick(50, coarse), '50')
  const fine = [0, 0.01, 0.02]
  assert.equal(formatTick(0.01, fine), '0.01')
  assert.match(formatTick(123456, [0, 50000]), /e\+/)
})

test('layout never produces a negative drawable area', () => {
  // Charts get laid out at zero width for a frame during mount; an inverted
  // inner box there would put every mark at a negative coordinate.
  const tiny = layout(10, 10, DEFAULT_MARGIN)
  assert.equal(tiny.inner.w, 0)
  assert.equal(tiny.inner.h, 0)

  const normal = layout(600, 300)
  assert.equal(normal.inner.w, 600 - DEFAULT_MARGIN.left - DEFAULT_MARGIN.right)
  assert.equal(normal.inner.h, 300 - DEFAULT_MARGIN.top - DEFAULT_MARGIN.bottom)
})

test('nearestIndex finds the closest datum to a pixel', () => {
  const s = linearScale({ min: 0, max: 10 }, { min: 0, max: 100 })
  const xs = [0, 2, 4, 6, 8, 10]
  assert.equal(nearestIndex(s, xs, 0), 0)
  assert.equal(nearestIndex(s, xs, 100), 5)
  assert.equal(nearestIndex(s, xs, 39), 2) // 3.9 -> nearest is 4
  assert.equal(nearestIndex(s, xs, 51), 3) // 5.1 -> nearest is 6
  assert.equal(nearestIndex(s, [], 50), -1)
})
