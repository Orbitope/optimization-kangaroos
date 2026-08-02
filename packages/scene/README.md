# @kangaroos/scene

React Three Fiber components for the 3D search view: terrain, hopping
kangaroos, arc trails, and gradient arrows.

Every component takes a **frame number** rather than driving its own clock, so
the same tree serves a browser animation loop and a Remotion render without
either knowing about the other.

## Workbench

```bash
npm run dev       # http://127.0.0.1:5173
npm run capture   # screenshots each algorithm for review
```

## The kangaroo model

There is no model in the repo yet, so the components fall back to a crude
placeholder built from primitives — correctly proportioned, facing +Z, feet at
y = 0. Supply a real one by wrapping the scene:

```tsx
<KangarooModel url="/kangaroo.glb">
  <SearchScene … />
</KangarooModel>
```

A provider rather than a per-component `url` prop, because `useGLTF` suspends
and calling it conditionally would break the rules of hooks.

The model is expected to be a **static mesh with no rig**, which is the good
case: the entire animation is a matrix transform, so the population renders as
one `InstancedMesh` and the hop derives from the actual step vector instead of
replaying a fixed cycle.

## Layers

| Component | What it draws |
|---|---|
| `Terrain` | Displaced grid, coloured by the ContentKit elevation ramp, normals from the analytic gradients |
| `Kangaroo` / `KangarooCrowd` | One hopper, or a whole population in a single draw call |
| `HopTrail` | The arcs left behind, revealed by one shader uniform |
| `RejectedProbes` | Ghost lines to candidates the optimizer turned down |
| `GradientField` / `LocalGradientArrow` | Uphill arrows, shown only where the algorithm can actually see them |
| `SearchScene` | All of the above, plus lighting and orbit controls |

Geometry construction lives in `src/geometry.ts` and is free of Three.js, so
the arithmetic is tested in Node without a WebGL context.
