import mdx from '@astrojs/mdx'
import react from '@astrojs/react'
import { defineConfig } from 'astro/config'

/*
 * Where the built site will live.
 *
 * Both come from the environment because the answer is a deployment decision,
 * not a source one: on a GitHub project page the site is served from a
 * subdirectory and every absolute URL in the build has to be prefixed, and the
 * same source has to work when it moves to a different owner or a custom
 * domain. `npm run build:pages` sets them; a bare `astro dev` gets the root, so
 * local URLs stay short.
 *
 * The subdirectory case is not theoretical here — the fonts and the baked
 * terrain are both fetched relative to `BASE_URL`, and a hardcoded `/fonts/…`
 * would resolve against the domain root and 404. `npm run preview:pages`
 * builds with the production base and serves it, which is the cheapest way to
 * catch that before it ships.
 */
const base = process.env.ARTICLE_BASE || '/'
const site = process.env.ARTICLE_SITE || undefined

export default defineConfig({
  base,
  site,
  integrations: [react(), mdx()],
  // Static output. The whole point of the article is that prose costs no
  // JavaScript; only the figures hydrate, and only when they scroll into view.
  output: 'static',
  vite: {
    // Workspace deps are symlinks. Pre-bundling them serves a stale copy after
    // a rebuild of the core, which is a confusing way to lose an afternoon.
    optimizeDeps: {
      exclude: ['@kangaroos/core', '@kangaroos/scene', '@kangaroos/charts', '@contentkit/tokens'],
    },
  },
})
