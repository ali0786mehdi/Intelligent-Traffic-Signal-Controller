"""
evaluate.py — Evaluation harness for comparing signal controllers.

This script will:
1. Load configuration from config.yaml (or CLI overrides).
2. Run each controller (static, actuated, DQN) across all demand
   scenarios and random seeds.
3. Collect per-run metrics (waiting time, queue length, throughput,
   travel time, optional emissions).
4. Aggregate results (mean ± std) and export to results/logs/metrics.csv.
5. Generate comparison plots to results/plots/.

NOT YET IMPLEMENTED — this is a placeholder establishing the entry
point structure. See Tasks.md task #12 for implementation plan.
"""

import sys


def main():
    print("evaluate.py: Evaluation harness placeholder.")
    print("Status: NOT IMPLEMENTED")
    print()
    print("This script will eventually:")
    print("  1. Load config.yaml")
    print("  2. Run {static, actuated, DQN} x {balanced, asymmetric, surge} x {seeds}")
    print("  3. Collect metrics per run")
    print("  4. Aggregate mean +/- std per (controller, scenario)")
    print("  5. Export results/logs/metrics.csv")
    print("  6. Generate comparison bar charts and training reward curve")
    print()
    print("Required components (not yet built):")
    print("  - env/traffic_env.py (TrafficSignalEnv)")
    print("  - agent/dqn.py (trained DQNAgent + checkpoint)")
    print("  - baselines/static_controller.py")
    print("  - baselines/actuated_controller.py")
    print("  - network/*.net.xml, *.rou.xml, *.sumocfg (SUMO assets)")
    print("  - config.yaml (hyperparameters — placeholder exists)")
    sys.exit(0)


if __name__ == "__main__":
    main()
