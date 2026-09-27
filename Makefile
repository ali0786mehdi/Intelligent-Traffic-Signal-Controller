# Intelligent Traffic Signal Controller — reproducible pipeline
#
# All targets run inside the Docker container defined by Dockerfile/compose.yml,
# so no local SUMO/Python install is needed — only Docker.
#
# Usage:
#   make build       # build the image (SUMO + PyTorch + deps)
#   make verify      # smoke-test the SUMO environment
#   make test        # run unit tests (reward + agent)
#   make baselines   # static + actuated baseline sweep -> results/logs/
#   make train       # train D3QN on balanced/asymmetric/surge
#   make evaluate    # Static vs Actuated vs D3QN -> tables + charts
#   make phase7      # heterogeneous PCU-weighting ablation
#   make all         # full pipeline end-to-end
#   make clean       # remove generated results + checkpoints

# docker compose service that has SUMO + deps + the project mounted at /app
RUN := docker compose run --rm traffic-rl

# Tunables (override on the CLI, e.g. `make train EPISODES=150 SIMTIME=1200`)
EPISODES ?= 80
SIMTIME  ?= 600
SEEDS    ?= 1 2 3
EVAL_SIMTIME ?= 1200

.PHONY: build verify test baselines network train evaluate phase7 all clean

build:
	docker compose build traffic-rl

network:
	$(RUN) bash network/build_network.sh

verify:
	$(RUN) python3 verify_sumo.py

test:
	$(RUN) python3 -m pytest tests/test_reward.py tests/test_agent.py -v

baselines:
	$(RUN) python3 -m baselines.run_baselines --max-sim-time $(EVAL_SIMTIME) --seeds $(SEEDS)

train:
	$(RUN) python3 train.py --scenario balanced   --episodes $(EPISODES) --max-sim-time $(SIMTIME) --seed 42
	$(RUN) python3 train.py --scenario asymmetric --episodes $(EPISODES) --max-sim-time $(SIMTIME) --seed 42
	$(RUN) python3 train.py --scenario surge      --episodes $(EPISODES) --max-sim-time $(SIMTIME) --seed 42

evaluate:
	$(RUN) python3 evaluate.py --scenarios balanced asymmetric surge --seeds $(SEEDS) --max-sim-time $(EVAL_SIMTIME)

# Phase 7: heterogeneous traffic + PCU ablation (needs both variants trained)
phase7:
	$(RUN) python3 train.py --scenario hetero --pcu-weighting --tag _pcu   --episodes 150 --max-sim-time $(SIMTIME) --seed 42
	$(RUN) python3 train.py --scenario hetero               --tag _nopcu --episodes 150 --max-sim-time $(SIMTIME) --seed 42
	$(RUN) python3 evaluate_hetero.py --seeds $(SEEDS) --max-sim-time $(EVAL_SIMTIME)

all: build verify test baselines train evaluate phase7
	@echo "Full pipeline complete. See results/logs/ and results/plots/."

clean:
	rm -f agent/models/*.pt
	rm -f results/logs/*.csv results/plots/*.png
	@echo "Cleaned generated checkpoints, logs, and plots."
