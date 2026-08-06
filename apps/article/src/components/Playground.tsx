import { CKAgentSeries, CKColor, CKMarker, agentSeries } from '@contentkit/tokens'
import { hopDuration, runMultistart, type OptimizerState, type Surface } from '@kangaroos/core'
import { CANVAS_MONO, ChartFrame, linearScale } from '@kangaroos/charts'
import { SearchScene, useMultiRunView } from '@kangaroos/scene'
import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  ALGORITHMS,
  ALGORITHMS_BY_ID,
  SURFACE_OPTIONS,
  demRegionOf,
  makeFactory,
  resolveSurface,
  type AlgorithmName,
} from '../lib/algorithms.js'
import { useDemSurface } from '../lib/dem.js'

/**
 * The whole thing, with the lid off.
 *
 * The article makes each figure argue one point and hides every control that
 * would distract from it. This is the opposite: one landscape, one algorithm,
 * every knob, and a chart that says what actually happened. It exists because
 * the article's honest answer to "what if the learning rate were slightly
 * different" is a figure that cannot answer it.
 *
 * Deliberately not a second article. There is no narration, and the defaults
 * are the article's defaults so anything a reader saw there is one click away.
 */

const MAX_RUNS = CKAgentSeries.length

/**
 * Bayesian optimization crosses the whole map every step, and the default arc
 * apex is proportional to hop distance. Four runs of that draws forty arcs
 * that tower over the terrain and carry nothing for the height they cost, so
 * this method — and only this method — gets flattened. The same constant is in
 * the article's own Bayesian scene.
 */
const FLAT_ARC = { apexRatio: 0.1 } as const

export function Playground() {
  const [surfaceName, setSurfaceName] = useState('Himmelblau')
  const [algorithm, setAlgorithm] = useState<AlgorithmName>('hill-climber')
  const [seed, setSeed] = useState(1)
  const [runs, setRuns] = useState(1)
  const [maxSteps, setMaxSteps] = useState(ALGORITHMS_BY_ID['hill-climber'].defaultSteps)
  const [rate, setRate] = useState(0.01)
  const [decay, setDecay] = useState(1)
  const [population, setPopulation] = useState(24)
  const [kappa, setKappa] = useState(1.5)
  const [dataSeed, setDataSeed] = useState(0)

  const [contours, setContours] = useState(22)
  const [showGradients, setShowGradients] = useState(false)
  const [showProbes, setShowProbes] = useState(true)
  const [fog, setFog] = useState(false)

  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [frame, setFrame] = useState(0)

  const spec = ALGORITHMS_BY_ID[algorithm]

  // Step budgets differ by an order of magnitude between algorithms — 40 for
  // Bayesian, 700 for annealing — so switching without resetting leaves a
  // nonsense number in the box.
  const chooseAlgorithm = useCallback((next: AlgorithmName) => {
    setAlgorithm(next)
    setMaxSteps(ALGORITHMS_BY_ID[next].defaultSteps)
    setFrame(0)
  }, [])

  const region = demRegionOf(surfaceName)
  const dem = useDemSurface(region)
  const analytic = useMemo(
    () => resolveSurface(region ? 'Himmelblau' : surfaceName, dataSeed),
    [region, surfaceName, dataSeed],
  )
  const surface: Surface = dem?.surface ?? analytic
  const pending = region !== null && dem === null

  const result = useMemo(() => {
    const factory = makeFactory(algorithm, {
      rate,
      stepDecay: decay,
      maxSteps,
      populationSize: population,
      kappa,
      // Nothing here draws the belief surface — that is the article's Bayesian
      // figure, which has its own scene.
      recordModel: false,
    })
    const seeds = Array.from({ length: runs }, (_, i) => seed + i)
    return runMultistart(surface, factory, { seeds })
  }, [surface, algorithm, seed, runs, maxSteps, rate, decay, population, kappa])

  const view = useMultiRunView(surface, result, { verticalScale: dem?.verticalScale })
  const total = hopDuration(view.path.length, 7)

  // Rewind *and* resume. Runs stop at the end rather than looping, so without
  // the resume, changing a knob after a finished run silently does nothing —
  // which reads as the control being broken rather than the run being over.
  useEffect(() => {
    setFrame(0)
    setPlaying(true)
  }, [surfaceName, algorithm, seed, runs, maxSteps, rate, decay, population, kappa])

  const raf = useRef(0)
  useEffect(() => {
    if (!playing) return
    let last: number | null = null
    const tick = (now: number) => {
      const delta = last === null ? 0 : Math.max(0, (now - last) / (1000 / 60))
      last = now
      setFrame((f) => Math.min(total, f + delta * speed))
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [playing, speed, total])

  // Stop at the end rather than looping. A tool is scrubbed, not watched, and
  // a loop that silently restarts makes the scrubber lie about where you are.
  useEffect(() => {
    if (frame >= total) setPlaying(false)
  }, [frame, total])

  const step = Math.min(view.path.length - 1, Math.floor(frame / 7))

  return (
    <div className="pg">
      <aside className="pg-controls">
        <h1 className="pg-title">Optimization kangaroos</h1>
        <p className="pg-sub">
          Every algorithm in <a href="../">the article</a>, every landscape, every knob.
        </p>

        <Field label="Landscape">
          <select value={surfaceName} onChange={(e) => setSurfaceName(e.target.value)}>
            {[...new Set(SURFACE_OPTIONS.map((o) => o.group))].map((group) => (
              <optgroup key={group} label={group}>
                {SURFACE_OPTIONS.filter((o) => o.group === group).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>

        {surfaceName.startsWith('data:') && (
          <Knob label="Sample" value={dataSeed} min={0} max={40} step={1} onChange={setDataSeed} />
        )}

        <Field label="Algorithm">
          <select value={algorithm} onChange={(e) => chooseAlgorithm(e.target.value as AlgorithmName)}>
            {ALGORITHMS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          <p className="pg-blurb">{spec.blurb}</p>
        </Field>

        <Knob label="Seed" value={seed} min={0} max={999} step={1} onChange={setSeed} />
        <Knob
          label="Kangaroos"
          value={runs}
          min={1}
          max={MAX_RUNS}
          step={1}
          onChange={setRuns}
          note={
            algorithm === 'genetic'
              ? 'Independent runs, each with its own population.'
              : 'Independent runs from different random starts.'
          }
        />
        <Knob label="Steps" value={maxSteps} min={5} max={1200} step={5} onChange={setMaxSteps} />

        {spec.knobs.includes('rate') && (
          <Knob
            label="Learning rate"
            value={rate}
            min={0.0002}
            max={0.08}
            step={0.0002}
            decimals={4}
            onChange={setRate}
          />
        )}
        {spec.knobs.includes('decay') && (
          <Knob
            label="Decay per step"
            value={decay}
            min={0.9}
            max={1}
            step={0.001}
            decimals={3}
            onChange={setDecay}
            note="1 never tires. Below it, she makes smaller and smaller hops."
          />
        )}
        {spec.knobs.includes('population') && (
          <Knob label="Population" value={population} min={4} max={80} step={2} onChange={setPopulation} />
        )}
        {spec.knobs.includes('kappa') && (
          <Knob
            label="Exploration (κ)"
            value={kappa}
            min={0}
            max={4}
            step={0.1}
            decimals={1}
            onChange={setKappa}
            note="0 goes only where she thinks it is high. High goes where she has no idea."
          />
        )}

        <fieldset className="pg-toggles">
          <legend>View</legend>
          <Toggle label="Rejected probes" on={showProbes} onChange={setShowProbes} />
          <Toggle label="Gradient arrows" on={showGradients} onChange={setShowGradients} />
          <Toggle label="Fog of war" on={fog} onChange={setFog} />
          <Toggle label="Contours" on={contours > 0} onChange={(on) => setContours(on ? 22 : 0)} />
        </fieldset>
      </aside>

      <main className="pg-stage">
        <div className="pg-scene">
          {pending ? (
            <div className="scene-loading" style={{ height: '100%' }}>
              <span>Loading terrain…</span>
            </div>
          ) : (
            <Canvas shadows dpr={[1, 2]} camera={{ fov: 42 }}>
              <SearchScene
                surface={surface}
                view={view}
                frame={frame}
                framesPerStep={7}
                contours={contours}
                showGradients={showGradients}
                showProbes={showProbes}
                populationStyle={algorithm === 'genetic' ? 'generations' : 'hop'}
                hop={algorithm === 'bayesian' ? FLAT_ARC : undefined}
                // Even flattened, cross-map arcs stand well clear of the
                // ground they annotate, and the framing only knows about the
                // ground.
                camera={algorithm === 'bayesian' ? { headroom: 1.6 } : undefined}
                fog={
                  fog
                    ? {
                        radius:
                          Math.min(
                            surface.domain.xMax - surface.domain.xMin,
                            surface.domain.yMax - surface.domain.yMin,
                          ) * 0.06,
                        mode: 'trail',
                      }
                    : undefined
                }
              />
            </Canvas>
          )}
        </div>

        <div className="pg-transport">
          <button type="button" onClick={() => setPlaying((p) => !p)} className="pg-play">
            {playing ? 'Pause' : frame >= total ? 'Replay' : 'Play'}
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(1, total)}
            value={frame}
            aria-label="Step"
            onChange={(e) => {
              setPlaying(false)
              setFrame(Number(e.target.value))
            }}
          />
          <span className="pg-readout">
            step {step} / {Math.max(0, view.path.length - 1)}
          </span>
          <label className="pg-speed">
            speed
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {[0.25, 0.5, 1, 2, 4].map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              setFrame(0)
              setPlaying(true)
            }}
          >
            Restart
          </button>
        </div>

        <div className="pg-chart">
          <BestSoFar runs={result} surface={surface} step={step} />
        </div>
      </main>
    </div>
  )
}

// ── the chart ──────────────────────────────────────────────────────────────

/**
 * Best altitude found so far, per run, revealed up to the playhead.
 *
 * The one plot worth having next to the scene, because it answers the question
 * the scene cannot: not "where is she" but "is this working". A run that has
 * been visibly busy for two hundred steps and whose line has been flat for a
 * hundred and eighty of them is the article's whole argument about hill
 * climbing, stated as a number.
 */
function BestSoFar({
  runs,
  surface,
  step,
}: {
  runs: readonly (readonly OptimizerState[])[]
  surface: Surface
  step: number
}) {
  const distinct = runs.length <= CKAgentSeries.length
  const target = surface.globalOptimum?.height

  const series = useMemo(
    () =>
      runs.map((states) => {
        let best = -Infinity
        return states.map((s) => {
          best = Math.max(best, s.best.value)
          return best
        })
      }),
    [runs],
  )

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, plot: { width: number; height: number }) => {
      const left = 58
      const right = 12
      const top = 14
      const bottom = 30
      const w = plot.width - left - right
      const h = plot.height - top - bottom
      if (w <= 0 || h <= 0) return

      const longest = Math.max(1, ...series.map((s) => s.length))
      let lo = Infinity
      let hi = -Infinity
      for (const s of series) {
        for (const v of s) {
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
      }
      if (target !== undefined) hi = Math.max(hi, target)
      if (!(hi > lo)) hi = lo + 1
      const pad = (hi - lo) * 0.08
      const x = linearScale({ min: 0, max: longest - 1 }, { min: left, max: left + w })
      const y = linearScale({ min: lo - pad, max: hi + pad }, { min: top + h, max: top })

      ctx.font = `10.5px ${CANVAS_MONO}`
      ctx.textBaseline = 'middle'
      for (let g = 0; g <= 3; g++) {
        const v = lo - pad + ((hi - lo + pad * 2) * g) / 3
        const py = Math.round(y(v)) + 0.5
        ctx.strokeStyle = CKColor.border
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(left, py)
        ctx.lineTo(left + w, py)
        ctx.stroke()
        ctx.fillStyle = CKColor.textMuted
        ctx.textAlign = 'right'
        ctx.fillText(v.toFixed(1), left - 8, py)
      }

      // The summit, when the surface knows where it is. Without it a flat line
      // reads as converged when it may be stuck a long way down.
      if (target !== undefined) {
        const py = Math.round(y(target)) + 0.5
        ctx.strokeStyle = CKColor.amber
        ctx.setLineDash([4, 4])
        ctx.beginPath()
        ctx.moveTo(left, py)
        ctx.lineTo(left + w, py)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = CKColor.amber
        ctx.textAlign = 'left'
        ctx.fillText('summit', left + 6, py - 9)
      }

      series.forEach((s, i) => {
        const upto = s.slice(0, Math.min(s.length, step + 1))
        if (upto.length < 2) return
        ctx.strokeStyle = distinct ? agentSeries(i) : CKMarker.fill
        ctx.globalAlpha = distinct ? 1 : 0.5
        ctx.lineWidth = 2
        ctx.beginPath()
        upto.forEach((v, k) => (k ? ctx.lineTo(x(k), y(v)) : ctx.moveTo(x(k), y(v))))
        ctx.stroke()
        ctx.globalAlpha = 1
      })

      ctx.fillStyle = CKColor.textMuted
      ctx.textAlign = 'center'
      for (const k of [0, (longest - 1) / 2, longest - 1]) {
        ctx.fillText(String(Math.round(k)), x(k), top + h + 14)
      }
    },
    [series, distinct, step, target],
  )

  return (
    <ChartFrame
      height={200}
      draw={draw}
      title="Best altitude found so far"
      description={
        `Best-so-far altitude for ${runs.length} run${runs.length === 1 ? '' : 's'}, ` +
        `up to step ${step}.` +
        (target === undefined ? '' : ` The summit is at ${target.toFixed(1)}.`)
      }
    />
  )
}

// ── control primitives ─────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="pg-field">
      <span className="pg-label">{label}</span>
      {children}
    </label>
  )
}

/**
 * A slider and a readout, not a text box.
 *
 * Everything here is being explored rather than entered: nobody knows in
 * advance that they want a learning rate of 0.0064, they want to drag until
 * the kangaroo stops falling off the mountain. The number is shown because
 * once you have found it you want to know what it was.
 */
function Knob({
  label,
  value,
  min,
  max,
  step,
  decimals = 0,
  onChange,
  note,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  decimals?: number
  onChange: (v: number) => void
  note?: string
}) {
  return (
    <div className="pg-field">
      <span className="pg-label">
        {label} <b>{value.toFixed(decimals)}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {note && <p className="pg-blurb">{note}</p>}
    </div>
  )
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string
  on: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <label className="pg-toggle">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}
