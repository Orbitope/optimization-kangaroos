import { CKColor } from '@contentkit/tokens'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { CANVAS_MONO } from './draw.js'
import { layout, type Margin, type Plot } from './scale.js'

export interface ChartFrameProps {
  width?: number
  height?: number
  margin?: Margin
  title?: string
  /** Everything the chart draws. Called on every resize and prop change. */
  draw: (ctx: CanvasRenderingContext2D, plot: Plot) => void
  /** Pixel position within the plot, or null when the pointer has left. */
  onHover?: (point: { x: number; y: number } | null, plot: Plot) => void
  /** Rendered above the canvas, positioned by the caller. */
  overlay?: ReactNode
  legend?: readonly { readonly label: string; readonly color: string }[]
  /** Accessible summary. Required — a canvas is otherwise invisible to a reader. */
  description: string
}

/**
 * The shell every chart sits in: sizing, DPI, hover plumbing, legend, and the
 * accessible description.
 *
 * Canvas rather than SVG because several of these redraw per frame when driven
 * by a scrubber or by Remotion, and a few thousand SVG nodes per frame is the
 * one thing that reliably makes a chart page stutter.
 *
 * The canvas is `aria-hidden` and the real content for assistive technology is
 * the `description` plus the legend, which are ordinary DOM.
 */
export function ChartFrame({
  width,
  height = 240,
  margin,
  title,
  draw,
  onHover,
  overlay,
  legend,
  description,
}: ChartFrameProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [measured, setMeasured] = useState(width ?? 0)

  // Fixed width wins; otherwise track the container so the chart reflows.
  useEffect(() => {
    if (width) return
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setMeasured(entry.contentRect.width)
    })
    ro.observe(el)
    setMeasured(el.clientWidth)
    return () => ro.disconnect()
  }, [width])

  const w = width ?? measured

  useEffect(() => {
    const el = canvas.current
    if (!el || w <= 0) return
    // Back the canvas at device resolution and scale the context, or every
    // line is soft on a retina display.
    const dpr = Math.min(3, globalThis.devicePixelRatio || 1)
    el.width = Math.round(w * dpr)
    el.height = Math.round(height * dpr)
    el.style.width = `${w}px`
    el.style.height = `${height}px`

    const ctx = el.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw(ctx, layout(w, height, margin))
  }, [w, height, margin, draw])

  const plot = layout(w, height, margin)

  return (
    <figure className="ck-chart" ref={wrap} style={{ margin: 0 }}>
      {title && <figcaption className="ck-chart-title">{title}</figcaption>}

      <div style={{ position: 'relative' }}>
        <canvas
          ref={canvas}
          aria-hidden="true"
          style={{ display: 'block', cursor: onHover ? 'crosshair' : 'default' }}
          onPointerMove={
            onHover
              ? (e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  onHover({ x: e.clientX - r.left, y: e.clientY - r.top }, plot)
                }
              : undefined
          }
          onPointerLeave={onHover ? () => onHover(null, plot) : undefined}
        />
        {overlay}
      </div>

      {legend && legend.length > 1 && (
        <ul className="ck-chart-legend">
          {legend.map((s) => (
            <li key={s.label}>
              <span
                className="ck-chart-swatch"
                style={{ background: s.color }}
                aria-hidden="true"
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}

      <p className="ck-visually-hidden">{description}</p>
    </figure>
  )
}

/** Tooltip positioned next to the cursor, flipping before it leaves the plot. */
export function ChartTooltip({
  x,
  y,
  plot,
  children,
}: {
  x: number
  y: number
  plot: Plot
  children: ReactNode
}) {
  const flip = x > plot.inner.x + plot.inner.w * 0.6
  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        left: flip ? undefined : x + 14,
        right: flip ? plot.width - x + 14 : undefined,
        top: Math.max(0, y - 12),
        pointerEvents: 'none',
        background: CKColor.raised,
        border: `1px solid ${CKColor.border}`,
        borderRadius: 4,
        padding: '6px 8px',
        font: `11px ${CANVAS_MONO}`,
        color: CKColor.textPrimary,
        whiteSpace: 'nowrap',
        zIndex: 2,
      }}
    >
      {children}
    </div>
  )
}
