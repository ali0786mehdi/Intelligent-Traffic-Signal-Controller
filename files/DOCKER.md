# Running This Project in Docker

This lets you build and train on **any machine** with just Docker installed — no manual SUMO/`SUMO_HOME`/TraCI setup required. Everything from the [SETUP.md](./SETUP.md) guide is already baked into the image.

## Prerequisites
- Docker Desktop (Windows/Mac) or Docker Engine + Compose plugin (Linux)
- Verify: `docker --version` and `docker compose version`

## Files involved
- `Dockerfile` — builds an image with Ubuntu 22.04 + SUMO + TraCI + PyTorch + all Python deps
- `compose.yml` — defines the dev container (with live code mounting) plus convenience `train`/`evaluate` services
- `requirements.txt` — Python dependency list installed into the image
- `.dockerignore` — keeps unnecessary files out of the build context

## 1. First-time build
From the project root (where `Dockerfile` and `compose.yml` live):
```bash
docker compose build
```
This installs SUMO + TraCI + PyTorch inside the image and runs a build-time check (`import traci, sumolib` + `sumo --version`) — if SUMO is broken, **the build fails immediately** instead of surfacing a confusing error later during training.

## 2. Start the dev container and shell in
```bash
docker compose up -d traffic-rl
docker compose exec traffic-rl bash
```
You're now inside the container with SUMO, TraCI, and PyTorch all working, and your entire project folder live-mounted at `/app` — any edit you make on your host machine (in your normal editor) is immediately visible inside the container. No rebuild needed for code changes; only rebuild when `requirements.txt` or the `Dockerfile` itself changes.

Verify inside the container:
```bash
python3 -c "import traci; print('OK')"
sumo --version
```

## 3. Run training or evaluation directly (no manual shell needed)
```bash
docker compose run --rm train
docker compose run --rm evaluate
```
These use the `train`/`evaluate` services already wired to `train.py` / `evaluate.py` in `compose.yml`. Checkpoints land in `./agent/models/` and results in `./results/` **on your host machine**, since those folders are mounted as volumes — they persist even if you delete the container.

## 4. Stopping / cleaning up
```bash
docker compose down          # stop and remove the container (image + volumes stay)
docker compose down --rmi all  # also remove the built image
```

## 5. Putting this on GitHub
Commit these files at the project root:
```
Dockerfile
compose.yml
requirements.txt
.dockerignore
DOCKER.md
```
Add to `.gitignore` (host-side, not `.dockerignore`) so you don't commit large binaries or generated files:
```
agent/models/*.pt
results/logs/*
results/plots/*
__pycache__/
*.pyc
.venv/
```

Then on **any new machine**, the entire setup is just:
```bash
git clone <your-repo-url>
cd <your-repo>
docker compose build
docker compose up -d traffic-rl
docker compose exec traffic-rl bash
```
No SUMO install, no `SUMO_HOME` variable, no Python version mismatches — the container handles all of it identically every time.

## Notes
- This image is **headless only** (no `sumo-gui`) — it's meant for training/evaluation, which should always run headless anyway for speed. For visual inspection of the network, install SUMO natively on your host and open `.sumocfg` in `sumo-gui` there (see `SETUP.md`).
- The image uses CPU-only PyTorch. This project's DQN (small MLP, single intersection) doesn't need a GPU — if you later scale to multi-intersection RL and want CUDA, that's a separate image variant (`nvidia/cuda` base + GPU PyTorch build), not required here.
- If `docker compose build` fails at the `add-apt-repository ppa:sumo/stable` step, it's almost always a transient network/DNS issue in the build environment — retry the build.
