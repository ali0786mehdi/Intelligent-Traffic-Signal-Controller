"""
evaluate.py — Phase 6 evaluation harness.

Runs Fixed-time (static), Actuated, and the trained DQN on identical demand
scenarios across multiple random seeds, aggregates mean ± std, writes a
comparison CSV, and renders report-ready bar charts.

Metrics per run: avg waiting time, avg queue length, throughput (veh/hr),
and (nice-to-have, non-blocking) CO2 / fuel via TraCI emission models.

Usage (inside the container):
    python3 evaluate.py --scenarios balanced asymmetric surge --seeds 1 2 3 --max-sim-time 1200
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
matplotlib.use("Agg")  # headless
import matplotlib.pyplot as plt

from agent.dqn import DQNAgent
from baselines.metrics import run_baseline, INCOMING_LANES, TLS_ID, _import_traci
from env.traffic_env import TrafficSignalEnv, STATE_DIM

RESULTS_CSV = "results/logs/evaluation_results.csv"
PLOTS_DIR = "results/plots"


# --------------------------------------------------------------------------- #
# DQN evaluation (greedy policy through the env, same metrics as baselines)
# --------------------------------------------------------------------------- #
def run_dqn_full(scenario: str, cfg: dict, checkpoint: str,
                 max_sim_time: float, seed: int) -> Dict[str, float]:
    """
    Run the DQN through the env AND collect throughput + emissions in the same
    loop via the env's live TraCI connection, so all controllers use one
    identical metric pipeline.
    """
    sumocfg = cfg["env"]["sumocfg_scenarios"][scenario]
    env_cfg = {
        "min_green": cfg["env"]["min_green"],
        "yellow_time": cfg["env"]["yellow_time"],
        "all_red_time": cfg["env"]["all_red_time"],
        "decision_interval": cfg["env"]["decision_interval"],
        "max_sim_time": max_sim_time,
        "reward": cfg["reward"],
    }
    env = TrafficSignalEnv(sumocfg, config=env_cfg)
    agent = DQNAgent(state_dim=STATE_DIM, action_dim=2,
                     hidden_sizes=tuple(cfg["agent"]["hidden_sizes"]), seed=seed)
    agent.load(checkpoint)
    agent.epsilon = 0.0

    state, _ = env.reset(seed=seed)
    conn = env._traci.getConnection(env._label)

    wait_samples, queue_samples = [], []
    co2_total = 0.0
    fuel_total = 0.0
    emissions_ok = True
    done = False
    info = {}

    # We step the env (which advances SUMO) and read emissions from the
    # same connection between decisions. Arrivals are accumulated inside the
    # env across every simulation sub-step (fixes throughput under-counting).
    while not done:
        action = agent.act(state, greedy=True)
        state, _, terminated, truncated, info = env.step(action)
        done = terminated or truncated
        wait_samples.append(info["total_wait"])
        queue_samples.append(info["total_queue"])
        try:
            if emissions_ok:
                co2_total += sum(conn.lane.getCO2Emission(l) for l in INCOMING_LANES)
                fuel_total += sum(conn.lane.getFuelConsumption(l) for l in INCOMING_LANES)
        except Exception:  # noqa: BLE001 — connection may close at episode end
            emissions_ok = False

    sim_time = info["sim_time"]
    arrived = info.get("arrived", 0)
    env.close()

    throughput = (arrived / sim_time * 3600.0) if sim_time > 0 else 0.0
    return {
        "avg_wait": round(float(np.mean(wait_samples)) if wait_samples else 0.0, 3),
        "avg_queue": round(float(np.mean(queue_samples)) if queue_samples else 0.0, 3),
        "throughput_per_hour": round(throughput, 1),
        "vehicles_arrived": arrived,
        "sim_time": round(sim_time, 1),
        "co2_mg": round(co2_total, 1) if emissions_ok else None,
        "fuel_mg": round(fuel_total, 1) if emissions_ok else None,
    }


# --------------------------------------------------------------------------- #
# Aggregation + reporting
# --------------------------------------------------------------------------- #
def aggregate(values: List[float]) -> tuple[float, float]:
    mean = statistics.mean(values) if values else 0.0
    std = statistics.pstdev(values) if len(values) > 1 else 0.0
    return round(mean, 2), round(std, 2)


def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 6 evaluation harness.")
    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("--scenarios", nargs="+",
                        default=["balanced", "asymmetric", "surge"])
    parser.add_argument("--seeds", type=int, nargs="+", default=[1, 2, 3])
    parser.add_argument("--max-sim-time", type=float, default=1200.0)
    args = parser.parse_args()

    with open(args.config) as fh:
        cfg = yaml.safe_load(fh)

    os.makedirs("results/logs", exist_ok=True)
    os.makedirs(PLOTS_DIR, exist_ok=True)

    raw_rows = []       # per-run
    agg: Dict[tuple, Dict[str, tuple]] = {}   # (scenario, controller) -> metric -> (mean,std)

    for scenario in args.scenarios:
        sumocfg = cfg["env"]["sumocfg_scenarios"][scenario]
        checkpoint = f"agent/models/dqn_{scenario}.pt"

        per_ctrl = {
            "static": {"avg_wait": [], "avg_queue": [], "throughput_per_hour": [], "co2_mg": []},
            "actuated": {"avg_wait": [], "avg_queue": [], "throughput_per_hour": [], "co2_mg": []},
            "dqn": {"avg_wait": [], "avg_queue": [], "throughput_per_hour": [], "co2_mg": []},
        }

        for seed in args.seeds:
            # Baselines
            for ctrl, program in (("static", "static"), ("actuated", "actuated")):
                r = run_baseline(sumocfg, program=program,
                                 max_sim_time=args.max_sim_time, seed=seed)
                r.update({"scenario": scenario, "controller": ctrl, "seed": seed})
                raw_rows.append(r)
                for m in per_ctrl[ctrl]:
                    if r.get(m) is not None:
                        per_ctrl[ctrl][m].append(r[m])
                print(f"[{scenario:11s}|{ctrl:8s}|seed {seed}] "
                      f"wait={r['avg_wait']:.1f} queue={r['avg_queue']:.2f} "
                      f"thru={r['throughput_per_hour']:.0f}")

            # DQN
            if os.path.exists(checkpoint):
                r = run_dqn_full(scenario, cfg, checkpoint,
                                 max_sim_time=args.max_sim_time, seed=seed)
                r.update({"scenario": scenario, "controller": "dqn",
                          "seed": seed, "program": "dqn"})
                raw_rows.append(r)
                for m in per_ctrl["dqn"]:
                    if r.get(m) is not None:
                        per_ctrl["dqn"][m].append(r[m])
                print(f"[{scenario:11s}|{'dqn':8s}|seed {seed}] "
                      f"wait={r['avg_wait']:.1f} queue={r['avg_queue']:.2f} "
                      f"thru={r['throughput_per_hour']:.0f}")
            else:
                print(f"[WARN] missing checkpoint {checkpoint}; skipping DQN.")

        for ctrl in per_ctrl:
            agg[(scenario, ctrl)] = {
                m: aggregate(per_ctrl[ctrl][m]) for m in per_ctrl[ctrl]
            }

    # ---- Write raw per-run CSV ----
    raw_fields = ["scenario", "controller", "seed", "avg_wait", "avg_queue",
                  "throughput_per_hour", "vehicles_arrived", "co2_mg", "fuel_mg", "sim_time"]
    with open(RESULTS_CSV, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=raw_fields, extrasaction="ignore")
        w.writeheader()
        for row in raw_rows:
            w.writerow(row)
    print(f"\nSaved per-run results -> {RESULTS_CSV}")

    # ---- Comparison table (mean ± std) + % improvement vs static ----
    print("\n" + "=" * 78)
    print("  COMPARISON TABLE (mean +/- std across seeds)")
    print("=" * 78)
    for scenario in args.scenarios:
        print(f"\nScenario: {scenario}")
        print(f"  {'controller':10s} {'avg_wait(s)':>16s} {'avg_queue':>14s} "
              f"{'throughput/hr':>16s}")
        static_wait = agg[(scenario, 'static')]['avg_wait'][0]
        for ctrl in ("static", "actuated", "dqn"):
            wm, ws = agg[(scenario, ctrl)]["avg_wait"]
            qm, qs = agg[(scenario, ctrl)]["avg_queue"]
            tm, ts = agg[(scenario, ctrl)]["throughput_per_hour"]
            imp = ((static_wait - wm) / static_wait * 100.0) if static_wait else 0.0
            imp_str = f"  ({imp:+.1f}% vs static)" if ctrl != "static" else ""
            print(f"  {ctrl:10s} {wm:8.2f} +/- {ws:5.2f} {qm:7.2f} +/- {qs:4.2f} "
                  f"{tm:9.1f} +/- {ts:4.1f}{imp_str}")

    # ---- Bar charts ----
    _plot_metric(agg, args.scenarios, "avg_wait", "Average waiting time (s)",
                 os.path.join(PLOTS_DIR, "compare_avg_wait.png"))
    _plot_metric(agg, args.scenarios, "avg_queue", "Average queue length (veh)",
                 os.path.join(PLOTS_DIR, "compare_avg_queue.png"))
    _plot_metric(agg, args.scenarios, "throughput_per_hour", "Throughput (veh/hr)",
                 os.path.join(PLOTS_DIR, "compare_throughput.png"))
    _plot_training_curves(args.scenarios, os.path.join(PLOTS_DIR, "training_curves.png"))

    print(f"\nSaved charts -> {PLOTS_DIR}/")
    print("EVALUATE_OK")
    return 0


def _plot_metric(agg, scenarios, metric, ylabel, out_path) -> None:
    controllers = ["static", "actuated", "dqn"]
    colors = {"static": "#d62728", "actuated": "#ff7f0e", "dqn": "#2ca02c"}
    x = np.arange(len(scenarios))
    width = 0.25

    fig, ax = plt.subplots(figsize=(8, 5))
    for i, ctrl in enumerate(controllers):
        means = [agg[(s, ctrl)][metric][0] for s in scenarios]
        stds = [agg[(s, ctrl)][metric][1] for s in scenarios]
        ax.bar(x + (i - 1) * width, means, width, yerr=stds, capsize=4,
               label=ctrl, color=colors[ctrl])
    ax.set_xticks(x)
    ax.set_xticklabels(scenarios)
    ax.set_ylabel(ylabel)
    ax.set_title(f"{ylabel}: Static vs Actuated vs DQN")
    ax.legend()
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)


def _plot_training_curves(scenarios, out_path) -> None:
    fig, ax = plt.subplots(figsize=(8, 5))
    for scenario in scenarios:
        path = f"results/logs/training_{scenario}.csv"
        if not os.path.exists(path):
            continue
        eps, rewards = [], []
        with open(path) as fh:
            for row in csv.DictReader(fh):
                eps.append(int(row["episode"]))
                rewards.append(float(row["total_reward"]))
        ax.plot(eps, rewards, label=scenario, alpha=0.85)
    ax.set_xlabel("Episode")
    ax.set_ylabel("Total reward")
    ax.set_title("DQN training reward curves")
    ax.legend()
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(out_path, dpi=120)
    plt.close(fig)


if __name__ == "__main__":
    raise SystemExit(main())
