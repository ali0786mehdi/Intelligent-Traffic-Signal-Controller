"""
static_controller.py — Fixed-time baseline.

Runs the intersection under SUMO's fixed-time 'static' TLS program (defined in
network/tls.add.xml): a fixed NS-green / yellow / all-red / EW-green cycle that
never adapts to demand. This is the weak-but-standard baseline every
traffic-RL paper compares against.
"""

from __future__ import annotations

import argparse
import json

from baselines.metrics import run_baseline


def main() -> int:
    parser = argparse.ArgumentParser(description="Fixed-time baseline runner.")
    parser.add_argument("--scenario", default="balanced",
                        choices=["balanced", "asymmetric", "surge"])
    parser.add_argument("--max-sim-time", type=float, default=3600.0)
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()

    sumocfg = f"network/intersection_{args.scenario}.sumocfg"
    result = run_baseline(sumocfg, program="static",
                          max_sim_time=args.max_sim_time, seed=args.seed)
    result["controller"] = "static"
    result["scenario"] = args.scenario
    print(json.dumps(result, indent=2))
    print("STATIC_BASELINE_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
