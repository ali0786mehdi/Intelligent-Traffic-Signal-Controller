"""
train.py — D3QN training entrypoint for the traffic-signal controller.

Wires together:
  * config.yaml loading (with CLI overrides)
  * TrafficSignalEnv (SUMO Gymnasium wrapper)
  * DQNAgent (Dueling + Double DQN)
  * the episode training loop with per-component reward logging
  * periodic checkpointing + crash-safe final save
  * training-curve CSV output for plotting (Phase 4 DoD)

Usage (inside the container):
    python3 train.py --scenario balanced --episodes 60
"""

from __future__ import annotations

import argparse
import csv
import os
import random
import time

import numpy as np
import yaml

from agent.dqn import DQNAgent
from env.traffic_env import TrafficSignalEnv, STATE_DIM


def load_config(path: str) -> dict:
    with open(path) as fh:
        return yaml.safe_load(fh)


def build_env(cfg: dict, scenario: str) -> TrafficSignalEnv:
    sumocfg = cfg["env"]["sumocfg_scenarios"][scenario]
    env_cfg = {
        "min_green": cfg["env"]["min_green"],
        "yellow_time": cfg["env"]["yellow_time"],
        "all_red_time": cfg["env"]["all_red_time"],
        "decision_interval": cfg["env"]["decision_interval"],
        "max_sim_time": cfg["env"].get("max_sim_time", 3600.0),
        "reward": cfg["reward"],
    }
    return TrafficSignalEnv(sumocfg, config=env_cfg)


def build_agent(cfg: dict, seed: int | None) -> DQNAgent:
    a = cfg["agent"]
    return DQNAgent(
        state_dim=STATE_DIM,
        action_dim=2,
        hidden_sizes=tuple(a["hidden_sizes"]),
        learning_rate=a["learning_rate"],
        gamma=a["gamma"],
        epsilon_start=a["epsilon_start"],
        epsilon_end=a["epsilon_end"],
        epsilon_decay_steps=a["epsilon_decay_steps"],
        replay_capacity=a["replay_capacity"],
        batch_size=a["batch_size"],
        target_update_freq=a["target_update_freq"],
        tau=a.get("tau", 0.0),
        double_dqn=a.get("double_dqn", True),
        seed=seed,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="D3QN training.")
    parser.add_argument("--config", default="config.yaml")
    parser.add_argument("--scenario", default="balanced",
                        choices=["balanced", "asymmetric", "surge"])
    parser.add_argument("--episodes", type=int, default=None,
                        help="override training.num_episodes")
    parser.add_argument("--max-sim-time", type=float, default=None,
                        help="override env max_sim_time (shorter = faster episodes)")
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()

    cfg = load_config(args.config)
    if args.max_sim_time is not None:
        cfg["env"]["max_sim_time"] = args.max_sim_time

    # Seed handling: auto-generate + log if none provided (reproducibility).
    seed = args.seed if args.seed is not None else cfg["training"].get("seed")
    if seed is None:
        seed = random.randint(0, 2**31 - 1)
    print(f"[train] seed={seed}")
    random.seed(seed)
    np.random.seed(seed)

    num_episodes = args.episodes or cfg["training"]["num_episodes"]

    env = build_env(cfg, args.scenario)
    agent = build_agent(cfg, seed)

    os.makedirs("results/logs", exist_ok=True)
    os.makedirs("agent/models", exist_ok=True)
    curve_path = f"results/logs/training_{args.scenario}.csv"
    ckpt_path = f"agent/models/dqn_{args.scenario}.pt"

    print(f"[train] scenario={args.scenario} episodes={num_episodes} "
          f"state_dim={STATE_DIM} device={agent.device}")

    fields = ["episode", "total_reward", "avg_wait", "avg_queue",
              "epsilon", "steps", "r_wait", "r_switch", "r_queue", "loss"]
    curve_rows = []
    t0 = time.time()

    try:
        for ep in range(1, num_episodes + 1):
            state, _ = env.reset(seed=seed + ep)
            done = False
            ep_reward = 0.0
            ep_steps = 0
            wait_samples, queue_samples = [], []
            comp_sums = {"waiting_time_delta": 0.0, "switch_penalty": 0.0, "queue_penalty": 0.0}
            losses = []

            while not done:
                action = agent.act(state)
                next_state, reward, terminated, truncated, info = env.step(action)
                done = terminated or truncated
                agent.remember(state, action, reward, next_state, float(done))
                loss = agent.replay_update()
                if loss is not None:
                    losses.append(loss)

                state = next_state
                ep_reward += reward
                ep_steps += 1
                wait_samples.append(info["total_wait"])
                queue_samples.append(info["total_queue"])
                for k in comp_sums:
                    comp_sums[k] += info["reward_components"][k]

            avg_wait = float(np.mean(wait_samples)) if wait_samples else 0.0
            avg_queue = float(np.mean(queue_samples)) if queue_samples else 0.0
            avg_loss = float(np.mean(losses)) if losses else 0.0

            curve_rows.append({
                "episode": ep,
                "total_reward": round(ep_reward, 2),
                "avg_wait": round(avg_wait, 2),
                "avg_queue": round(avg_queue, 3),
                "epsilon": round(agent.epsilon, 3),
                "steps": ep_steps,
                "r_wait": round(comp_sums["waiting_time_delta"], 2),
                "r_switch": round(comp_sums["switch_penalty"], 2),
                "r_queue": round(comp_sums["queue_penalty"], 2),
                "loss": round(avg_loss, 4),
            })

            print(f"  ep {ep:3d}/{num_episodes} | R={ep_reward:8.1f} | "
                  f"avg_wait={avg_wait:7.1f} | avg_q={avg_queue:5.2f} | "
                  f"eps={agent.epsilon:.3f} | loss={avg_loss:.4f} | steps={ep_steps}")

            if ep % 10 == 0:
                agent.save(ckpt_path)
    finally:
        agent.save(ckpt_path)
        with open(curve_path, "w", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=fields)
            writer.writeheader()
            writer.writerows(curve_rows)
        env.close()

    print(f"[train] done in {time.time() - t0:.1f}s")
    print(f"[train] checkpoint -> {ckpt_path}")
    print(f"[train] training curve -> {curve_path}")
    print("TRAIN_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
