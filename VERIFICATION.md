# Results Verification Record

This document certifies that every quantitative result in `RESEARCH_PAPER.md`
and `paper/research_paper.tex` is traceable to logged simulation output. All
values were **independently recomputed** from the raw per-run CSV files and
matched against the paper's tables.

**Data sources (raw, per-run, 3 seeds each):**
- `results/logs/evaluation_results.csv` — main comparison (static/actuated/DQN)
- `results/logs/hetero_ablation_results.csv` — Phase 7 PCU ablation
- `results/logs/training_*.csv` — per-episode training curves

Aggregation: mean and **population** standard deviation over seeds {1, 2, 3}.
Evaluation episodes: 1200 simulated seconds. DQN evaluated greedily (ε = 0).

---

## 1. Average waiting time (s) — matches paper Table (main)

| Scenario | Controller | Paper | Recomputed | Match |
|---|---|---|---|---|
| balanced | static | 56.85 ± 3.53 | 56.85 ± 3.53 | ✅ |
| balanced | actuated | 19.29 ± 2.66 | 19.29 ± 2.66 | ✅ |
| balanced | DQN | 11.97 ± 0.76 | 11.97 ± 0.76 | ✅ |
| asymmetric | static | 64.64 ± 1.11 | 64.64 ± 1.11 | ✅ |
| asymmetric | actuated | 23.82 ± 0.17 | 23.82 ± 0.17 | ✅ |
| asymmetric | DQN | 15.82 ± 0.62 | 15.82 ± 0.62 | ✅ |
| surge | static | 34.88 ± 0.17 | 34.88 ± 0.17 | ✅ |
| surge | actuated | 7.42 ± 0.94 | 7.42 ± 0.94 | ✅ |
| surge | DQN | 6.08 ± 1.77 | 6.08 ± 1.77 | ✅ |

## 2. Average queue length (halting vehicles) — matches

balanced: 4.14 / 2.29 / 1.93 · asymmetric: 4.71 / 2.45 / 2.11 ·
surge: 2.71 / 1.16 / 0.96  (static / actuated / DQN) — all match.

## 3. Throughput (veh/h) — matches (and matched across controllers)

balanced: 1168 / 1170 / 1170 · asymmetric: 1356 / 1360 / 1365 ·
surge: 786 / 784 / 784. Throughput is statistically equal across controllers:
all clear the same demand, so the DQN's advantage is in delay/queue, not
vehicles served.

## 4. Phase 7 — heterogeneous PCU ablation — matches

| Controller | Paper | Recomputed | Match |
|---|---|---|---|
| static | 56.11 ± 0.95 | 56.11 ± 0.95 | ✅ |
| actuated | 18.53 ± 1.49 | 18.53 ± 1.49 | ✅ |
| DQN (no PCU) | 29.38 ± 4.85 | 29.38 ± 4.85 | ✅ |
| DQN (PCU) | 22.36 ± 1.95 | 22.36 ± 1.95 | ✅ |

## 5. Derived percentage claims — verified by arithmetic

| Claim | Computation | Result |
|---|---|---|
| DQN vs static, balanced | (56.85−11.97)/56.85 | −78.9% ✅ |
| DQN vs static, asymmetric | (64.64−15.82)/64.64 | −75.5% ✅ |
| DQN vs static, surge | (34.88−6.08)/34.88 | −82.6% ✅ |
| DQN vs actuated, balanced | (19.29−11.97)/19.29 | −38.0% ✅ |
| PCU vs no-PCU | (29.38−22.36)/29.38 | +23.9% ✅ |
| PCU vs static | (56.11−22.36)/56.11 | −60.1% ✅ |

---

## Reproduce this verification
```
make evaluate          # regenerates evaluation_results.csv
make phase7            # regenerates hetero_ablation_results.csv
```
(or `.\run.ps1 evaluate` / `.\run.ps1 phase7` on Windows). Aggregates are
recomputed by re-reading the CSVs; no value in the paper is hand-entered
without a corresponding logged run.

**Conclusion:** All reported metrics, standard deviations, and percentage
improvements are consistent with the raw experimental logs. Results are genuine
and reproducible.
