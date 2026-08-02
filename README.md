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

| Path | What it is |
|---|---|
| `packages/core` | The optimizer kernel — surfaces and algorithms, pure TypeScript, no dependencies |
| `static/kangaroos.txt` | The source thread |
| `todo.todo` | The original 2019 outline |

## Development

```bash
cd packages/core
npm install
npm test
```

## Status

Early. `packages/core` is complete and tested: six benchmark surfaces with
hand-derived analytic gradients, and the four algorithms named in `todo.todo`
(hill climber, gradient ascent, simulated annealing, genetic algorithm),
written as seeded generators.

Still to come: the real-terrain surface backed by baked elevation data, the 2D
and 3D widgets, the article itself, and the video pipeline built on
[ContentKit](https://github.com/Orbitope/contentkit).
