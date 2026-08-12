# Design Document

## Overview

The system is a Reinforcement Learning pipeline built around three layers: a **SUMO-based simulation environment**, a **Gym-style environment wrapper** that exposes a standard `reset()`/`step()` interface over TraCI, and a **DQN agent** that trains against that wrapper. A separate **evaluation harness** runs the trained agent alongside static and actuated baseline controllers on identical scenarios to produce comparison metrics.

The design deliberately keeps the simulation and the learning code decoupled: the environment wrapper is the only component that talks to TraCI, and the agent never calls SUMO directly. This keeps the agent swappable (DQN now, could be PPO/Double DQN later) without touching simulation code, and keeps the environment testable independent of any RL logic.

## Architecture

```
                    ┌─────────────────────────────────────────┐
                    │              train.py / evaluate.py       │
                    │        (entrypoints, config loading)      │
                    └───────────────┬─────────────────────────┘
                                    │
                ┌───────────────────┼───────────────────────┐
                │                   │                         │
        ┌───────▼────────┐ ┌───────▼────────┐      ┌────────▼─────────┐
        │   DQNAgent      │ │ TrafficSignalEnv│      │ Baseline Controllers│
        │  (agent/dqn.py) │ │ (env/traffic_   │      │ (baselines/*.py)   │
        │                 │ │  env.py)         │      │ static / actuated  │
        └───────┬────────┘ └───────┬────────┘      └────────┬─────────┘
                │  act(state)       │  reset()/step(action)          │
                │  remember()        │                                │
                │  replay()          │  ┌───────────────────────┐    │
                └────────────────────┼─▶│      TraCI Client       │◀──┘
                                     │  │  (state read, phase set) │
                                     │  └───────────┬───────────┘
                                     │              │
                                     │  ┌───────────▼───────────┐
                                     └─▶│      SUMO Process       │
                                        │ (network + route files) │
                                        └─────────────────────────┘
```

## Components and Interfaces

### 1. `network/` — Simulation Assets
- `intersection.net.xml` — road network geometry (built via `netedit`/`netgenerate`).
- `intersection_balanced.rou.xml`, `intersection_asymmetric.rou.xml`, `intersection_surge.rou.xml` — one route file per demand scenario (Requirement 1.3).
- `intersection.sumocfg` — per-scenario SUMO config; env wrapper selects which one to load at `reset()` time.
- `tls.add.xml` — traffic light logic definitions used by the static/actuated baselines (SUMO supports `type="static"` and `type="actuated"` natively).

### 2. `env/traffic_env.py` — `TrafficSignalEnv` (Gym-style wrapper)

**Interface:**
```python
class TrafficSignalEnv(gym.Env):
    def __init__(self, sumocfg_path, use_gui=False, min_green=10, yellow_time=3, all_red_time=2, max_episode_steps=3600, reward_config=None, seed=None): ...
    def reset(self) -> np.ndarray: ...
    def step(self, action: int) -> tuple[np.ndarray, float, bool, dict]: ...
    def close(self) -> None: ...
```

**Responsibilities (maps to Requirements 1, 2, 3, 4):**
- Starts/stops the SUMO subprocess via TraCI (`traci.start`, `traci.close`).
- `_get_state()`: builds the discretized cell-based state vector — per-lane vehicle presence/speed grid + queue length + waiting time + one-hot current phase (Req 2). Missing/absent lane data defaults to zero (Req 2.5).
- `_apply_action(action)`: validates the requested phase against the minimum-green constraint (Req 3.4); if a phase change is legal, inserts yellow + all-red clearance phases before applying the new green phase (Req 3.2, 3.3); if the action repeats the current phase, simply extends it (Req 3.5).
- `_compute_reward()`: delegates to `RewardCalculator` (below).
- Internally advances the simulation via `traci.simulationStep()` in a loop covering the action's duration (decision interval, e.g. every 5s) before returning control to the agent.

### 3. `env/reward.py` — `RewardCalculator`
Encapsulates Requirement 4 in one place so reward shaping can be tuned without touching the environment stepping logic.
```python
class RewardCalculator:
    def __init__(self, waiting_time_weight=1.0, switch_penalty=0.5, queue_weight=0.1, clip_range=(-10, 10)): ...
    def compute(self, prev_waiting, curr_waiting, phase_changed: bool, queue_lengths: list[float]) -> tuple[float, dict]: ...
```
Returns both the scalar reward and a dict of the individual components for logging (Req 4.4).

### 4. `agent/dqn.py` — `QNetwork`, `ReplayBuffer`, `DQNAgent`

- `QNetwork(nn.Module)`: 3-layer fully connected network (input = state vector size, hidden layers e.g. 128→128, output = number of discrete actions/phases).
- `ReplayBuffer`: fixed-capacity `deque` storing transitions; `sample(batch_size)` returns a random minibatch (Req 5.3, 5.4).
- `DQNAgent`:
  - `act(state, epsilon)` → epsilon-greedy action selection (Req 5.2).
  - `remember(transition)` → pushes to replay buffer.
  - `replay(batch_size)` → samples a minibatch, computes target using the target network, backprops on the online network (Req 5.4).
  - `update_target_network()` → hard or soft (Polyak) sync (Req 5.5).
  - `save(path)` / `load(path)` → checkpointing (Req 5.7).

### 5. `baselines/` — Conventional Controllers (Requirement 6)
- `static_controller.py`: thin wrapper that loads the network with a `type="static"` TLS program and simply steps SUMO forward — no TraCI phase intervention needed since SUMO drives the fixed cycle natively.
- `actuated_controller.py`: same pattern using `type="actuated"` TLS program (SUMO's built-in gap-based logic). No custom RL-style stepping loop is required for either baseline; they exist mainly as evaluation targets run through the same metrics collection code as the DQN agent.

### 6. `evaluate.py` — Evaluation Harness (Requirement 7)
- Iterates over: `{controllers: [static, actuated, dqn]} × {scenarios: [balanced, asymmetric, surge]} × {seeds: [s1, s2, s3]}`.
- For each run, collects: avg waiting time, avg queue length, throughput, avg travel time, and (if available) emissions via `traci.vehicle.getCO2Emission()` (Req 7.4).
- Aggregates mean ± std per (controller, scenario) pair (Req 7.2).
- Writes raw results to `results/logs/metrics.csv` (Req 7.5) and generates comparison bar charts + the DQN training reward curve to `results/plots/` (Req 7.3).

### 7. `train.py` — Training Entrypoint (Requirement 5, 8)
- Loads a config (YAML or CLI args) covering hyperparameters (Req 8.1).
- Sets and logs the random seed across SUMO, NumPy/PyTorch, and the replay buffer (Req 8.2, 8.3).
- Runs the episode loop: `reset()` → loop `act()`/`step()`/`remember()`/`replay()` until `done` → log episode summary (Req 5.6) → periodically `update_target_network()` and checkpoint via `save()`.

## Data Models

### State Vector (per decision step)
| Field | Shape | Description |
|---|---|---|
| Cell presence grid | `num_lanes × num_cells` | Binary vehicle presence per discretized cell |
| Cell speed grid | `num_lanes × num_cells` | Normalized vehicle speed per cell |
| Queue length | `num_lanes` | Stopped-vehicle count per lane |
| Waiting time | `num_lanes` | Cumulative waiting time per lane |
| Current phase | `num_phases` (one-hot) | Currently active signal phase |

Flattened into a single 1-D `float32` vector for the `QNetwork` input.

### Action Space
Discrete, `Discrete(num_phases)` — index of the requested next phase (Req 3.1).

### Transition Tuple (Replay Buffer)
`(state: np.ndarray, action: int, reward: float, next_state: np.ndarray, done: bool)`

### Config Schema (`config.yaml`)
```yaml
env:
  sumocfg_scenarios: {balanced: ..., asymmetric: ..., surge: ...}
  min_green: 10
  yellow_time: 3
  all_red_time: 2
  decision_interval: 5
reward:
  waiting_time_weight: 1.0
  switch_penalty: 0.5
  queue_weight: 0.1
  clip_range: [-10, 10]
agent:
  hidden_sizes: [128, 128]
  learning_rate: 0.0005
  gamma: 0.99
  epsilon_start: 1.0
  epsilon_end: 0.05
  epsilon_decay_steps: 20000
  replay_capacity: 50000
  batch_size: 64
  target_update_freq: 500
training:
  num_episodes: 300
  max_steps_per_episode: 720
  seed: null   # auto-generated + logged if null
```

## Error Handling

- **SUMO/TraCI connection failures:** `TrafficSignalEnv.__init__` validates that the `.sumocfg` path and its referenced network/route files exist before calling `traci.start`; raises a descriptive `FileNotFoundError` rather than letting TraCI fail with an opaque connection error (Req 1.4).
- **Missing lane data:** `_get_state()` wraps each TraCI query in a guard that substitutes `0.0` on `KeyError`/empty result (Req 2.5).
- **Illegal action during minimum-green window:** `_apply_action()` does not raise; it silently extends the current phase and logs a debug note, keeping the training loop uninterrupted (Req 3.4).
- **Training crash mid-run:** `DQNAgent.save()` is called on a fixed episode interval (not only at the end) so a crash doesn't lose all progress; `train.py` wraps the episode loop in a try/finally that guarantees a final checkpoint attempt.
- **Evaluation reproducibility:** every run's resolved seed (explicit or auto-generated) is written into the results CSV alongside its metrics row, so any result can be traced back to an exact run configuration (Req 8.3).

## Testing Strategy

- **Environment unit tests:** verify `reset()` returns a correctly shaped state vector; verify `step()` enforces minimum green time; verify yellow/all-red clearance is inserted on phase change; verify reward clipping bounds are respected.
- **Reward unit tests:** feed `RewardCalculator.compute()` known synthetic waiting-time deltas and assert expected scalar + component breakdown.
- **Agent unit tests:** verify replay buffer sampling shapes, verify target network weights only change on the configured update frequency, verify epsilon decays monotonically toward `epsilon_end`.
- **Integration smoke test:** run 2–3 short episodes (few hundred steps) end-to-end on the balanced scenario and assert no exceptions and a non-empty checkpoint file is produced — this is the fast CI-style check before a full multi-hundred-episode training run.
- **Evaluation sanity check:** run all three controllers for one short scenario/seed and assert the metrics CSV has one row per controller with all required columns populated.
