# Product Overview

## What this project is
An Intelligent Traffic Signal Controller that uses a Deep Q-Network (DQN) reinforcement learning agent to dynamically control signal phases at a single simulated road intersection, replacing static fixed-time signal logic.

## Problem it solves
Traditional fixed-time traffic signals do not adapt to real-time conditions, causing avoidable congestion, long wait times, and wasted fuel. This project demonstrates that an RL-based controller can reduce vehicle waiting time and improve throughput compared to conventional static and actuated (gap-based) signal control, using a realistic traffic microsimulation rather than a toy environment.

## Scope
- Single 4-way intersection, simulated in SUMO.
- Three demand scenarios: balanced, asymmetric, rush-hour surge.
- One RL agent (DQN) benchmarked against two conventional baselines (static, actuated).
- Simulation-only; no physical hardware or live sensor integration.
- Multi-intersection / network-wide coordination is explicitly out of scope (documented as future work).

## Primary users
- This is an academic mini-project (AI course, 5th semester). The primary "user" is the student/developer building and evaluating it, and the secondary audience is the course evaluator/examiner reviewing the final report and results.

## Success criteria
1. A trained DQN agent that demonstrably reduces average vehicle waiting time versus the static baseline on at least the asymmetric and surge scenarios.
2. Reproducible, multi-seed evaluation results (not single-run anecdotes).
3. Clear, presentable comparison plots and a training reward curve suitable for a project report/demo.
4. Honest, scoped documentation of limitations (single intersection, simulation-only, discretized state).
