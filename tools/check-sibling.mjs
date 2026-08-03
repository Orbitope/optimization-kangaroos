/**
 * Preinstall guard for the sibling-checkout layout.
 *
 * `@contentkit/tokens` is consumed by relative path from the contentkit repo
 * rather than from a registry. That is a deliberate choice — the two projects
 * are developed together and publishing a package for an audience of one is
 * overhead — but it means npm needs both repos checked out side by side:
 *
 *   parent/
 *     contentkit/
 *     optimization-kangaroos/
 *
 * Without this guard npm fails with a bare ENOENT on a path several levels up,
 * which tells you nothing. Fail early and say what to do instead.
 */
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const tokens = resolve(repoRoot, '..', 'contentkit', 'web~', 'packages', 'tokens')

if (!existsSync(join(tokens, 'package.json'))) {
  console.error(`
┌─ optimization-kangaroos ────────────────────────────────────────────┐

  Cannot find @contentkit/tokens.

  Expected it at:
    ${tokens}

  This repo consumes the ContentKit design tokens by relative path, so
  the two checkouts have to be siblings:

    parent/
      contentkit/                 <-- git clone .../Orbitope/contentkit
      optimization-kangaroos/     <-- you are here

  From the directory above this one:

    git clone https://github.com/Orbitope/contentkit.git
    cd contentkit/web~/packages/tokens && npm install

└─────────────────────────────────────────────────────────────────────┘
`)
  process.exit(1)
}

// Checked out but never installed. Building it is our job — `build:libs` runs
// its build before anything that imports it — but we cannot run tsc there
// without its devDependencies, and npm will not install them for us: a `file:`
// dependency on a directory is symlinked, not built, so no lifecycle script of
// ours ever fires inside that checkout.
if (!existsSync(join(tokens, 'node_modules'))) {
  console.error(`
@contentkit/tokens is checked out but its dependencies are not installed.

  cd ${tokens}
  npm install

(No need to build it — \`npm run build:libs\` does that, and re-does it every
time, so a pull in the contentkit repo cannot leave you on stale tokens.)
`)
  process.exit(1)
}
