# Intelligent Traffic Signal Controller using Deep Q-Network (DQN)
### Complete Build Guide — Problems, Solutions, Tech Stack, and Roadmap

---

## 1. The Real Structure of This Project

Don't think of this as "one AI project." It's three linked sub-projects:

1. **The Environment** — a working traffic simulation that behaves realistically enough that a policy learned in it isn't meaningless.
2. **The Agent** — the DQN that observes state, picks actions, and learns from reward.
3. **The Evaluation** — proof (graphs, numbers) that your RL controller beats fixed-time and actuated control.

Most mini-projects at this level fail at #1 (bad simulation setup) or #3 (no real baseline comparison), not at #2. So the guide below spends real effort on the parts people usually skip.

---

## 2. Core Problems You Will Face, and How to Tackle Each

### Problem 1: You need a traffic simulator, not just a coded environment
A DQN needs an environment with a `step()` function returning (state, reward, done). Building a physically realistic multi-lane traffic simulator from scratch (car-following models, lane-changing, collision avoidance) is a research-level task by itself — don't do it.

**Solution:** Use **SUMO (Simulation of Urban MObility)**, the standard open-source microscopic traffic simulator used in nearly all traffic-RL research papers.
- Build your intersection network using **SUMO's `netedit`** (GUI tool) or generate it via `netgenerate`.
- Define traffic demand (vehicle flows/routes) using SUMO's route files (`.rou.xml`).
- Control it from Python in real time using **TraCI** (Traffic Control Interface) — this is what lets your DQN agent read queue lengths and set signal phases live during simulation.

This single decision (SUMO + TraCI) removes 60% of the engineering difficulty of this project.

---

### Problem 2: Defining the "state" so the agent can actually learn from it
If your state representation is too coarse (e.g., just total car count), the agent can't learn good policies. If it's too large (e.g., raw pixel grid of every vehicle), training becomes unstable and slow for a mini project timeline.

**Solution — use a discretized/cell-based state, the standard approach in traffic-RL papers:**
- Divide each incoming lane into fixed-length cells (e.g., 7 cells of ~7m each, extending back from the stop line).
- For each cell, encode: `presence of vehicle (0/1)` and `normalized speed`.
- Add to this: **queue length per lane**, **cumulative waiting time per lane**, and **current signal phase** (as one-hot).
- Flatten all of this into a single state vector — typically 60–100 dimensions for a 4-way single intersection. This is small enough for a plain fully-connected DQN (no need for CNNs).

---

### Problem 3: Defining the action space correctly
If you let the agent pick "green duration in seconds" directly, you get a huge/continuous action space that vanilla DQN struggles with.

**Solution:** Discretize actions as **phase selection**, not duration selection:
- Define a fixed set of legal signal phases (e.g., NS-green, EW-green, NS-left-turn-green, EW-left-turn-green).
- At each decision step (every fixed interval, e.g., 5 seconds), the agent chooses **which phase should be active next**.
- Enforce a **minimum green time** (e.g., 10s) and a **yellow + all-red clearance phase** automatically whenever the agent switches phases, to keep it physically valid and safe. This logic lives in your environment wrapper, not the agent.

This is the standard formulation (used in SUMO-RL, CityFlow-RL, and most published DQN traffic-control papers) and keeps your action space to 4–8 discrete choices.

---

### Problem 4: Reward function design (this is where most projects go wrong)
A reward that's just "negative total waiting time" often causes unstable training or reward hacking (agent flickers phases rapidly, or starves one direction).

**Solution — use a shaped, bounded reward:**
- Primary term: **negative change in cumulative waiting time** between the last state and current state (this teaches the agent to *reduce* waiting, not just react to its absolute value).
- Add a **small penalty for phase changes** (discourages flickering/rapid switching — mimics real yellow-light cost).
- Optionally add a **queue-length penalty** term with a small weight, to catch cases waiting-time alone misses (e.g., long queue that hasn't waited long yet).
- Clip/normalize the reward to a reasonable range (e.g., -10 to +10) — unbounded rewards destabilize Q-learning.

Log all reward components separately during training so you can debug *why* the agent is doing something odd — this saves huge amounts of debugging time later.

---

### Problem 5: Training instability (classic DQN issues)
Vanilla Q-learning with a single neural net is unstable — Q-values can diverge or oscillate.

**Solution — implement the standard DQN stabilizers (all well documented, not hard to code):**
- **Experience Replay Buffer**: store (state, action, reward, next_state, done) tuples; sample random minibatches to break correlation between consecutive simulation steps.
- **Target Network**: a second copy of the Q-network, updated slowly (every N steps, or via soft/Polyak update), used to compute target Q-values — prevents chasing a moving target.
- **Epsilon-greedy exploration** with decay: start near-random (ε≈1.0), decay to a low value (ε≈0.05) over training so the agent explores early and exploits later.
- Optionally add **Double DQN** (decouples action selection from evaluation, reduces overestimation bias) — a small code change with a meaningful stability improvement, worth it for your report.

---

### Problem 6: Simulation-to-training time cost
SUMO simulations run in real (or accelerated) simulated time; training a DQN needs thousands of episodes. This can take hours to run on a laptop.

**Solution:**
- Run SUMO in **headless/no-GUI mode** (`sumo`, not `sumo-gui`) during training — GUI rendering slows it down massively.
- Set a high **simulation step size** and use SUMO's `--step-length` carefully; keep episodes short (e.g., 1 hour of simulated traffic = a few thousand simulation steps).
- Cap total training episodes appropriately (e.g., 200–500 episodes is often enough to show clear learning curves for a single intersection in a mini project).
- If your machine is slow, run overnight or use Google Colab (CPU is usually fine here — DQN with a small MLP doesn't need heavy GPU).

---

### Problem 7: Generating realistic-enough traffic demand
Random uniform traffic doesn't demonstrate adaptability well — you want scenarios that show *why* static timing fails (asymmetric flows, rush-hour surges, unexpected demand).

**Solution:** Create multiple demand scenarios using SUMO's route generation tools:
- **Balanced demand** (baseline sanity check).
- **Asymmetric demand** (e.g., heavy N-S flow, light E-W) — this is where fixed-time signals visibly fail and your RL agent should visibly win.
- **Rush-hour surge** (traffic volume increases mid-episode) — tests adaptability, the core selling point of your whole project.
- Use SUMO's `randomTrips.py` script or manually define flows in the `.rou.xml` file with different vehsPerHour values per direction and per time window.

---

### Problem 8: You need real baselines to compare against, not just "our AI is better" claims
Without proper baselines, your evaluation section has no credibility.

**Solution — implement (or configure) these three controllers on the same network/demand for comparison:**
1. **Static/Fixed-time controller** — hardcoded fixed green durations per phase, cycling in order (trivial to implement, or use SUMO's default static traffic light logic).
2. **Actuated controller** — SUMO supports gap-based actuated control natively (`type="actuated"` in the traffic light definition) — extends green while vehicles keep arriving, up to a max. This is a strong, realistic baseline, not a strawman.
3. **Your DQN agent.**

Run all three on **identical demand scenarios** and compare:
- Average vehicle waiting time
- Average queue length
- Total throughput (vehicles cleared per hour)
- Average travel time / delay
- Fuel consumption / CO₂ estimate (SUMO's emission models give this for free via TraCI)

---

### Problem 9: Reproducibility and report-worthy results
Random seeds cause noisy results; a single run isn't statistically convincing.

**Solution:**
- Fix random seeds for SUMO and your RL training where possible, but **run each evaluation configuration 3–5 times** with different seeds and report mean ± std deviation, not single-run numbers.
- Plot **training reward curve** (shows learning is actually happening — a key figure examiners look for).
- Plot **comparison bar charts**: waiting time / throughput / queue length across (Static vs Actuated vs DQN).

---

### Problem 10 (stretch, mention as future work if time-limited): Multi-intersection scaling
A single intersection is enough for a solid mini project. Scaling to a road network (multiple coordinated intersections) is a genuinely harder problem (multi-agent RL, non-stationarity, coordination) — don't attempt this unless you have significant extra time. Mention it explicitly in your report as "future scope" — examiners respect scoped honesty more than an overreaching but broken multi-agent implementation.

---

## 3. Complete Technology Stack

| Layer | Tool / Library | Purpose |
|---|---|---|
| Traffic simulator | **SUMO** (Eclipse SUMO) + `netedit`/`netgenerate` | Build the intersection network, simulate vehicle flow |
| Simulator-Python bridge | **TraCI** (`traci` Python package, ships with SUMO) | Real-time control: read state, set signal phases, step simulation |
| RL environment wrapper | Custom Python `gym.Env`-style class (or use **`sumo-rl`**, an existing open-source Gym wrapper for SUMO) | Standardizes state/action/reward/step/reset interface |
| Deep learning framework | **PyTorch** (recommended) or TensorFlow/Keras | Build and train the DQN neural network |
| RL utilities | Plain Python (`collections.deque` for replay buffer) or **Stable-Baselines3** if you want a tested DQN implementation instead of writing from scratch | Experience replay, target networks, training loop |
| Numerical/data | NumPy, Pandas | State vector handling, logging, results tables |
| Visualization | Matplotlib / Seaborn | Training curves, baseline comparison charts |
| Dev environment | Python 3.10+, Jupyter Notebook or VS Code | Development and experimentation |
| Optional: experiment tracking | TensorBoard or Weights & Biases | Log training metrics cleanly, good for report screenshots |
| Version control | Git + GitHub | Code management, and to show project history/commits if evaluated |

**Note on Stable-Baselines3:** If your timeline is tight (a "5th sem mini project" usually means limited weeks), using SB3's built-in, well-tested `DQN` implementation on top of a custom Gym-style SUMO environment is a completely legitimate and common approach — your contribution and grading value is in the **environment design, state/reward engineering, and evaluation**, not in re-deriving DQN math from scratch. If your course requires you to hand-code the DQN itself (check with your instructor), write it in raw PyTorch (a 3-layer MLP with target network + replay buffer is ~150–200 lines).

---

## 4. Suggested Build Order (Week-by-Week)

**Week 1 — Environment setup**
Install SUMO, learn `netedit`, build a single 4-way intersection network manually, define a basic route file, verify it runs correctly in `sumo-gui`.

**Week 2 — TraCI integration**
Write Python code using TraCI to: start SUMO headless, read queue length/waiting time per lane at each step, manually set a signal phase, and step the simulation. Confirm you can fully control the intersection from Python before touching RL.

**Week 3 — Gym-style wrapper + baselines**
Wrap the above into a `reset()`/`step()` class. Implement the static and actuated baseline controllers and get their performance numbers first — this validates your environment and metrics pipeline before RL is even involved.

**Week 4 — DQN agent**
Implement (or plug in SB3) the DQN: state vector, action space (phase selection), reward function, replay buffer, target network, training loop. Start training on the balanced-demand scenario first.

**Week 5 — Training, tuning, and harder scenarios**
Train on asymmetric and rush-hour scenarios. Tune reward weights, learning rate, epsilon decay. Save training curves.

**Week 6 — Evaluation and report**
Run all three controllers (static, actuated, DQN) across multiple seeds on all scenarios. Generate comparison plots and tables. Write up problem framing, methodology, results, and limitations/future work (mention multi-intersection scaling here).

---

## 5. What Will Make This Project Stand Out (for grading)

- A clear **ablation or comparison table**: Static vs Actuated vs DQN, with numeric % improvement in waiting time and throughput.
- A **training curve** showing reward increasing and stabilizing over episodes (proof the learning is real, not luck).
- At least **one scenario where fixed-time visibly fails and DQN visibly adapts** (e.g., sudden surge in one direction) — this is your strongest demo moment.
- Honest discussion of limitations (single intersection, simulation-only, discretized state) and a clearly scoped "future work" section rather than overclaiming real-world readiness.

---

If you want, I can next help you set up the actual SUMO network XML + a working TraCI Python skeleton (state extraction, phase-switching action, and reward calculation) so you have real code to start from.
