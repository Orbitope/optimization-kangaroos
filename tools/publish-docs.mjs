/**
 * Copy the built article into `docs/`, which is what GitHub Pages serves.
 *
 *   npm run build:docs        # builds, then runs this
 *
 * Pages' branch-deploy mode serves the repository root or `/docs` and nothing
 * else, so the rendered site is a committed artefact rather than a workflow
 * output. The trade is a large diff whenever the asset hashes change, against
 * not needing Actions to publish at all.
 *
 * A copy step rather than pointing Astro's `outDir` at `docs/`: with an outDir
 * outside the project root, Astro relocates its content-layer cache into it,
 * and `data-store.json` and two `content-*.mjs` files end up committed
 * alongside the site. Setting `cacheDir` does not move all of them. Copying
 * from a clean `dist/` means exactly what was built is what ships.
 */
import { cpSync, existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIST = new URL('../apps/article/dist/', import.meta.url).pathname
const DOCS = new URL('../docs/', import.meta.url).pathname

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('No build in apps/article/dist. Run `npm run build:pages` first.')
  process.exit(1)
}

/*
 * Guard against publishing a root-based build to a project page.
 *
 * `docs/` is served from a subdirectory, and a build made without
 * ARTICLE_BASE resolves every asset against the domain root — which yields a
 * page that is blank apart from the prose, with no obvious cause. Cheap to
 * check, and the failure is expensive to diagnose.
 */
const html = readdirSync(DIST).includes('index.html')
  ? (await import('node:fs')).readFileSync(join(DIST, 'index.html'), 'utf8')
  : ''
if (!html.includes('/optimization-kangaroos/_astro/')) {
  console.error(
    'This build is not base-pathed for a project page.\n' +
      'Use `npm run build:docs`, which sets ARTICLE_BASE.',
  )
  process.exit(1)
}

rmSync(DOCS, { recursive: true, force: true })
cpSync(DIST, DOCS, { recursive: true })

// Belt and braces. Astro copies `public/.nojekyll` already, but if that ever
// moves, Jekyll silently drops every directory beginning with an underscore —
// which is where all the JavaScript lives.
writeFileSync(join(DOCS, '.nojekyll'), '')

let files = 0
let bytes = 0
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else {
      files++
      bytes += statSync(full).size
    }
  }
}
walk(DOCS)
console.log(`docs/  ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`)
