import {
  SURFACES,
  collect,
  geneticAlgorithm,
  gradientAscent,
  hillClimber,
  mulberry32,
  simulatedAnnealing,
  type OptimizerState,
  type Surface,
} from '@kangaroos/core'
import { SearchScene, useRunView } from '@kangaroos/scene'
import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'

const ALGORITHMS = {
  'hill climber': (s: Surface, seed: number) =>
    collect(hillClimber(s, mulberry32(seed), { recordProposals: true, maxSteps: 200 })),
  'gradient ascent': (s: Surface, seed: number) =>
    collect(gradientAscent(s, mulberry32(seed), { stepDecay: 0.99, maxSteps: 200 })),
  'simulated annealing': (s: Surface, seed: number) =>
    collect(simulatedAnnealing(s, mulberry32(seed), { recordProposals: true, maxSteps: 600 })),
  'genetic algorithm': (s: Surface, seed: number) =>
    collect(geneticAlgorithm(s, mulberry32(seed), { maxSteps: 60, populationSize: 24 })),
} as const

type AlgorithmName = keyof typeof ALGORITHMS

export function App() {
  const [surfaceName, setSurfaceName] = useState('Himmelblau')
  const [algorithm, setAlgorithm] = useState<AlgorithmName>('hill climber')
  const [seed, setSeed] = useState(1)
  const [playing, setPlaying] = useState(true)
  const [framesPerStep, setFramesPerStep] = useState(8)
  const [showGradients, setShowGradients] = useState(false)
  const [showProbes, setShowProbes] = useState(true)
  const [wireframe, setWireframe] = useState(false)
  const [frame, setFrame] = useState(0)

  const surface = useMemo(
    () => SURFACES.find((s) => s.name === surfaceName) ?? SURFACES[0]!,
    [surfaceName],
  )
  const states: OptimizerState[] = useMemo(
    () => ALGORITHMS[algorithm](surface, seed),
    [algorithm, surface, seed],
  )
  const view = useRunView(surface, states)

  useEffect(() => setFrame(0), [states])

  // A plain rAF loop here; Remotion supplies the frame number instead.
  const raf = useRef(0)
  useEffect(() => {
    if (!playing) return
    // Seeded from the first callback, not from performance.now() here: rAF is
    // handed the timestamp of the *frame start*, which can predate the moment
    // this effect ran, making the first delta negative and the playhead jump
    // backwards off the start of the run.
    let last: number | null = null
    const tick = (now: number) => {
      const delta = last === null ? 0 : Math.max(0, (now - last) / (1000 / 60))
      last = now
      setFrame((f) => f + delta)
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [playing])

  const total = Math.max(1, (states.length - 1) * framesPerStep)
  const step = Math.max(0, Math.min(states.length - 1, Math.floor(frame / framesPerStep)))
  const current = states[step]!

  return (
    <div className="app">
      <aside className="panel">
        <h1>Scene workbench</h1>

        <label>
          Surface
          <select value={surfaceName} onChange={(e) => setSurfaceName(e.target.value)}>
            {SURFACES.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
        </label>

        <label>
          Algorithm
          <select
            value={algorithm}
            onChange={(e) => setAlgorithm(e.target.value as AlgorithmName)}
          >
            {Object.keys(ALGORITHMS).map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>

        <label>
          Seed <span className="value">{seed}</span>
          <input
            type="range"
            min={0}
            max={40}
            value={seed}
            onChange={(e) => setSeed(Number(e.target.value))}
          />
        </label>

        <label>
          Frames per hop <span className="value">{framesPerStep}</span>
          <input
            type="range"
            min={2}
            max={30}
            value={framesPerStep}
            onChange={(e) => setFramesPerStep(Number(e.target.value))}
          />
        </label>

        <label>
          Playhead <span className="value">{step} / {states.length - 1}</span>
          <input
            type="range"
            min={0}
            max={total}
            value={Math.min(frame, total)}
            onChange={(e) => {
              setPlaying(false)
              setFrame(Number(e.target.value))
            }}
          />
        </label>

        <div className="row">
          <button onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play'}</button>
          <button
            onClick={() => {
              setFrame(0)
              setPlaying(true)
            }}
          >
            Restart
          </button>
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={showGradients}
            onChange={(e) => setShowGradients(e.target.checked)}
          />
          Gradient arrows
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={showProbes}
            onChange={(e) => setShowProbes(e.target.checked)}
          />
          Rejected probes
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={wireframe}
            onChange={(e) => setWireframe(e.target.checked)}
          />
          Wireframe
        </label>

        <dl className="readout">
          <dt>altitude</dt>
          <dd>{current.value.toFixed(3)}</dd>
          <dt>best</dt>
          <dd>{current.best.value.toFixed(3)}</dd>
          <dt>status</dt>
          <dd>{current.termination ?? 'searching'}</dd>
          {Object.entries(current.meta).map(([k, v]) => (
            <div key={k} className="contents">
              <dt>{k}</dt>
              <dd>{Number.isInteger(v) ? v : v.toFixed(4)}</dd>
            </div>
          ))}
        </dl>
      </aside>

      <main className="stage">
        <Canvas shadows camera={{ position: [1.8, 1.5, 1.8], fov: 42 }}>
          <SearchScene
            surface={surface}
            view={view}
            frame={frame}
            framesPerStep={framesPerStep}
            showGradients={showGradients}
            showProbes={showProbes}
            wireframe={wireframe}
          />
        </Canvas>
      </main>
    </div>
  )
}
