/**
 * @kangaroos/charts — the 2D analytics layer.
 *
 * Distinct from the 3D scene: a search view shows *how* an algorithm behaves on
 * one run, and these show what happens across many. Neither substitutes for the
 * other, which is why the article needs both.
 *
 * Same discipline as the scene package — no component owns a clock. Anything
 * animated takes a step or frame number as a prop, so a scrubber, an
 * IntersectionObserver, and a Remotion render all drive the same code.
 */

export * from './scale.js'
export * from './draw.js'
export * from './Chart.js'
export * from './ConvergenceChart.js'
export * from './OutcomeChart.js'
