/**
 * Fetch, subset, and self-host the two Orbitope faces.
 *
 * The site loads JetBrains Mono and Rajdhani from Google Fonts. This article
 * does not, for three reasons — one of which is not a preference:
 *
 *   1. A blocked or slow fonts.googleapis.com does not degrade the page, it
 *      changes what typeface it is set in. That was not a hypothetical here:
 *      the host is unreachable from the build container, so every screenshot
 *      taken while developing the type rendered system fallbacks and looked
 *      convincingly fine. Self-hosting makes the page's appearance a property
 *      of the repository rather than of the network.
 *   2. Two render-blocking round trips to a third party, on a page whose whole
 *      pitch is that it still works in a decade.
 *   3. Subsetting. Rajdhani ships Devanagari — 390 KB of TTF, of which this
 *      article uses the Latin alphabet and a handful of punctuation.
 *
 * Run when the faces need refreshing; the output is committed, because CI
 * should not need network access to build a page.
 *
 *   node tools/fetch-fonts.mjs
 *
 * Requires `pyftsubset` (pip install "fonttools[woff]"). It is not a project
 * dependency: this runs by hand, rarely, and the artefacts are in git.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT = new URL('../apps/article/src/fonts/', import.meta.url).pathname

/**
 * Both projects are OFL and both are on GitHub, which matters because Google
 * Fonts' own CDN is exactly the dependency being removed — fetching the files
 * from there to avoid depending on it would be circular.
 *
 * JetBrains ship built woff2 in the repository, so those are copied straight
 * through. Google's font repository holds sources only, so Rajdhani is a TTF
 * that has to be converted.
 */
const FACES = [
  // family, weight, style, source URL
  ['JetBrains Mono', 400, 'normal', jb('Regular')],
  ['JetBrains Mono', 400, 'italic', jb('Italic')],
  ['JetBrains Mono', 500, 'normal', jb('Medium')],
  ['JetBrains Mono', 700, 'normal', jb('Bold')],
  // Rajdhani is display-only here: headings at 600, and the canvas figures'
  // panel labels at 400. Nothing else in the page asks for it.
  ['Rajdhani', 400, 'normal', gf('Rajdhani-Regular.ttf')],
  ['Rajdhani', 600, 'normal', gf('Rajdhani-SemiBold.ttf')],
]

function jb(style) {
  return `https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/fonts/webfonts/JetBrainsMono-${style}.woff2`
}
function gf(file) {
  return `https://raw.githubusercontent.com/google/fonts/main/ofl/rajdhani/${file}`
}

/**
 * The subset.
 *
 * Latin-1 plus the typographic marks the prose actually contains — em and en
 * dashes, curly quotes, the ellipsis, and the arrows and Greek used in the
 * figure labels (κ for the exploration dial, ε for the success threshold, α
 * for the crossover blend). Deliberately not `--unicodes=*`: the point of
 * subsetting is that a face carrying Devanagari costs six times what this page
 * needs.
 *
 * A glyph the article uses but this list omits does not error — it silently
 * falls back to the next family in the stack, which is a system monospace and
 * looks close enough to miss. So if a character turns up in the prose that is
 * not in here, add it.
 */
const UNICODES = [
  'U+0000-00FF', // Latin-1
  'U+0131', // dotless i
  'U+0152-0153', // OE ligatures
  'U+02BB-02BC,U+02C6,U+02DA,U+02DC', // modifier letters
  'U+0391-03C9', // Greek — kappa, epsilon, alpha, sigma, mu in figure labels
  'U+2013-2014', // en dash, em dash
  'U+2018-201A,U+201C-201E', // curly quotes
  'U+2020-2022,U+2026,U+2030', // dagger, bullet, ellipsis, per mille
  'U+2039-203A,U+2044', // guillemets, fraction slash
  'U+2190-2193', // arrows
  'U+2212', // minus (distinct from hyphen in the numeric readouts)
  'U+2264-2265', // ≤ ≥
  'U+00D7', // × — the bowling-ball multiplication
  'U+2205,U+221A,U+2211,U+222B', // maths in the Bayesian section
].join(',')

mkdirSync(OUT, { recursive: true })

for (const [family, weight, style, url] of FACES) {
  const slug = `${family.toLowerCase().replace(/ /g, '-')}-${weight}${style === 'italic' ? 'i' : ''}`
  const dest = join(OUT, `${slug}.woff2`)

  process.stdout.write(`${slug.padEnd(24)} `)

  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  const source = Buffer.from(await res.arrayBuffer())

  const tmp = join(OUT, `.${slug}.src`)
  writeFileSync(tmp, source)

  // `--flavor=woff2` re-compresses the already-woff2 JetBrains files too. That
  // is not wasted work: the point is to strip the glyphs, and a woff2 in has
  // to come back out as a woff2 either way.
  execFileSync('pyftsubset', [
    tmp,
    `--output-file=${dest}`,
    `--unicodes=${UNICODES}`,
    '--flavor=woff2',
    '--layout-features=kern,liga,calt',
    // Keep hinting off: these render through the browser's own rasteriser on
    // every platform that matters, and the instructions are dead weight.
    '--no-hinting',
    '--desubroutinize',
  ])

  execFileSync('rm', ['-f', tmp])
  const before = source.length
  const after = statSync(dest).size
  console.log(`${kb(before)} → ${kb(after)}  (${Math.round((1 - after / before) * 100)}% smaller)`)
}

const total = readdirSync(OUT)
  .filter((f) => f.endsWith('.woff2'))
  .reduce((n, f) => n + statSync(join(OUT, f)).size, 0)
console.log(`\n${readdirSync(OUT).length} faces, ${kb(total)} total`)

function kb(n) {
  return `${(n / 1024).toFixed(1)} KB`
}
