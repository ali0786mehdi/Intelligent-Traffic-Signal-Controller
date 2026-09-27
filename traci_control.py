#!/usr/bin/env python3
"""
traci_control.py — Phase 2: Full programmatic control of the SUMO intersection
via TraCI, with no manual SUMO interaction.

Demonstrates the complete read/act/step loop that the RL environment will later
build on:
  * start SUMO headless via TraCI
  * READ  per-lane queue length + cumulative waiting time every decision step
  * ACT   set the signal phase (longest-queue heuristic: serve the busier axis)
  * STEP  advance the simulation
  * enforce minimum green + insert yellow / all-red clearance on phase changes
  * print per-step metrics and an end-of-episode summary

This is a controller demonstration, NOT the Gym environment (that is Phase 3).
It exists to prove we can fully read state and set phases from Python.

Usage (inside the container):
    python3 traci_control.py --scenario balanced --controller longest_queue
    python3 traci_control.py --scenario balanced --controller fixed --max-steps 500
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass, field
from typing import Dict, List


# --------------------------------------------------------------------------- #
# SUMO / TraCI import
# --------------------------------------------------------------------------- #
def _import_traci():
    """Ensure $SUMO_HOME/tools is importable, then import traci."""
    sumo_home = os.environ.get("SUMO_HOME")
    if sumo_home:
        tools = os.path.join(sumo_home, "tools")
        if tools not in sys.path:
            sys.path.insert(0, tools)
    try:
        import traci  # noqa: WPS433 (runtime import is intentional)

        return traci
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "Failed to import 'traci'. Set SUMO_HOME or `pip install traci`."
        ) from exc


# --------------------------------------------------------------------------- #
# Network constants (match network/intersection.net.xml + tls.add.xml)
# --------------------------------------------------------------------------- #
TLS_ID = "center"
PROGRAM = "static"  # explicit, deterministic 6-phase program

# 8 incoming approach lanes (2 per arm)
INCOMING_LANES: List[str] = [
    "N_in_0", "N_in_1",
    "S_in_0", "S_in_1",
    "E_in_0", "E_in_1",
    "W_in_0", "W_in_1",
]

# Green-phase indices in the 'static'/'actuated' 6-phase program
PHASE_NS_GREEN = 0   # 'GgGgGgGgrrrrrrrr'
PHASE_NS_YELLOW = 1
PHASE_ALLRED_1 = 2
PHASE_EW_GREEN = 3   # 'rrrrrrrrGgGgGgGg'
PHASE_EW_YELLOW = 4
PHASE_ALLRED_2 = 5

NS_LANES = ["N_in_0", "N_in_1", "S_in_0", "S_in_1"]
EW_LANES = ["E_in_0", "E_in_1", "W_in_0", "W_in_1"]

# Timing (seconds) — mirrors config.yaml env section
MIN_GREEN = 10
YELLOW_TIME = 3
ALL_RED_TIME = 2
DECISION_INTERVAL = 5


# --------------------------------------------------------------------------- #
# Metrics container
# --------------------------------------------------------------------------- #
@dataclass
class EpisodeMetrics:
    steps: int = 0
    sim_time: float = 0.0
    total_queue_samples: List[int] = field(default_factory=list)
    total_wait_samples: List[float] = field(default_factory=list)
    arrived: int = 0
    phase_changes: int = 0

    def summary(self) -> Dict[str, float]:
        avg_queue = (
            sum(self.total_queue_samples) / len(self.total_queue_samples)
            if self.total_queue_samples else 0.0
        )
        avg_wait = (
            sum(self.total_wait_samples) / len(self.total_wait_samples)
            if self.total_wait_samples else 0.0
        )
        return {
            "steps": self.steps,
            "sim_time": self.sim_time,
            "avg_total_queue": round(avg_queue, 2),
            "avg_total_wait": round(avg_wait, 2),
            "vehicles_arrived": self.arrived,
            "phase_changes": self.phase_changes,
            "throughput_per_hour": round(self.arrived / self.sim_time * 3600, 1)
            if self.sim_time > 0 else 0.0,
        }


# --------------------------------------------------------------------------- #
# State reading
# --------------------------------------------------------------------------- #
def read_queue_lengths(traci) -> Dict[str, int]:
    """Halting-vehicle count per incoming lane (queue length)."""
    return {
        lane: traci.lane.getLastStepHaltingNumber(lane)
        for lane in INCOMING_LANES
    }


def read_waiting_times(traci) -> Dict[str, float]:
    """Cumulative waiting time (s) per incoming lane."""
    return {
        lane: traci.lane.getWaitingTime(lane)
        for lane in INCOMING_LANES
    }


# --------------------------------------------------------------------------- #
# Controllers (decide which axis to serve)
# --------------------------------------------------------------------------- #
def longest_queue_action(queues: Dict[str, int]) -> int:
    """Return the green phase for whichever axis has the longer total queue."""
    ns = sum(queues[l] for l in NS_LANES)
    ew = sum(queues[l] for l in EW_LANES)
    return PHASE_NS_GREEN if ns >= ew else PHASE_EW_GREEN


def fixed_cycle_action(step: int) -> int:
    """Alternate NS/EW every ~8 decision steps (simple fixed baseline)."""
    return PHASE_NS_GREEN if (step // 8) % 2 == 0 else PHASE_EW_GREEN


# --------------------------------------------------------------------------- #
# Action application: min-green + yellow + all-red clearance
# --------------------------------------------------------------------------- #
def apply_phase(traci, target_green: int, current_green: int,
                time_in_green: float, metrics: EpisodeMetrics) -> tuple[int, float]:
    """
    Transition to `target_green` safely. Returns (new_current_green, time_in_green).

    Enforces MIN_GREEN before allowing a switch, and inserts the correct
    yellow + all-red clearance phases when the axis actually changes.
    """
    # Same axis -> just keep extending the current green.
    if target_green == current_green:
        return current_green, time_in_green + DECISION_INTERVAL

    # Minimum green not yet satisfied -> defer the switch.
    if time_in_green < MIN_GREEN:
        return current_green, time_in_green + DECISION_INTERVAL

    # Legal switch: yellow for the current axis, then all-red, then new green.
    yellow = PHASE_NS_YELLOW if current_green == PHASE_NS_GREEN else PHASE_EW_YELLOW
    all_red = PHASE_ALLRED_1 if current_green == PHASE_NS_GREEN else PHASE_ALLRED_2

    traci.trafficlight.setPhase(TLS_ID, yellow)
    for _ in range(YELLOW_TIME):
        traci.simulationStep()
    traci.trafficlight.setPhase(TLS_ID, all_red)
    for _ in range(ALL_RED_TIME):
        traci.simulationStep()

    traci.trafficlight.setPhase(TLS_ID, target_green)
    metrics.phase_changes += 1
    return target_green, 0.0


# --------------------------------------------------------------------------- #
# Main episode loop
# --------------------------------------------------------------------------- #
def run_episode(scenario: str, controller: str, max_steps: int,
                verbose: bool) -> Dict[str, float]:
    traci = _import_traci()

    sumocfg = f"network/intersection_{scenario}.sumocfg"
    if not os.path.exists(sumocfg):
        raise FileNotFoundError(f"Missing config: {sumocfg}")

    sumo_cmd = [
        "sumo",
        "--configuration-file", sumocfg,
        "--no-step-log", "true",
        "--no-warnings", "true",
        "--quit-on-end", "true",
    ]

    metrics = EpisodeMetrics()
    traci.start(sumo_cmd)
    try:
        # Pin the deterministic 6-phase program and start on NS green.
        traci.trafficlight.setProgram(TLS_ID, PROGRAM)
        traci.trafficlight.setPhase(TLS_ID, PHASE_NS_GREEN)

        current_green = PHASE_NS_GREEN
        time_in_green = 0.0
        step = 0

        while step < max_steps and traci.simulation.getMinExpectedNumber() > 0:
            # ---- READ state ----
            queues = read_queue_lengths(traci)
            waits = read_waiting_times(traci)
            total_q = sum(queues.values())
            total_w = sum(waits.values())
            metrics.total_queue_samples.append(total_q)
            metrics.total_wait_samples.append(total_w)

            # ---- DECIDE action ----
            if controller == "longest_queue":
                target = longest_queue_action(queues)
            elif controller == "fixed":
                target = fixed_cycle_action(step)
            else:
                raise ValueError(f"Unknown controller: {controller}")

            # ---- ACT (with clearance) ----
            current_green, time_in_green = apply_phase(
                traci, target, current_green, time_in_green, metrics,
            )

            # ---- STEP the decision interval ----
            for _ in range(DECISION_INTERVAL):
                traci.simulationStep()
                metrics.arrived += traci.simulation.getArrivedNumber()

            step += 1
            metrics.steps = step
            metrics.sim_time = traci.simulation.getTime()

            if verbose and step % 10 == 0:
                axis = "NS" if current_green == PHASE_NS_GREEN else "EW"
                print(
                    f"  step {step:4d} | t={metrics.sim_time:6.0f}s "
                    f"| green={axis} | total_queue={total_q:3d} "
                    f"| total_wait={total_w:7.1f}s | arrived={metrics.arrived}"
                )
    finally:
        traci.close()

    return metrics.summary()


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main() -> int:
    parser = argparse.ArgumentParser(description="Phase 2 TraCI control demo.")
    parser.add_argument("--scenario", default="balanced",
                        choices=["balanced", "asymmetric", "surge"])
    parser.add_argument("--controller", default="longest_queue",
                        choices=["longest_queue", "fixed"])
    parser.add_argument("--max-steps", type=int, default=200,
                        help="number of decision steps (each = DECISION_INTERVAL sim-seconds)")
    parser.add_argument("--quiet", action="store_true", help="suppress per-step logging")
    args = parser.parse_args()

    print("=" * 60)
    print("  Phase 2 — TraCI programmatic control demonstration")
    print("=" * 60)
    print(f"  Scenario   : {args.scenario}")
    print(f"  Controller : {args.controller}")
    print(f"  Max steps  : {args.max_steps} (x{DECISION_INTERVAL}s decision interval)")
    print("-" * 60)

    summary = run_episode(
        scenario=args.scenario,
        controller=args.controller,
        max_steps=args.max_steps,
        verbose=not args.quiet,
    )

    print("-" * 60)
    print("  EPISODE SUMMARY")
    for key, val in summary.items():
        print(f"    {key:22s}: {val}")
    print("=" * 60)
    print("  PHASE2_CONTROL_OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
