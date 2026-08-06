/**
 * Prechelt's bowling ball, as a diagram rather than a data figure.
 *
 * Everything else in this article is generated from a live optimizer. This one
 * is drawn, because it is explaining a *procedure* with specific numbers in the
 * source — 8 cm north, 14 cm east, learning rate 50, so a 4 m by 7 m jump — and
 * a simulation would either reproduce those numbers by construction, which
 * proves nothing, or contradict them, which would be worse.
 *
 * Plain SVG and no animation. A reader needs to look back and forth between the
 * two trenches and the arithmetic underneath, and anything that moves while they
 * are doing that is working against them.
 */
export interface BowlingBallFigureProps {
  /** Roll distance in the north-south trench, centimetres. */
  north?: number
  /** Roll distance in the east-west trench, centimetres. */
  east?: number
  learningRate?: number
  caption?: string
}

export function BowlingBallFigure({
  north = 8,
  east = 14,
  learningRate = 50,
  caption,
}: BowlingBallFigureProps) {
  // Derived, never hardcoded: the whole point of the panel is that the jump is
  // the roll times the rate, and a typo in one of five literals would quietly
  // break the only arithmetic the article asks a reader to follow.
  const jumpNorth = (north * learningRate) / 100
  const jumpEast = (east * learningRate) / 100

  return (
    <figure className="figure">
      <svg
        viewBox="0 0 900 268"
        className="bowling-diagram"
        role="img"
        aria-label={
          `Two frictionless trenches at the kangaroo's feet, one running north to south and one ` +
          `east to west. A bowling ball dropped into the north-south trench rolls ${north} ` +
          `centimetres north; in the east-west trench it rolls ${east} centimetres east. ` +
          `Multiplied by a learning rate of ${learningRate}, that is a jump of ${jumpNorth} metres ` +
          `north and ${jumpEast} metres east.`
        }
      >
        <BowlingBallDiagram
          north={north}
          east={east}
          learningRate={learningRate}
          jumpNorth={jumpNorth}
          jumpEast={jumpEast}
        />
      </svg>
      {caption && <figcaption className="figure-caption">{caption}</figcaption>}
    </figure>
  )
}

function BowlingBallDiagram({
  north,
  east,
  learningRate,
  jumpNorth,
  jumpEast,
}: {
  north: number
  east: number
  learningRate: number
  jumpNorth: number
  jumpEast: number
}) {
  // Trench lengths scaled so the two roll distances are visually comparable —
  // 8 against 14 has to *look* like 8 against 14 or the multiplication that
  // follows has nothing to stand on.
  const unit = 5.2
  return (
    <>
      {/* ── panel 1: the north-south trench ─────────────────────────────── */}
      <g transform="translate(20 26)">
        <Panel label="1. Dig north–south" />
        <Ground />
        {/* The trench, in section: a V cut into the ground, plated smooth. */}
        <path d="M 40 128 L 125 140 L 210 108" className="trench" />
        <path d="M 40 128 L 125 140 L 210 108" className="trench-plate" />
        <Ball cx={125 + 4} cy={130} ghost />
        <Ball cx={125 - north * unit * 0.55} cy={130 + north * unit * 0.16} />
        <Roll from={125} to={125 - north * unit} y={176} label={`${north} cm north`} />
        <text x="125" y="212" className="axis-note" textAnchor="middle">
          it rolls downhill — gently, so not far
        </text>
      </g>

      {/* ── panel 2: the east-west trench ───────────────────────────────── */}
      <g transform="translate(320 26)">
        <Panel label="2. Dig east–west" />
        <Ground steep />
        <path d="M 40 60 L 125 132 L 210 150" className="trench" />
        <path d="M 40 60 L 125 132 L 210 150" className="trench-plate" />
        <Ball cx={125 - 4} cy={122} ghost />
        <Ball cx={125 + east * unit * 0.55} cy={122 + east * unit * 0.24} />
        <Roll from={125} to={125 + east * unit} y={176} label={`${east} cm east`} />
        <text x="125" y="212" className="axis-note" textAnchor="middle">
          steeper this way, so it rolls further
        </text>
      </g>

      {/* ── panel 3: the multiplication ─────────────────────────────────── */}
      <g transform="translate(620 26)">
        <Panel label="3. Multiply, and jump" />
        <g transform="translate(0 26)">
          <Sum a={`${north} cm`} rate={learningRate} out={`${jumpNorth} m`} y={40} tone="north" />
          <Sum a={`${east} cm`} rate={learningRate} out={`${jumpEast} m`} y={86} tone="east" />
        </g>
        {/* A little plan view of where that lands her. */}
        <g transform="translate(28 140)">
          <line x1="0" y1="70" x2="0" y2="0" className="plan-axis" />
          <line x1="0" y1="70" x2="150" y2="70" className="plan-axis" />
          <text x="-6" y="6" className="axis-note" textAnchor="end">
            N
          </text>
          <text x="152" y="74" className="axis-note">
            E
          </text>
          <circle cx="0" cy="70" r="4" className="here" />
          <line
            x1="0"
            y1="70"
            x2={jumpEast * 9}
            y2={70 - jumpNorth * 9}
            className="jump"
            markerEnd="url(#jump-head)"
          />
          <text x={jumpEast * 9 + 8} y={70 - jumpNorth * 9} className="jump-label">
            {jumpNorth} m N, {jumpEast} m E
          </text>
        </g>
      </g>

      <defs>
        <marker id="jump-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ck-coral)" />
        </marker>
        <marker id="roll-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ck-text-bright)" />
        </marker>
      </defs>
    </>
  )
}

function Panel({ label }: { label: string }) {
  return (
    <text x="0" y="0" className="panel-label">
      {label}
    </text>
  )
}

/**
 * The hillside in section, so the trench is visibly cut *into* something.
 *
 * The two panels get different profiles, because the whole point of the second
 * one is that the ground falls away more steeply east than it does north — and
 * drawing the identical slope twice while the caption says otherwise asks the
 * reader to take the difference on trust.
 */
function Ground({ steep }: { steep?: boolean }) {
  return (
    <path
      d={
        steep
          ? 'M 0 34 C 45 60, 90 86, 125 96 C 155 104, 190 118, 250 128 L 250 230 L 0 230 Z'
          : 'M 0 82 C 45 92, 88 99, 125 96 C 158 94, 190 100, 250 112 L 250 230 L 0 230 Z'
      }
      className="ground"
    />
  )
}

/** `ghost` is where it was dropped; the solid one is where it came to rest. */
function Ball({ cx, cy, ghost }: { cx: number; cy: number; ghost?: boolean }) {
  if (ghost) return <circle cx={cx} cy={cy} r="8" className="ball-ghost" />
  return (
    <>
      <circle cx={cx} cy={cy} r="9" className="ball" />
      <circle cx={cx - 3} cy={cy - 3} r="2" className="ball-hole" />
    </>
  )
}

function Roll({ from, to, y, label }: { from: number; to: number; y: number; label: string }) {
  const mid = (from + to) / 2
  return (
    <g>
      <line x1={from} y1={y - 8} x2={from} y2={y + 8} className="tick" />
      <line x1={from} y1={y} x2={to} y2={y} className="roll" markerEnd="url(#roll-head)" />
      <text x={mid} y={y - 12} className="roll-label" textAnchor="middle">
        {label}
      </text>
    </g>
  )
}

function Sum({
  a,
  rate,
  out,
  y,
  tone,
}: {
  a: string
  rate: number
  out: string
  y: number
  tone: 'north' | 'east'
}) {
  return (
    <g transform={`translate(0 ${y})`}>
      <text x="0" y="0" className={`sum sum-${tone}`}>
        {a}
      </text>
      <text x="62" y="0" className="sum-op">
        × {rate}
      </text>
      <text x="130" y="0" className="sum-op">
        =
      </text>
      <text x="152" y="0" className={`sum sum-${tone}`}>
        {out}
      </text>
    </g>
  )
}
