"""Cross-validate our Gaussian process against scikit-learn and scipy.

Run `node dump-gp.mjs` first; this reads the JSON it writes and re-derives every
number with an implementation that shares no code with ours.

Three separate checks, deliberately not one:

  1. The kernel, on its own, against sklearn's Matern(nu=2.5). If this fails,
     nothing downstream is worth reading.
  2. The posterior mean and standard deviation against GaussianProcessRegressor
     with the hyperparameters pinned — no marginal-likelihood optimisation, so
     both sides are solving the same stated problem.
  3. Expected Improvement against numerical integration of its definition,
     E[max(0, Y - best - xi)] for Y ~ N(mean, sd), rather than against another
     closed form. A closed form checked against the same closed form proves
     only that it was typed twice.
"""

import json
import pathlib
import sys

import numpy as np
from scipy import integrate, stats
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import ConstantKernel, Matern

HERE = pathlib.Path(__file__).parent
data = json.loads((HERE / "gp-fixture.json").read_text())

failures = []
worst = {"kernel": 0.0, "mean": 0.0, "sd": 0.0, "ei": 0.0}


def note(kind, delta, context):
    worst[kind] = max(worst[kind], delta)
    if not np.isfinite(delta) or delta > TOL[kind]:
        failures.append(f"{kind}: |Δ|={delta:.3e} in {context}")


# Absolute tolerances. The solve is O(n^3) in float64 on matrices that are
# deliberately near-singular in the clustered cases, so a few ulps of drift
# between two different factorisation orders is expected; 1e-6 is far tighter
# than anything that would change a pixel.
TOL = {"kernel": 1e-12, "mean": 1e-6, "sd": 1e-6, "ei": 1e-6}

# ── 1. the kernel ──────────────────────────────────────────────────────────

for s in data["kernelSamples"]:
    k = ConstantKernel(s["variance"], constant_value_bounds="fixed") * Matern(
        length_scale=s["lengthScale"], nu=2.5, length_scale_bounds="fixed"
    )
    ref = k(np.array([[0.0]]), np.array([[s["r"]]]))[0, 0]
    note("kernel", abs(ref - s["k"]), f"r={s['r']:.3f}")

# ── 2. the posterior ───────────────────────────────────────────────────────

for case in data["cases"]:
    opts = case["options"]
    X = np.array([[o["position"]["x"], o["position"]["y"]] for o in case["observations"]])
    y = np.array([o["value"] for o in case["observations"]])
    Q = np.array([[p["x"], p["y"]] for p in case["query"]])

    # Our prior mean is the mean of the observations, so centre y and add it
    # back — this is what sklearn's normalize_y does, minus the scaling by
    # standard deviation that newer versions also apply.
    prior = y.mean()

    kernel = ConstantKernel(opts["variance"], constant_value_bounds="fixed") * Matern(
        length_scale=opts["lengthScale"], nu=2.5, length_scale_bounds="fixed"
    )
    gpr = GaussianProcessRegressor(
        kernel=kernel,
        alpha=opts["noise"],
        optimizer=None,          # hyperparameters are given, not learned
        normalize_y=False,
    ).fit(X, y - prior)

    ref_mean, ref_sd = gpr.predict(Q, return_std=True)
    ref_mean = ref_mean + prior

    for i, pred in enumerate(case["predictions"]):
        note("mean", abs(ref_mean[i] - pred["mean"]), f"{case['label']} q{i}")
        note("sd", abs(ref_sd[i] - pred["sd"]), f"{case['label']} q{i}")

    # ── 3. expected improvement, by quadrature ─────────────────────────────

    best = case["best"]
    xi = 0.01
    for i, ours in enumerate(case["ei"]):
        mu, sd = ref_mean[i], ref_sd[i]
        if sd < 1e-12:
            ref_ei = 0.0
        else:
            # E[max(0, Y - best - xi)] integrated directly against the normal
            # density, from the threshold out to well beyond it.
            lo = best + xi
            hi = mu + 12 * sd
            if hi <= lo:
                ref_ei = 0.0
            else:
                ref_ei, _ = integrate.quad(
                    lambda t: (t - lo) * stats.norm.pdf(t, mu, sd),
                    lo,
                    hi,
                    limit=400,
                )
        note("ei", abs(ref_ei - ours), f"{case['label']} q{i}")

# ── report ─────────────────────────────────────────────────────────────────

print(f"cases:        {len(data['cases'])}")
print(f"query points: {sum(len(c['query']) for c in data['cases'])}")
print()
for kind in ("kernel", "mean", "sd", "ei"):
    status = "PASS" if worst[kind] <= TOL[kind] else "FAIL"
    print(f"  [{status}] {kind:<7} worst |Δ| = {worst[kind]:.3e}   (tolerance {TOL[kind]:.0e})")

if failures:
    print(f"\n{len(failures)} failures, first 10:")
    for f in failures[:10]:
        print(f"  {f}")
    sys.exit(1)

print("\nALL CHECKS PASS — our GP agrees with scikit-learn, and our closed-form")
print("Expected Improvement agrees with numerical integration of its definition.")
