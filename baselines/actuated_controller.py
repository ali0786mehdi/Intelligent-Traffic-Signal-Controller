"""
actuated_controller.py — Actuated (gap-based) baseline.

Runs the intersection under SUMO's native 'actuated' TLS program (defined in
network/tls.add.xml): green phases extend while vehicles keep arriving within a
time gap, up to a max duration, with a minimum green to prevent starvation.
This is the STRONG, realistic baseline — not a strawman — that the DQN must beat.
"""

from __future__ import annotations

import argparse
import json

from baselines.metrics import run_baseline


def main() -> int:
    parser = argparse.ArgumentParser(description="Actuated baseline runner.")
    parser.add_argument("--scenario", default="balanced",
                        choices=["balanced", "asymmetric", "surge"])
    parser.add_argument("--max-sim-time", type=float, default=3600.0)
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()

    sumocfg = f"network/intersection_{args.scenario}.sumocfg"
    result = run_baseline(sumocfg, program="actuated",
                          max_sim_time=args.max_sim_time, seed=args.seed)
    result["controller"] = "actuated"
    result["scenario"] = args.scenario
    print(json.dumps(result, indent=2))
    print("ACTUATED_BASELINE_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
