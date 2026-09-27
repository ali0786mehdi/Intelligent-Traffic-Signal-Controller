# Build & Reproduce

Everything runs inside Docker — **the only prerequisite is Docker Desktop**
(no local SUMO or Python needed). All commands are wrapped by the `Makefile`.

## Prerequisites
- Docker Desktop installed and running (`docker ps` should succeed).
- Windows users: `make` via Git Bash / WSL, or run the underlying
  `docker compose run ...` commands directly (shown below).

## Quick start (one command)
```bash
make all
```
This runs the full pipeline: build image → verify SUMO → unit tests →
baselines → train D3QN (3 scenarios) → evaluate → Phase 7 ablation.
Outputs land in `results/logs/` (CSVs) and `results/plots/` (charts);
model checkpoints in `agent/models/`.

### Windows without `make` (PowerShell runner)
If `make` isn't installed (default on Windows), use the equivalent
PowerShell wrapper — same targets, no extra installs:
```powershell
.\run.ps1 all          # full pipeline
.\run.ps1 build        # or any single target: verify | test | baselines |
.\run.ps1 evaluate     #   train | evaluate | phase7 | clean
```
Tuning: `.\run.ps1 train -Episodes 150 -SimTime 1200 -Seeds "1 2 3 4 5"`

## Step by step
```bash
make build       # build SUMO + PyTorch image (~few min, one-time)
make verify      # SUMO smoke test: network loads, vehicles move
make test        # unit tests (reward + D3QN agent)
make baselines   # fixed-time + actuated baselines -> baseline_results.csv
make train       # train D3QN on balanced / asymmetric / surge
make evaluate    # Static vs Actuated vs D3QN -> evaluation_results.csv + charts
make phase7      # heterogeneous traffic + PCU-weighting ablation
```

## Tuning knobs
Override defaults on the command line:
```bash
make train EPISODES=150 SIMTIME=1200      # longer training
make evaluate SEEDS="1 2 3 4 5"           # more seeds
```
For publication-grade numbers: `make train EPISODES=300 SIMTIME=3600`
and `make evaluate SEEDS="1 2 3 4 5" EVAL_SIMTIME=3600`.

## Without `make` (raw docker compose)
```bash
docker compose build traffic-rl
docker compose run --rm traffic-rl python3 verify_sumo.py
docker compose run --rm traffic-rl python3 -m pytest tests/test_reward.py tests/test_agent.py -v
docker compose run --rm traffic-rl python3 train.py --scenario balanced --episodes 80 --max-sim-time 600 --seed 42
docker compose run --rm traffic-rl python3 evaluate.py --scenarios balanced asymmetric surge --seeds 1 2 3 --max-sim-time 1200
```

## Outputs
| Path | Contents |
|---|---|
| `results/logs/baseline_results.csv` | baseline sweep |
| `results/logs/training_<scenario>.csv` | per-episode reward curve + components |
| `results/logs/evaluation_results.csv` | per-run eval metrics (3 controllers) |
| `results/logs/hetero_ablation_results.csv` | Phase 7 ablation |
| `results/plots/compare_*.png` | comparison bar charts |
| `results/plots/training_curves.png` | training reward curves |
| `results/plots/hetero_ablation.png` | Phase 7 chart |
| `agent/models/dqn_*.pt` | trained checkpoints |

## Clean up
```bash
make clean   # remove generated checkpoints, logs, plots
```

See `REPORT.md` for the full write-up and results discussion.
