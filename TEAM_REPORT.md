# Team Report — Intelligent Traffic Signal Controller (RL / D3QN + SUMO)

*A plain-language overview for the team: what we built, how it works, what the
results say, and how to run it yourself.*

---

## 1. What is this project, in one paragraph?

We built an **AI traffic signal controller**. Instead of a fixed timer or a
basic sensor rule, a reinforcement-learning agent watches live traffic at a
4-way intersection and decides when to switch the light, learning to **minimize
how long vehicles wait**. We proved it beats the two standard real-world
controllers (fixed-time and actuated) using the industry-standard traffic
simulator **SUMO**. Everything is reproducible with one command in Docker.

---

## 2. The three parts (so we all speak the same language)

1. **Environment (SUMO + TraCI):** a realistic traffic simulation of a 4-way
   intersection. We read traffic state and set the signal from Python in real
   time. Three traffic patterns: **balanced**, **asymmetric** (heavy one
   direction), and **surge** (rush-hour spike).
2. **Agent (D3QN in PyTorch):** the "brain." It sees the intersection, picks
   which road gets green, and learns from a reward. D3QN = **Dueling + Double
   Deep Q-Network** — standard techniques that make learning stable.
3. **Evaluation:** we compare Fixed-time vs Actuated vs our DQN on identical
   traffic, 3 random seeds each, reporting mean ± standard deviation.

---

## 3. How the agent works (quick mental model)

- **State (what it sees):** a 71-number snapshot — vehicles and speeds along
  each lane, queue lengths, waiting times, and the current signal phase.
- **Action (what it does):** every 5 seconds, choose green for **North-South**
  or **East-West** (2 choices).
- **Reward (how it learns):** rewarded for **reducing total waiting time**;
  small penalty for switching too often (prevents unsafe flicker).
- **Safety:** the *environment* forces a 10s minimum green and inserts
  yellow + all-red on every switch — so the AI can never produce an unsafe plan.

---

## 4. The results (the important part)

**Average waiting time per vehicle (lower = better):**

| Scenario | Fixed-time | Actuated | **Our DQN** | Improvement vs fixed |
|---|---|---|---|---|
| Balanced | 56.9 s | 19.3 s | **12.0 s** | **−78.9%** |
| Asymmetric | 64.6 s | 23.8 s | **15.8 s** | **−75.5%** |
| Surge | 34.9 s | 7.4 s | **6.1 s** | **−82.6%** |

**Key takeaways:**
- Our DQN cuts waiting time **75–83% vs fixed-time**, and **beats even the strong
  actuated baseline** (by up to 38%).
- **Queue lengths** are also lowest for the DQN.
- **Throughput is the same** (~1170 veh/h) for all controllers — expected,
  because all clear the same traffic. Our win is *efficiency* (less waiting),
  not *volume*.
- **CO₂** in simulation is ~**10× lower** under the DQN (much less idling).
- The **training curve** shows reward rising then stabilizing → the agent
  genuinely learned.

---

## 5. The bonus experiment (our differentiator)

Real roads have mixed vehicles (cars, bikes, autos, buses), not just cars. We
added a **heterogeneous** scenario and weighted the agent's perception by
**Passenger Car Units** (IRC standard: bus = 3 cars, motorcycle = 0.5).

**Result:** PCU-weighting made the agent **24% better** and more consistent than
the same agent without it (22.4 s vs 29.4 s waiting).
*Honest note:* our first attempt made it worse — we found we'd only weighted the
observation, not the reward, and under-trained. After fixing both, it worked.
We documented both outcomes (good science).

---

## 6. What's NOT done / limitations (so no one overclaims)

- Single intersection only (not a coordinated network — that's future work).
- Simulation only, not real hardware.
- Results use moderate-length runs for fast turnaround; a full-scale run would
  tighten the numbers.
- On heterogeneous traffic the DQN doesn't yet beat actuated (only beats the
  un-weighted DQN) — noted honestly.

---

## 7. How to run it yourself (needs Docker Desktop running)

```powershell
# Windows
.\run.ps1 verify      # confirm SUMO works (vehicles moving)
.\run.ps1 evaluate    # the headline comparison table + charts
```
```bash
# Linux / Mac
make verify
make evaluate
```
Outputs: `results/logs/*.csv` (numbers) and `results/plots/*.png` (charts).
No SUMO/Python install needed — everything runs in the Docker container.

---

## 8. Where everything lives (repo map)

| Path | What |
|---|---|
| `network/` | SUMO intersection + traffic scenarios |
| `env/traffic_env.py` | the RL environment (state/action/step) |
| `env/reward.py` | the reward function |
| `agent/dqn.py` | the D3QN agent (raw PyTorch) |
| `baselines/` | fixed-time + actuated controllers |
| `train.py` / `evaluate.py` | training / evaluation entry points |
| `results/` | logged CSVs + charts |
| `REPORT.md`, `paper/` | full report + IEEE research paper |
| `VERIFICATION.md` | proof every paper number matches the logs |

**GitHub:** https://github.com/ali0786mehdi/Intelligent-Traffic-Signal-Controller

---

## 9. One-line summary to repeat

> "An RL signal controller (Dueling Double DQN) that cuts vehicle waiting time
> 75–83% vs fixed-time and beats actuated control too, with a PCU-weighted
> extension for mixed traffic — fully reproducible in Docker."

*Questions? Ping [your name]. Every result is traceable to a logged simulation
run (see VERIFICATION.md).*
