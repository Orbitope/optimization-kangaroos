import mdx from '@astrojs/mdx'
import react from '@astrojs/react'
import { defineConfig } from 'astro/config'

export default defineConfig({
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
