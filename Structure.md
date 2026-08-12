# Project Structure

## Directory layout
```
traffic-rl-project/
├── .kiro/
│   ├── specs/traffic-signal-dqn/   # requirements.md, design.md, tasks.md
│   └── steering/                    # product.md, tech.md, structure.md (this set)
│
├── network/
│   ├── intersection.net.xml
│   ├── intersection_balanced.rou.xml
│   ├── intersection_asymmetric.rou.xml
│   ├── intersection_surge.rou.xml
│   ├── intersection_balanced.sumocfg
│   ├── intersection_asymmetric.sumocfg
│   ├── intersection_surge.sumocfg
│   └── tls.add.xml
│
├── env/
│   ├── traffic_env.py       # TrafficSignalEnv (Gym-style wrapper)
│   └── reward.py             # RewardCalculator
│
├── agent/
│   ├── dqn.py                # QNetwork, ReplayBuffer, DQNAgent
│   └── models/                # saved checkpoints (.pt files) — gitignored except a final release checkpoint
│
├── baselines/
│   ├── static_controller.py
│   └── actuated_controller.py
│
├── tests/
│   ├── test_env.py
│   ├── test_reward.py
│   └── test_agent.py
│
├── train.py
├── evaluate.py
├── config.yaml
│
├── results/
│   ├── logs/                  # metrics.csv, training logs
│   └── plots/                 # comparison charts, reward curves
│
├── requirements.txt
└── README.md
```

## Naming conventions
- Route/config files are suffixed by scenario name (`_balanced`, `_asymmetric`, `_surge`) so they're never ambiguous when referenced from `config.yaml`.
- All environment-facing code (anything that imports `traci`) lives under `env/` or `baselines/` — never inside `agent/`, keeping the agent simulator-agnostic.
- Model checkpoints are named `dqn_<scenario>_ep<episode_number>.pt`.

## Where new code goes
- New state features → `env/traffic_env.py` (`_get_state`), update the shape/table in `design.md` when changed.
- New reward terms → `env/reward.py`, never inline in `traffic_env.py`.
- New baseline controllers → new file under `baselines/`, following the same runner pattern as the existing two.
- New evaluation metrics → `evaluate.py`'s metrics collection function, and add the corresponding column to the CSV schema.

## Spec workflow
This project follows Kiro's spec-driven workflow. Before implementing a new capability or materially changing existing behavior:
1. Update `.kiro/specs/traffic-signal-dqn/requirements.md` first (new/changed acceptance criteria).
2. Update `design.md` to reflect the architectural impact.
3. Sync `tasks.md` so every new requirement has at least one corresponding task with a `_Requirements: X.X_` reference.
4. Only then implement.
