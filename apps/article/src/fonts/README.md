# Fonts

Both faces are self-hosted rather than loaded from Google Fonts, and both are
subset to the glyphs this article sets. Regenerate with:

    node tools/fetch-fonts.mjs

That script is the only thing that should ever write to this directory. It
documents why they are here at all; the short version is that a page whose
typeface depends on a third-party CDN being reachable does not fail loudly when
the CDN is not — it just renders in something else and looks fine.

They live in `src/` rather than `public/` so Vite fingerprints them and rewrites
the URLs against the deployed base path.

| File | Family | Weight | Style |
|---|---|---|---|
| `jetbrains-mono-400.woff2` | JetBrains Mono | 400 | normal |
| `jetbrains-mono-400i.woff2` | JetBrains Mono | 400 | italic |
| `jetbrains-mono-500.woff2` | JetBrains Mono | 500 | normal |
| `jetbrains-mono-700.woff2` | JetBrains Mono | 700 | normal |
| `rajdhani-400.woff2` | Rajdhani | 400 | normal |
| `rajdhani-600.woff2` | Rajdhani | 600 | normal |

## Licences

Both are under the SIL Open Font License 1.1, which permits redistribution of
modified copies — a subset is a modification — provided the licence travels
with them. It is reproduced here for each family.

- **JetBrains Mono** © JetBrains s.r.o. — `OFL-JetBrainsMono.txt`.
  <https://github.com/JetBrains/JetBrainsMono>
- **Rajdhani** © Indian Type Foundry — `OFL-Rajdhani.txt`.
  <https://github.com/google/fonts/tree/main/ofl/rajdhani>

The OFL reserves the right to a Reserved Font Name; neither family declares
one, so the subsets keep the original family names. If that ever changes
upstream, these have to be renamed.
