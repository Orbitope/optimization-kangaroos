import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Mounts its children only while they are near the viewport.
 *
 * Astro's `client:visible` handles the *first* mount, but never unmounts. That
 * is fine for a chart and not fine for a WebGL scene: browsers cap live
 * contexts somewhere around 8–16 and start dropping the oldest without
 * warning, and this article has more 3D figures than that.
 *
 * drei's `<View>` — one shared canvas, many scissored viewports — is the other
 * answer and the better one, but it needs every view inside a single React
 * tree, and Astro islands are separate roots by construction. Unmounting keeps
 * two or three contexts alive at a time, which is comfortably under any cap.
 *
 * The margin is deliberately generous. Unmounting the moment a figure leaves
 * the viewport means a reader scrolling back up watches it rebuild.
 */
export function NearViewport({
  children,
  margin = '150% 0px',
  minHeight,
}: {
  children: ReactNode
  margin?: string
  minHeight: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => setNear(Boolean(entry?.isIntersecting)),
      { rootMargin: margin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [margin])

  // The placeholder reserves the figure's height from first paint. Without it
  // every figure that mounts shoves the paragraph the reader is mid-sentence
  // through down the page.
  return (
    <div ref={ref} style={{ minHeight }}>
      {near ? children : null}
    </div>
  )
}

export function FigureCaption({ children }: { children: ReactNode }) {
  return <figcaption className="figure-caption">{children}</figcaption>
}
