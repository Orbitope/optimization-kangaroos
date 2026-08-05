# Cross-validation against scikit-learn

The Gaussian process in `src/bayesian.ts` is written from scratch, so the unit
tests beside it can only check it against itself. These two files check it
against an implementation that shares no code with ours.

```
node dump-gp.mjs                      # writes gp-fixture.json from our GP
pip install scikit-learn scipy numpy
python3 validate-against-sklearn.py   # re-derives every number independently
```

Three checks, deliberately separate so a disagreement can be localised:

1. **The kernel** against `sklearn.gaussian_process.kernels.Matern(nu=2.5)`.
   If this fails nothing downstream is worth reading.
2. **The posterior** mean and standard deviation against
   `GaussianProcessRegressor` with the hyperparameters pinned (`optimizer=None`),
   so both sides solve the same stated problem rather than each choosing its own.
3. **Expected Improvement** against numerical integration of its definition,
   `E[max(0, Y - best - xi)]` for `Y ~ N(mean, sd)` — *not* against another
   closed form. A closed form checked against the same closed form proves only
   that it was typed twice.

The 18 cases include the configurations where a hand-rolled Cholesky goes wrong:
a single observation, a tight cluster, and near-duplicate points.

Last run: kernel agrees to 4.4e-16, posterior mean to 3.2e-12, posterior sd to
2.8e-12, and Expected Improvement to 3.6e-7 — the last being the accuracy of the
quadrature rather than of the formula.

This is not part of `npm test`. It needs Python and a network install, and the
value is in having run it, not in running it on every commit. Re-run it if the
kernel, the solve, or the acquisition changes.
