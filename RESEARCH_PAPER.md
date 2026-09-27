# Adaptive Traffic Signal Control at an Isolated Intersection using a Dueling Double Deep Q-Network (D3QN) with PCU-Weighted State Representation for Heterogeneous Traffic

*Author: Ali Mehdi Mirza*
*Affiliation: [Your Department / Institution]*
*Contact: alimehdi1010@gmail.com*

---

## Abstract

Fixed-time and vehicle-actuated traffic signal controllers are the de-facto
standard at urban intersections, yet both degrade under asymmetric and
time-varying demand because their control logic is not learned from traffic
dynamics. This paper presents an adaptive signal controller based on a
**Dueling Double Deep Q-Network (D3QN)** that selects signal phases from a
discretized, normalized state of the intersection and is trained entirely in
the microscopic simulator SUMO through the TraCI interface. We formulate signal
control as a discrete phase-selection Markov Decision Process with a shaped,
bounded reward centred on the reduction of cumulative vehicle waiting time, and
we delegate minimum-green and yellow/all-red clearance enforcement to the
environment to guarantee physically valid, safe signal plans. The controller is
evaluated against fixed-time and actuated baselines on three demand regimes
(balanced, asymmetric, and a mid-episode surge), each replicated across multiple
random seeds and reported as mean ± standard deviation. The D3QN reduces average
vehicle waiting time by **75.5–82.6 % relative to fixed-time control** and by
**18.1–38.0 % relative to a strong actuated baseline**, while matching
throughput and reducing estimated CO₂ emissions by nearly an order of magnitude.
We further address a gap in most single-intersection RL studies—the assumption
of a homogeneous vehicle fleet—by introducing a **Passenger Car Unit (PCU)
weighting** (IRC 106-1990 factors) into both the state and reward, and
evaluating it on a mixed fleet (car, motorcycle, auto-rickshaw, bus) under
SUMO's sub-lane lateral model. An ablation shows PCU weighting lowers waiting
time by **23.9 %** and halves run-to-run variance relative to an identical
unweighted agent, indicating that vehicle-class-aware state representation is
beneficial for heterogeneous traffic. All code, trained models, and experiments
are reproducible via a single containerized command.

**Keywords:** Reinforcement Learning; Deep Q-Network; Dueling Double DQN (D3QN);
Adaptive Traffic Signal Control; SUMO; TraCI; Intelligent Transportation
Systems; Passenger Car Unit (PCU); Heterogeneous Traffic; Queue Length; Vehicle
Waiting Time; Traffic Simulation; Microscopic Simulation; Markov Decision
Process; Experience Replay.

---

## 1. Introduction

Urban road intersections are principal bottlenecks in city traffic networks.
Conventional signal control falls into two families: **fixed-time** control,
which cycles through phases on a pre-computed schedule irrespective of live
demand, and **vehicle-actuated** control, which extends a green phase while
detectors continue to sense arriving vehicles. Both are effective under the
conditions they were tuned for, but neither *learns* from the traffic it
governs, so both lose efficiency when demand is asymmetric across approaches or
changes over time (e.g., rush-hour surges).

Reinforcement learning (RL) offers an alternative: an agent can learn a control
policy directly from interaction with the traffic environment, optimizing a
long-horizon objective such as cumulative delay. Deep Q-Networks (DQN) and their
successors have been applied to signal control in a growing body of work.
However, three practical gaps recur:

1. **Weak or absent baselines.** Many studies compare only against fixed-time
   control (an easy target) and omit the stronger actuated baseline, inflating
   the apparent benefit of RL.
2. **Homogeneous-traffic assumption.** State representations typically count raw
   vehicles, implicitly treating a motorcycle and a bus as equivalent—unrealistic
   for mixed-fleet traffic common in many countries.
3. **Reproducibility.** Single-run results without seed replication or
   containerized environments are difficult to trust or reproduce.

This paper addresses all three. We (i) benchmark against **both** fixed-time and
actuated control; (ii) introduce a **PCU-weighted** state and reward to make the
agent vehicle-class-aware and evaluate it on a heterogeneous fleet; and (iii)
release a fully **containerized, multi-seed** experimental pipeline.

### 1.1 Contributions
- A Dueling Double DQN controller for an isolated 4-way intersection, with the
  environment (not the agent) enforcing minimum-green and mandatory yellow/all-red
  clearance for safety.
- A shaped, bounded reward with per-component logging, enabling transparent
  diagnosis of the agent's behaviour.
- A rigorous, multi-seed evaluation against fixed-time and actuated baselines
  across three demand regimes, reporting waiting time, queue length, throughput,
  and estimated emissions.
- A PCU-weighted state/reward formulation for heterogeneous traffic and an
  ablation demonstrating its benefit.
- A one-command, Docker-based reproducible artifact.

---

## 2. Related Work and Research Gaps

RL-based signal control commonly uses SUMO with TraCI for the environment and a
DQN-family agent. Foundational deep RL techniques relevant here are the DQN with
experience replay and target networks, the Double DQN correction for
Q-value overestimation, and the Dueling architecture that separately estimates
state value and action advantage. Traffic-specific work has explored
cell-based state encodings and delay-based rewards.

**Gaps this project fulfils:**
- *Baseline rigour:* We include SUMO's native actuated controller as a strong
  baseline, not merely fixed-time.
- *Heterogeneity:* Most single-intersection DQN studies assume a homogeneous
  fleet. We incorporate IRC 106-1990 PCU factors into the learned
  representation and quantify the effect—framed as a DQN-specific extension of
  the broader heterogeneous-traffic + RL literature.
- *Reproducibility & statistical reporting:* We report mean ± std over multiple
  seeds and ship a containerized pipeline.

---

## 3. Methodology

### 3.1 Simulation environment
Experiments use **Eclipse SUMO 1.27.1** (headless) controlled from Python via
**TraCI**. The network is a single 4-way intersection generated with SUMO's
`netconvert`: four incoming and four outgoing edges, two lanes each, 200 m
length, 13.89 m/s (50 km/h) free-flow speed. Left turns are modelled as
**permissive** (gap-acceptance), keeping the control problem to a compact
two-phase (North–South / East–West) structure free of protected-turn conflicts.

### 3.2 Demand scenarios
- **Balanced:** ~300 veh/h per approach, symmetric.
- **Asymmetric:** heavy N–S corridor, light E–W (exposes fixed-time inefficiency).
- **Surge:** demand ramps up mid-episode (tests temporal adaptability).
- **Heterogeneous (Phase 2 of study):** mixed fleet under SUMO's **SL2015
  sub-lane model** (lateral resolution 0.8 m).

### 3.3 MDP formulation

**State (71-dimensional, normalized to [0,1]).** For each of the eight incoming
lanes: a 3-cell occupancy (density) vector and a 3-cell mean-speed vector from
the stop line back along the lane; per-lane queue length (halting vehicles);
per-lane cumulative waiting time; a 6-dimensional one-hot of the current signal
phase; and a binary minimum-green-elapsed flag.

*Dimension breakdown:* 8×3 density (24) + 8×3 speed (24) + 8 queue + 8 wait + 6
phase one-hot + 1 min-green flag = **71**.

**Action (discrete, |A| = 2).** `a = 0` requests the N–S green phase; `a = 1`
requests the E–W green phase. Decisions are made every 5 simulated seconds.

**Safety wrapper.** The environment enforces a **10 s minimum green** and inserts
a mandatory **3 s yellow + 2 s all-red** clearance whenever the served axis
changes. This guarantees physically valid signal plans regardless of the agent's
output.

**Reward (shaped, bounded).**
```
r_t = (W_{t-1} - W_t)                # primary: reduction in cumulative waiting time
      - 0.5 * 1[a_t ≠ a_{t-1}]       # switching penalty (anti-flicker)
      - 0.1 * Σ_l q_{l,t}            # queue-length penalty
r_t = clip(r_t, -10, +10)
```
Each component is logged separately for interpretability.

### 3.4 Agent — Dueling Double DQN
A fully-connected network with a shared trunk (two hidden layers of 128 units,
ReLU) branches into a **value stream** V(s) and an **advantage stream** A(s,a),
aggregated with mean subtraction:
```
Q(s,a) = V(s) + ( A(s,a) - (1/|A|) Σ_{a'} A(s,a') ).
```
Learning uses **Double DQN** targets—the online network selects the greedy next
action and the target network evaluates it:
```
y_t = r_t + γ · Q_target( s_{t+1}, argmax_a Q_online(s_{t+1}, a) ) · (1 - done).
```
Stabilizers: experience replay (capacity 50 000), a periodically hard-updated
target network (every 500 gradient steps), ε-greedy exploration with linear
decay (1.0 → 0.05), the Huber (smooth-L1) loss, and gradient-norm clipping.
Optimizer: Adam, learning rate 5×10⁻⁴, γ = 0.99, batch size 64.

### 3.5 PCU-weighted representation for heterogeneous traffic
For mixed fleets we weight each vehicle's contribution to the queue features and
the reward's queue penalty by its **Passenger Car Unit** factor (IRC 106-1990):
car = 1.0, motorcycle = 0.5, auto-rickshaw = 0.8, bus = 3.0. This makes the
agent sensitive to *traffic load* rather than raw vehicle count—a bus queue
weighs as much as three cars. Raw counts are retained for reporting, so metric
comparisons across controllers remain fair.

### 3.6 Metrics
We report, per run: **average vehicle waiting time (s)** (primary), **average
queue length (halting veh)**, **throughput (veh/h)**, and **estimated CO₂
emissions (mg)** via SUMO's emission model. Each configuration is run over
**3 random seeds**; we report **mean ± standard deviation**. Training is
monitored via the per-episode reward curve.

---

## 4. Experimental Setup
Episodes span 1200 simulated seconds for evaluation; agents are trained for
80 episodes (homogeneous scenarios) and 150 episodes (heterogeneous), with
ε-decay tuned to the training budget. All experiments run inside a Docker image
(Ubuntu 22.04 + SUMO PPA + PyTorch 2.14 CPU). The DQN is evaluated greedily
(ε = 0). Seeds {1, 2, 3} are used for evaluation.

---

## 5. Results

### 5.1 Main comparison — homogeneous demand
Table 1 reports average waiting time (mean ± std over 3 seeds).

**Table 1. Average waiting time (s).**

| Scenario | Fixed-time | Actuated | **D3QN** | Δ vs fixed | Δ vs actuated |
|---|---|---|---|---|---|
| Balanced | 56.85 ± 3.53 | 19.29 ± 2.66 | **11.97 ± 0.76** | **−78.9 %** | −38.0 % |
| Asymmetric | 64.64 ± 1.11 | 23.82 ± 0.17 | **15.82 ± 0.62** | **−75.5 %** | −33.6 % |
| Surge | 34.88 ± 0.17 | 7.42 ± 0.94 | **6.08 ± 1.77** | **−82.6 %** | −18.1 % |

**Table 2. Average queue length (halting vehicles).**

| Scenario | Fixed-time | Actuated | **D3QN** |
|---|---|---|---|
| Balanced | 4.14 ± 0.13 | 2.29 ± 0.09 | **1.93 ± 0.10** |
| Asymmetric | 4.71 ± 0.05 | 2.45 ± 0.06 | **2.11 ± 0.07** |
| Surge | 2.71 ± 0.00 | 1.16 ± 0.09 | **0.96 ± 0.07** |

**Table 3. Throughput (veh/h) — matched across controllers.**

| Scenario | Fixed-time | Actuated | D3QN |
|---|---|---|---|
| Balanced | 1168 | 1170 | 1170 |
| Asymmetric | 1356 | 1360 | 1365 |
| Surge | 786 | 784 | 784 |

**Table 4. Estimated CO₂ emissions (total, ×10⁶ mg per episode).**

| Scenario | Fixed-time | Actuated | D3QN |
|---|---|---|---|
| Balanced | 19.4 | 15.5 | **2.1** |
| Asymmetric | 23.3 | 17.8 | **2.6** |
| Surge | 12.6 | 9.5 | **1.5** |

The D3QN dominates on delay and queueing in every scenario while serving the
same number of vehicles (Table 3), i.e., the improvement is in *efficiency of
service*, not vehicles cleared. Estimated CO₂ is reduced by roughly an order of
magnitude (Table 4); as these are SUMO model estimates they should be read as
indicative rather than field-measured.

### 5.2 Training behaviour
Across all scenarios the episode reward increases and then stabilizes once ε
reaches its floor, with a bounded loss and no divergence—evidence that the
Double-DQN and dueling stabilizers, together with the bounded reward, produce
stable learning. (See `results/plots/training_curves.png`.)

### 5.3 Heterogeneous traffic — PCU ablation
Table 5 compares controllers on the mixed-fleet, sub-lane scenario.

**Table 5. Heterogeneous traffic, average waiting time (s), 3 seeds.**

| Controller | Avg wait (s) | Δ vs fixed-time |
|---|---|---|
| Fixed-time | 56.11 ± 0.95 | — |
| Actuated | 18.53 ± 1.49 | −67.0 % |
| D3QN (no PCU) | 29.38 ± 4.85 | −47.6 % |
| **D3QN (PCU-weighted)** | **22.36 ± 1.95** | **−60.1 %** |

PCU weighting improves the D3QN by **23.9 %** in waiting time over the identical
unweighted agent (22.36 vs 29.38 s) and reduces variance from ±4.85 to ±1.95—the
weighted agent learns a more consistent policy by valuing high-occupancy
vehicles appropriately. Notably, at the training budget used, the PCU-weighted
D3QN does **not** surpass the actuated baseline on heterogeneous traffic; closing
this gap is left to future work.

### 5.4 A note on scientific process
An initial short heterogeneous run (60 episodes, PCU applied to the state only)
produced the *opposite* result—PCU weighting appeared harmful. Diagnosis
attributed this to under-training and to the reward objective being unchanged.
A corrected, fair protocol (PCU applied to *both* state and reward, 150 training
episodes, ε-decay retuned for the harder scenario) reversed the finding to the
positive result in Table 5. Both outcomes are recorded to document the process
honestly rather than report only the favourable run.

---

## 6. Discussion
The results confirm that a compact D3QN can learn a signal policy that
outperforms not only fixed-time control but also a well-configured actuated
controller on delay and queueing, without sacrificing throughput. The safety
wrapper ensures the learned policy is always deployable in principle (valid
minimum-green and clearance intervals). The PCU ablation supports the central
argument that, for heterogeneous traffic, *what* the agent counts matters:
weighting the state and reward by vehicle class yields a better and more stable
policy than counting vehicles uniformly.

---

## 7. Limitations
- **Single isolated intersection.** Network-level coordination (multi-agent RL,
  non-stationarity) is out of scope.
- **Simulation only**, with permissive left turns and a discretized state.
- **Training budget.** Episodes of 1200 s and 80–150 training episodes were used
  for tractable turnaround; results are seed-consistent but a larger-scale run
  (3600 s episodes, 300 episodes, 5 seeds) would tighten confidence intervals.
- **Emissions** are simulator estimates, not field measurements.
- On heterogeneous traffic the learned agent does not yet beat the actuated
  baseline at the current budget.

---

## 8. Future Work
- Protected left-turn phases and a larger discrete action set.
- Multi-intersection / arterial coordination via multi-agent RL.
- A single generalist policy across demand regimes rather than per-scenario
  policies.
- Longer training and richer (e.g., CNN or attention-based) state encoders for
  the heterogeneous setting to close the gap to actuated control.
- Prioritized experience replay and distributional value estimation.

---

## 9. Conclusion
We presented a Dueling Double DQN controller for an isolated intersection,
trained in SUMO and evaluated rigorously against fixed-time and actuated
baselines across three demand regimes with multi-seed statistics. The controller
reduces average waiting time by 75.5–82.6 % versus fixed-time and by up to 38 %
versus actuated control, with matched throughput and substantially lower
estimated emissions. A PCU-weighted state/reward extension for heterogeneous
traffic improves the agent by 23.9 % over an unweighted counterpart. The full
pipeline is containerized and reproducible with a single command.

---

## Reproducibility
Source, trained models, and experiment scripts:
`https://github.com/ali0786mehdi/Intelligent-Traffic-Signal-Controller`
Run `make all` (Linux/Mac) or `.\run.ps1 all` (Windows) inside Docker to
reproduce all tables and figures. See `README_BUILD.md` and `DEMO.md`.

---

## References (indicative — verify and format to your venue's style)
1. V. Mnih et al., "Human-level control through deep reinforcement learning,"
   *Nature*, 2015.
2. H. van Hasselt, A. Guez, D. Silver, "Deep Reinforcement Learning with Double
   Q-learning," *AAAI*, 2016.
3. Z. Wang et al., "Dueling Network Architectures for Deep Reinforcement
   Learning," *ICML*, 2016.
4. P. A. Lopez et al., "Microscopic Traffic Simulation using SUMO," *IEEE ITSC*,
   2018.
5. Indian Roads Congress, *IRC:106-1990 — Guidelines for Capacity of Urban
   Roads in Plain Areas* (PCU factors).
6. L. N. Alegre, "SUMO-RL," open-source Gym/Gymnasium interface for SUMO.
7. H. Wei et al., surveys on reinforcement learning for traffic signal control.
