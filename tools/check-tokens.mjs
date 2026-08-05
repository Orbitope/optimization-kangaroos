/**
 * Verify the built tokens actually export what this repo imports.
 *
 * Third time this class of failure has cost an hour, so it gets a guard. The
 * symptom is a TS2305 deep inside a package that has nothing to do with the
 * problem — "Module '@contentkit/tokens' has no exported member 'agentSeries'"
 * points at scene/src/SearchScene.tsx, when the actual fault is a sibling
 * checkout that is behind or a dist that did not rebuild. Neither is guessable
 * from the message.
 *
 * Runs after `build:tokens` inside `build:libs`, so by the time it fires the
 * tokens have had their chance.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const contentkit = resolve(here, '..', '..', 'contentkit')
const tokens = resolve(contentkit, 'web~', 'packages', 'tokens')
const declaration = resolve(tokens, 'dist', 'index.d.ts')

/** Everything this repo imports from the tokens that was added after v0.1.0. */
const REQUIRED = ['agentSeries', 'CKAgentSeries', 'chartSeries', 'CKChartSeries', 'sampleElevation']

if (!existsSync(declaration)) {
  console.error(`\n@contentkit/tokens has no build output at ${declaration}\n`)
  process.exit(1)
}

// The barrel re-exports, so check the emitted sources it points at.
const surface = ['index', 'color', 'motion', 'type']
  .map((f) => resolve(tokens, 'dist', `${f}.d.ts`))
  .filter(existsSync)
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')

const missing = REQUIRED.filter((name) => !new RegExp(`\\b${name}\\b`).test(surface))

if (missing.length > 0) {
  let head = 'unknown'
  let branch = 'unknown'
  try {
    const git = (...args) =>
      execFileSync('git', ['-C', tokens, ...args], { encoding: 'utf8' }).trim()
    head = git('log', '--oneline', '-1')
    branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  } catch {
    // Not a git checkout, or no git. The advice below still applies.
  }

  console.error(`
┌─ @contentkit/tokens is out of date ─────────────────────────────────────┐

  Built, but missing: ${missing.join(', ')}

  That sibling checkout is behind this one. It is on:
    branch ${branch}
    ${head}

  Fix it there, not here:

    cd ${contentkit}
    git checkout claude/email-tool-article-video-8bba08
    git pull

  Then re-run whatever you were running. The tokens rebuild automatically.

  (If \`git pull\` says "Already up to date", you are on the wrong branch —
  check the branch name above against the one you expect.)

└─────────────────────────────────────────────────────────────────────────┘
`)
  process.exit(1)
}
