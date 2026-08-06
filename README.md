# Optimization Kangaroos

An interactive article, tool, and video about numerical optimization, built on
[*Kangaroos and Training Neural Networks*](static/kangaroos.txt) — the 1993
comp.ai.neural-nets thread that explains optimization by dropping a kangaroo
over Asia and asking it to find Everest.

> Training a NN is a form of numerical optimization, which can be likened to a
> kangaroo searching for the top of Mt. Everest. Everest is the *global
> optimum*, the highest mountain in the world, but the top of any other really
> tall mountain such as K2 (a good *local optimum*) would be satisfactory. On
> the other hand, the top of a small hill like Chapel Hill, NC, (a bad local
> optimum) would not be acceptable.

## Credit

The source text is not mine. It was written by four people on Usenet in
1993–94, and the jokes in it are better than any replacement:

- **Warren S. Sarle** (SAS Institute) — the original post and the taxonomy of
  algorithms, revised Oct 22 1994.
- **Scott E. Fahlman** (Carnegie Mellon) — cascade-correlation as rubber
  mountains, and the excess kangaroos who attack the generals and leave the
  army with poor generalization.
- **Jonathan O'Donnell** (RMIT) — "Presumably, this is why Australia is so flat."
- **Lutz Prechelt** (Karlsruhe) — backprop without calculus: teflon-plated
  ditches, bowling balls, and one world per training example.

Additional description of conjugate gradient methods adapted from Tony Plate
(1993).

## Layout

Two repositories, checked out as siblings. `@contentkit/tokens` is consumed by
relative path rather than from a registry, so the layout is load-bearing —
`tools/check-sibling.mjs` runs on `preinstall` and says so with a readable
message rather than an ENOENT.

```
.
├── contentkit/               # Orbitope/contentkit
└── optimization-kangaroos/   # this repo
```

| Path | What it is |
|---|---|
| `packages/core` | The optimizer kernel — surfaces, algorithms, the hop, the scene transform, the Gaussian process, real elevation. Pure TypeScript, no dependencies. |
| `packages/charts` | The 2D analytics layer. Canvas, frame-driven. |
| `packages/scene` | The 3D search view. Three.js and React Three Fiber. |
| `apps/article` | The article and the tool. Astro with React islands. |
| `docs/` | The rendered site, committed. This is what GitHub Pages serves. |
| `tools/` | Bake the elevation regions, fetch and subset the fonts, publish `docs/`. |
| `static/kangaroos.txt` | The source thread |
| `todo.todo` | The original 2019 outline |

## Development

```bash
npm install          # from this directory; checks the sibling layout first
npm test --workspaces
npm run dev:article  # http://127.0.0.1:4321
```

The article is at `/`, the tool at `/tool/`. Two pages are kept but not built
— drop the leading underscore to look at them, and put it back afterwards:
`_camera-options.astro` renders one run from several camera angles, and
`_terrain-check.astro` renders every baked elevation region at once.

## Publishing

The site is served from `docs/` on the default branch, so the rendered output
is a committed artefact and publishing needs no CI.

```bash
npm run build:docs   # builds with the project-page base path, then copies to docs/
git add docs && git commit
```

`npm run preview:pages` serves the same build locally under its real base path,
which is the cheapest way to catch the one failure mode that matters: the
fonts and the baked terrain are fetched relative to `BASE_URL`, and a build
made without it resolves them against the domain root and 404s. The publish
script refuses to copy a build that was not base-pathed, for the same reason.

Repository settings: **Pages → Source → Deploy from a branch → `main` `/docs`**.

## Real elevation

Six regions plus the whole planet are baked from terrarium terrain-RGB tiles
and committed under `apps/article/public/terrain/`. Regenerate with
`node tools/bake-dem.mjs [region]`; each one is verified at bake time against a
published height, so a wrong region cannot reach the repository.

Everest reads 8,749 m rather than 8,849, and stays short however finely it is
sampled. That is the data, not the pipeline, and the article says so.

## Status

The article is written and the tool is built. `packages/core` carries 174
tests, including a Gaussian process cross-validated against scikit-learn to
machine precision and a set of elevation checks that pin Everest, K2, Chapel
Hill, Kosciuszko and the floor of the Indian Ocean.

The video is not being built. Its groundwork exists anyway as
[`@contentkit/sequence`](https://github.com/Orbitope/contentkit) — the Unity
shot-outline DSL ported to TypeScript, with the C# test suites ported first.

Not built: the kangaroo model. Every figure runs on a placeholder made of six
primitives, and a real GLB drops in through the existing `KangarooModel`
provider with no other change.
