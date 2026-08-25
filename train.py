"""
train.py — Training entrypoint for the DQN traffic signal controller.

This script will:
1. Load configuration from config.yaml (or CLI overrides).
2. Construct the TrafficSignalEnv (SUMO Gym-style wrapper).
3. Construct the DQNAgent.
4. Run the episode training loop.
5. Save model checkpoints and training logs.

NOT YET IMPLEMENTED — this is a placeholder establishing the entry
point structure. See Tasks.md task #10 for implementation plan.
"""

import sys


def main():
    print("train.py: Training entrypoint placeholder.")
    print("Status: NOT IMPLEMENTED")
    print()
    print("This script will eventually:")
    print("  1. Load config.yaml")
    print("  2. Initialize the SUMO TrafficSignalEnv")
    print("  3. Initialize the DQN agent")
    print("  4. Run the training episode loop")
    print("  5. Save model checkpoints to agent/models/")
    print()
    print("Required components (not yet built):")
    print("  - env/traffic_env.py (TrafficSignalEnv)")
    print("  - env/reward.py (RewardCalculator)")
    print("  - agent/dqn.py (QNetwork, ReplayBuffer, DQNAgent)")
    print("  - network/*.net.xml, *.rou.xml, *.sumocfg (SUMO assets)")
    print("  - config.yaml (hyperparameters — placeholder exists)")
    sys.exit(0)


if __name__ == "__main__":
    main()
