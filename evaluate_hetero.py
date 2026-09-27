"""
evaluate_hetero.py — Phase 7 ablation: does PCU-weighting help on
heterogeneous (mixed-vehicle) traffic?

Compares four controllers on the SL2015 sublane heterogeneous scenario across
multiple seeds (mean +/- std):
    static | actuated | DQN(no-PCU) | DQN(PCU-weighted)

Produces a comparison table, CSV, and a grouped bar chart. The key question is
whether the PCU-weighted policy beats the identical policy trained on raw
vehicle counts (showing the IRC weighting actually matters).
"""

from __future__ import annotations

import argparse
import csv
import os
import statistics
from typing import Dict, List

import numpy as np
import yaml

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from agent.dqn import DQNAgent
from baselines.metrics import run_baseline
from env.traffic_env import TrafficSignalEnv, STATE_DIM

SUMOCFG = "network/intersection_hetero.sumocfg"
RESULTS_CSV = "results/logs/hetero_ablation_results.csv"
CHART = "results/plots/hetero_ablation.png"


def run_dqn(cfg: dict, checkpoint: str, pcu: bool, max_sim_time: float,
            seed: int) -> Dict[str, float]:
    env_cfg = {
        "min_green": cfg["env"]["min_green"],
        "yellow_time": cfg["env"]["yellow_time"],
        "all_red_time": cfg["env"]["all_red_time"],
        "decision_interval": cfg["env"]["decision_interval"],
        "max_sim_time": max_sim_time,
        "pcu_weighting": pcu,
        "reward": cfg["reward"],
    }
    env = TrafficSignalEnv(SUMOCFG, config=env_cfg)
    agent = DQNAgent(state_dim=STATE_DIM, action_dim=2,
                     hidden_sizes=tuple(cfg["agent"]["hidden_sizes"]), seed=seed)
    agent.load(checkpoint)
    agent.epsilon = 0.0

    state, _ = env.reset(seed=seed)
    waits, queues = [], []
    done = False
    info = {}
    while not done:
        action = agent.act(state, greedy=True)
        state, _, terminated, truncated, info = env.step(action)
        done = terminated or truncated
        waits.append(info["total_wait"])
        queues.append(info["total_queue"])
    sim_time = info["sim_time"]
    arrived = info.get("arrived", 0)
    env.close()
    return {
        "avg_wait": round(float(np.mean(waits)) if waits else 0.0, 3),
        "avg_queue": round(float(np.mean(queues)) if queues else 0.0, 3),
        "throughput_per_hour": round(arrived / sim_time * 3600.0, 1) if sim_time else 0.0,
    }


def agg(vals: List[float]) -> tuple[float, float]:
    m = statistics.mean(vals) if vals else 0.0
    s = statistics.pstdev(vals) if len(vals) > 1 else 0.0
    return round(m, 2), round(s, 2)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("--seeds", type=int, nargs="+", default=[1, 2, 3])
    parser.add_argument("--max-sim-time", type=float, default=1200.0)
    args = parser.parse_args()

    with open(args.config) as fh:
        cfg = yaml.safe_load(fh)
    os.makedirs("results/logs", exist_ok=True)
    os.makedirs("results/plots", exist_ok=True)

    controllers = ["static", "actuated", "dqn_nopcu", "dqn_pcu"]
    per = {c: {"avg_wait": [], "avg_queue": [], "throughput_per_hour": []} for c in controllers}
    raw_rows = []

    for seed in args.seeds:
        runs = {
            "static": run_baseline(SUMOCFG, "static", args.max_sim_time, seed),
            "actuated": run_baseline(SUMOCFG, "actuated", args.max_sim_time, seed),
            "dqn_nopcu": run_dqn(cfg, "agent/models/dqn_hetero_nopcu.pt", False,
                                 args.max_sim_time, seed),
            "dqn_pcu": run_dqn(cfg, "agent/models/dqn_hetero_pcu.pt", True,
                               args.max_sim_time, seed),
        }
        for c, r in runs.items():
            for m in per[c]:
                if r.get(m) is not None:
                    per[c][m].append(r[m])
            raw_rows.append({"controller": c, "seed": seed, **r})
            print(f"[hetero|{c:10s}|seed {seed}] wait={r['avg_wait']:.1f} "
                  f"queue={r['avg_queue']:.2f} thru={r['throughput_per_hour']:.0f}")

    with open(RESULTS_CSV, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["controller", "seed", "avg_wait",
                                           "avg_queue", "throughput_per_hour"],
                           extrasaction="ignore")
        w.writeheader()
        w.writerows(raw_rows)

    print("\n" + "=" * 70)
    print("  PHASE 7 ABLATION — heterogeneous traffic (mean +/- std)")
    print("=" * 70)
    static_wait = agg(per["static"]["avg_wait"])[0]
    for c in controllers:
        wm, ws = agg(per[c]["avg_wait"])
        qm, qs = agg(per[c]["avg_queue"])
        imp = ((static_wait - wm) / static_wait * 100.0) if static_wait else 0.0
        tag = f"  ({imp:+.1f}% vs static)" if c != "static" else ""
        print(f"  {c:10s} wait={wm:7.2f}+/-{ws:4.2f}  queue={qm:5.2f}+/-{qs:4.2f}{tag}")

    pcu_wait = agg(per["dqn_pcu"]["avg_wait"])[0]
    nopcu_wait = agg(per["dqn_nopcu"]["avg_wait"])[0]
    if nopcu_wait:
        delta = (nopcu_wait - pcu_wait) / nopcu_wait * 100.0
        print(f"\n  PCU vs no-PCU: PCU-weighted wait is {delta:+.1f}% "
              f"relative to no-PCU ({'better' if delta > 0 else 'worse'})")

    # ---- Bar chart ----
    labels = ["static", "actuated", "DQN\n(no-PCU)", "DQN\n(PCU)"]
    waits = [agg(per[c]["avg_wait"])[0] for c in controllers]
    errs = [agg(per[c]["avg_wait"])[1] for c in controllers]
    colors = ["#d62728", "#ff7f0e", "#1f77b4", "#2ca02c"]
    fig, ax = plt.subplots(figsize=(8, 5))
    ax.bar(labels, waits, yerr=errs, capsize=5, color=colors)
    ax.set_ylabel("Average waiting time (s)")
    ax.set_title("Heterogeneous traffic: PCU-weighting ablation")
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(CHART, dpi=120)
    plt.close(fig)

    print(f"\nSaved -> {RESULTS_CSV} and {CHART}")
    print("HETERO_ABLATION_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
