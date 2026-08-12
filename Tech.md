# Technology Stack

## Core stack
- **Simulator:** SUMO (Eclipse SUMO) — microscopic traffic simulation
- **Simulator control:** TraCI (Traffic Control Interface, Python package bundled with SUMO)
- **Language:** Python 3.10+
- **Deep learning framework:** PyTorch (CPU is sufficient — do not require CUDA/GPU for this project's scale)
- **RL environment interface:** custom `gymnasium.Env`-style wrapper (`env/traffic_env.py`); `sumo-rl` may be referenced for patterns but the wrapper here is hand-built to match design.md
- **Numerical/data:** NumPy, Pandas
- **Visualization:** Matplotlib
- **Optional:** `stable-baselines3` may be used for the DQN implementation itself if course requirements permit a pre-built RL library instead of a hand-rolled agent — but the environment, state/reward design, and evaluation harness must remain custom

## Environment requirements
- `SUMO_HOME` environment variable must be set and point at the SUMO install directory; TraCI imports depend on `$SUMO_HOME/tools` being on `sys.path`.
- Use a Python virtual environment (`venv`) dedicated to this project.
- Run SUMO **headless** (`sumo`, not `sumo-gui`) during training and evaluation for speed; use `sumo-gui` only for manual inspection/demo purposes.

## Common commands
```bash
# Activate environment
source traffic-rl-env/bin/activate

# Verify TraCI is importable
python -c "import traci; import sumolib; print('OK')"

# Generate a route file for a scenario
python "$SUMO_HOME/tools/randomTrips.py" -n network/intersection.net.xml -r network/intersection_balanced.rou.xml -e 3600 -p 2

# Run training
python train.py --config config.yaml --scenario balanced

# Run evaluation across all controllers/scenarios/seeds
python evaluate.py --config config.yaml

# Run unit tests
pytest tests/
```

## Conventions
- All hyperparameters and paths live in `config.yaml` — no hardcoded magic numbers in `train.py`/`evaluate.py`.
- Every training/evaluation run must log its resolved random seed.
- Reward component breakdown must always be logged alongside the scalar reward, never just the scalar.
- Baseline controllers (static/actuated) reuse SUMO's native TLS program types rather than being reimplemented from scratch in Python.
