import {
  createDemSurface,
  parseDemRaster,
  suggestVerticalScale,
  type Surface,
} from '@kangaroos/core'
import { useEffect, useState } from 'react'

/**
 * Load a baked elevation region and hand it back as an ordinary `Surface`.
 *
 * Every figure already takes a `Surface`, so this is the entire seam between
 * the analytic landscapes and the real one — nothing downstream learns that
 * the ground stopped being an equation.
 *
 * The files come from `tools/bake-dem.mjs` and live in `public/terrain/`.
 * 128 KB each, fetched only when a figure that wants one scrolls into view.
 */

export interface LoadedRegion {
  readonly surface: Surface
  /**
   * Relief exaggeration for this region specifically. Carried alongside
   * rather than baked into the surface because it is a rendering decision,
   * and the optimizers must not see a distorted landscape.
   */
  readonly verticalScale: number
}

const cache = new Map<string, Promise<LoadedRegion>>()

/**
 * `BASE_URL` rather than a leading slash: on a project page the site is served
 * from a subdirectory and `/terrain/…` would resolve against the domain root.
 */
function urlFor(region: string): string {
  return `${import.meta.env.BASE_URL}terrain/${region}.dem`
}

export function loadDemSurface(region: string): Promise<LoadedRegion> {
  const hit = cache.get(region)
  if (hit) return hit

  const pending = fetch(urlFor(region))
    .then(async (res) => {
      if (!res.ok) throw new Error(`terrain/${region}.dem: HTTP ${res.status}`)
      const raster = parseDemRaster(await res.arrayBuffer(), region)
      return { surface: createDemSurface(raster), verticalScale: suggestVerticalScale(raster) }
    })
    .catch((error) => {
      // Do not cache a failure, or a transient network blip permanently
      // disables the figure for the rest of the session.
      cache.delete(region)
      throw error
    })

  cache.set(region, pending)
  return pending
}

/**
 * The hook form. Returns null until the region has loaded.
 *
 * Takes null to mean "no region wanted", so a figure that only sometimes shows
 * real terrain can still call it unconditionally.
 */
export function useDemSurface(region: string | null): LoadedRegion | null {
  const [surface, setSurface] = useState<LoadedRegion | null>(null)

  useEffect(() => {
    if (!region) {
      setSurface(null)
      return
    }
    let live = true
    loadDemSurface(region).then(
      (s) => live && setSurface(s),
      (error) => {
        // Not a thrown error: a figure that cannot load its terrain should
        // leave a gap in the article, not take the page down with it.
        console.error(error)
      },
    )
    return () => {
      live = false
    }
  }, [region])

  return surface
}
