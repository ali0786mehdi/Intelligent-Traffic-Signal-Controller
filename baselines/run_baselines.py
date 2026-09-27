"""
run_baselines.py — Collect baseline results across all scenarios and both
controllers, save to results/logs/baseline_results.csv.

Phase 3 Definition of Done: baseline numbers for fixed-time (static) and
actuated controllers on all demand scenarios, saved to a results file.
"""

from __future__ import annotations

import argparse
import csv
import os

from baselines.metrics import run_baseline

SCENARIOS = ["balanced", "asymmetric", "surge"]
CONTROLLERS = {"static": "static", "actuated": "actuated"}
OUT_CSV = "results/logs/baseline_results.csv"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run all baseline configs.")
    parser.add_argument("--max-sim-time", type=float, default=3600.0)
    parser.add_argument("--seeds", type=int, nargs="+", default=[1, 2, 3])
    args = parser.parse_args()

    os.makedirs(os.path.dirname(OUT_CSV), exist_ok=True)
    rows = []

    for scenario in SCENARIOS:
        sumocfg = f"network/intersection_{scenario}.sumocfg"
        for ctrl_name, program in CONTROLLERS.items():
            for seed in args.seeds:
                res = run_baseline(
                    sumocfg, program=program,
                    max_sim_time=args.max_sim_time, seed=seed,
                )
                res.update({"controller": ctrl_name, "scenario": scenario, "seed": seed})
                rows.append(res)
                print(
                    f"[{scenario:11s} | {ctrl_name:8s} | seed {seed}] "
                    f"avg_wait={res['avg_wait']:8.2f}  "
                    f"avg_queue={res['avg_queue']:6.2f}  "
                    f"throughput={res['throughput_per_hour']:7.1f}/hr"
                )

    fieldnames = [
        "scenario", "controller", "seed", "program", "sim_time",
        "avg_wait", "avg_queue", "vehicles_arrived", "throughput_per_hour",
    ]
    with open(OUT_CSV, "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row[k] for k in fieldnames})

    print(f"\nSaved {len(rows)} rows -> {OUT_CSV}")
    print("BASELINE_RESULTS_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
