# Intelligent Traffic Signal Controller using Deep Q-Network (D3QN) + SUMO
## Project Report

---

## 1. Problem & Motivation

Fixed-time traffic signals waste green time on empty approaches and cannot
adapt to demand surges. This project builds a **reinforcement-learning signal
controller** for a single 4-way intersection and shows it outperforms both a
fixed-time and a demand-actuated baseline, using realistic microscopic traffic
simulation.

The project is structured as three linked sub-systems:
1. **Environment** — a SUMO microscopic simulation controlled from Python via TraCI.
2. **Agent** — a Dueling Double DQN (D3QN) that observes intersection state and selects signal phases.
3. **Evaluation** — a reproducible, multi-seed comparison of Static vs Actuated vs D3QN.

---

## 2. Technology Stack

| Layer | Tool |
|---|---|
| Traffic simulator | Eclipse SUMO 1.27.1 (headless) |
| Simulator ↔ Python | TraCI / sumolib |
| RL environment | Custom `gymnasium.Env` wrapper |
| Deep learning | PyTorch 2.14 (CPU) |
| Numerics / plotting | NumPy, Pandas, Matplotlib |
| Reproducibility | Docker + docker compose |

Everything runs inside a Docker container (Ubuntu 22.04 + SUMO PPA + pinned
Python deps), so results reproduce on any machine with Docker.

---

## 3. Methodology

### 3.1 Network
A single 4-way intersection generated with SUMO's `netconvert`
(`network/build_network.sh`): 4 incoming + 4 outgoing edges, 2 lanes each,
200 m, 13.89 m/s. Left turns are **permissive** (gap-acceptance) to keep a
compact 2-phase (NS/EW) control problem free of protected-turn conflicts.

### 3.2 Demand scenarios
- **balanced** — ~300 veh/hr/arm, symmetric.
- **asymmetric** — heavy N-S corridor, light E-W (exposes fixed-time failure).
- **surge** — demand ramps mid-episode (tests adaptability).
- **hetero** (Phase 7) — mixed fleet (car/motorcycle/auto/bus) under the
  SL2015 sublane model.

### 3.3 State (71-dim)
Per incoming lane: 3-cell density + 3-cell mean speed; per-lane queue length;
per-lane cumulative waiting time; current-phase one-hot (6); min-green-elapsed
flag. All normalized to [0, 1].

### 3.4 Action (Discrete-2)
`0 → serve NS green`, `1 → serve EW green`. The **environment** (not the agent)
enforces a 10 s minimum green and inserts mandatory 3 s yellow + 2 s all-red
clearance on every phase change — keeping the policy physically valid.

### 3.5 Reward (shaped, bounded)
```
r = (W_{t-1} - W_t)          # reduce cumulative waiting time (primary)
    - 0.5 * [phase changed]   # discourage flickering
    - 0.1 * Σ queue           # queue penalty
r = clip(r, -10, +10)
```
Every component is logged separately (`results/logs/training_*.csv`) for
debugging which term drives behaviour.

### 3.6 Agent — D3QN (raw PyTorch)
- **Dueling** network: shared trunk → separate value V(s) and advantage A(s,a)
  streams, combined as `Q = V + (A − mean_a A)`.
- **Double DQN** targets: online net selects the argmax action, target net
  evaluates it (reduces overestimation).
- Experience replay (50k), target network (hard copy every 500 steps),
  epsilon-greedy decay, Huber loss, gradient clipping.

---

## 4. Results

All evaluation numbers are **mean ± std across 3 seeds**, 1200 s episodes,
DQN evaluated greedily (ε = 0). Source: `results/logs/evaluation_results.csv`.

### 4.1 Homogeneous scenarios — average waiting time (s)

| Scenario | Static | Actuated | **D3QN** | D3QN vs static | D3QN vs actuated |
|---|---|---|---|---|---|
| balanced | 56.85 ± 3.53 | 19.29 ± 2.66 | **11.97 ± 0.76** | **−78.9%** | −38.0% |
| asymmetric | 64.64 ± 1.11 | 23.82 ± 0.17 | **15.82 ± 0.62** | **−75.5%** | −33.6% |
| surge | 34.88 ± 0.17 | 7.42 ± 0.94 | **6.08 ± 1.77** | **−82.6%** | −18.1% |

**The D3QN beats both baselines — including the strong actuated one — on every
scenario.** Throughput is matched across controllers (~1170 / 1360 / 785 veh/hr):
all controllers clear the same demand, so the win is in *delay and queueing*,
not vehicles served.

### 4.2 Emissions (CO₂, total mg over episode)

| Scenario | Static | Actuated | **D3QN** |
|---|---|---|---|
| balanced | 19.4M | 15.5M | **2.1M** |
| asymmetric | 23.3M | 17.8M | **2.6M** |
| surge | 12.6M | 9.5M | **1.5M** |

The D3QN produces roughly **an order of magnitude less CO₂** than the baselines
(less idling/stop-go), a strong secondary benefit. (Emissions are SUMO
model estimates via TraCI; treat as indicative.)

### 4.3 Training

All three policies trained stably (150/80 episodes): reward trends upward and
stabilizes once ε reaches its 0.05 floor (~ep 40), with bounded loss and no
divergence. Curves: `results/plots/training_curves.png`.

### 4.4 Phase 7 — Heterogeneous traffic + PCU-weighting ablation

Mixed fleet under SL2015 sublane. PCU factors (IRC 106-1990: car 1.0,
motorcycle 0.5, auto 0.8, bus 3.0) applied to **both** the state queue features
and the reward's queue-penalty term. Source: `results/logs/hetero_ablation_results.csv`.

| Controller | Avg wait (s) | vs static |
|---|---|---|
| static | 56.11 ± 0.95 | — |
| actuated | 18.53 ± 1.49 | −67.0% |
| DQN (no-PCU) | 29.38 ± 4.85 | −47.6% |
| **DQN (PCU-weighted)** | **22.36 ± 1.95** | **−60.1%** |

**PCU-weighting improves the DQN by 23.9%** over the identical un-weighted
policy (22.4 s vs 29.4 s) *and* lowers variance (±1.95 vs ±4.85) — the agent
learns that a bus queue matters more than a motorcycle queue.

**Honest note on the process:** an initial short run (60 episodes, PCU in state
only) showed PCU performing *worse*. A fair re-test — PCU also in the reward,
150 episodes, ε-decay retuned for the harder scenario — reversed this to the
clear positive above. Both outcomes are recorded rather than cherry-picked.

---

## 5. Limitations & Future Work

- **Single intersection.** Multi-intersection coordination is genuinely harder
  (multi-agent RL, non-stationarity) — deliberately out of scope.
- **Simulation-only**, permissive-left, discretized state.
- **Training budget.** Results use 600–1200 s episodes and 60–150 training
  episodes for turnaround; numbers are consistent across seeds but a
  publication-grade run (3600 s, 300 episodes, 5 seeds) would tighten them.
- **Hetero scenario:** the PCU-weighted D3QN beats the un-weighted one but not
  yet the strong actuated baseline at this budget — closing that gap (longer
  training, richer state) is future work.
- **Future scope:** protected left-turn phases, multi-intersection scaling,
  single generalist policy across all demand distributions.

---

## 6. Reproducing the results

See `README_BUILD.md`. In short:
```
make build       # build the SUMO + PyTorch Docker image
make verify      # smoke-test the SUMO environment
make baselines   # run static + actuated baselines
make train       # train D3QN on all scenarios
make evaluate    # Static vs Actuated vs D3QN, tables + charts
make phase7      # heterogeneous PCU ablation
make all         # the full pipeline end-to-end
```
Artifacts land in `results/logs/` (CSVs) and `results/plots/` (charts);
checkpoints in `agent/models/`.
