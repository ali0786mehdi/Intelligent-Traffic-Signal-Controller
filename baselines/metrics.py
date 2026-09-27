"""
metrics.py — Shared metrics collection for baseline + RL evaluation runs.

Collects the standard comparison metrics on a single SUMO episode driven by a
given traffic-light program, entirely via TraCI:
    * average total waiting time (s)
    * average total queue length (halting vehicles)
    * throughput (vehicles arrived per simulated hour)

Used by both baseline controllers (static, actuated) and later by the
evaluation harness so every controller is measured identically.
"""

from __future__ import annotations

import os
import sys
from typing import Dict, List

TLS_ID = "center"
INCOMING_LANES: List[str] = [
    "N_in_0", "N_in_1", "S_in_0", "S_in_1",
    "E_in_0", "E_in_1", "W_in_0", "W_in_1",
]


def _import_traci():
    sumo_home = os.environ.get("SUMO_HOME")
    if sumo_home:
        tools = os.path.join(sumo_home, "tools")
        if tools not in sys.path:
            sys.path.insert(0, tools)
    import traci  # noqa: WPS433
    return traci


def run_baseline(
    sumocfg_path: str,
    program: str,
    max_sim_time: float = 3600.0,
    seed: int | None = None,
) -> Dict[str, float]:
    """
    Run one episode letting SUMO's own TLS program (`program`) control the
    signal — no external phase setting. Returns a metrics dict.

    `program` must be one of the programIDs defined in tls.add.xml:
    'static' or 'actuated'.
    """
    if not os.path.exists(sumocfg_path):
        raise FileNotFoundError(f"Missing SUMO config: {sumocfg_path}")

    traci = _import_traci()
    sumo_cmd = [
        "sumo",
        "--configuration-file", sumocfg_path,
        "--no-step-log", "true",
        "--no-warnings", "true",
        "--quit-on-end", "true",
    ]
    if seed is not None:
        sumo_cmd += ["--seed", str(int(seed))]

    queue_samples: List[int] = []
    wait_samples: List[float] = []
    arrived = 0
    co2_total = 0.0          # mg
    fuel_total = 0.0         # mg
    emissions_ok = True

    traci.start(sumo_cmd)
    try:
        traci.trafficlight.setProgram(TLS_ID, program)
        while (
            traci.simulation.getTime() < max_sim_time
            and traci.simulation.getMinExpectedNumber() > 0
        ):
            traci.simulationStep()
            arrived += traci.simulation.getArrivedNumber()
            total_q = sum(
                traci.lane.getLastStepHaltingNumber(l) for l in INCOMING_LANES
            )
            total_w = sum(
                traci.lane.getWaitingTime(l) for l in INCOMING_LANES
            )
            queue_samples.append(total_q)
            wait_samples.append(total_w)
            # Emissions (nice-to-have; never fatal).
            if emissions_ok:
                try:
                    co2_total += sum(
                        traci.lane.getCO2Emission(l) for l in INCOMING_LANES
                    )
                    fuel_total += sum(
                        traci.lane.getFuelConsumption(l) for l in INCOMING_LANES
                    )
                except Exception:  # noqa: BLE001
                    emissions_ok = False
        sim_time = traci.simulation.getTime()
    finally:
        traci.close()

    avg_queue = sum(queue_samples) / len(queue_samples) if queue_samples else 0.0
    avg_wait = sum(wait_samples) / len(wait_samples) if wait_samples else 0.0
    throughput = (arrived / sim_time * 3600.0) if sim_time > 0 else 0.0

    return {
        "program": program,
        "sim_time": round(sim_time, 1),
        "avg_queue": round(avg_queue, 3),
        "avg_wait": round(avg_wait, 3),
        "vehicles_arrived": arrived,
        "throughput_per_hour": round(throughput, 1),
        "co2_mg": round(co2_total, 1) if emissions_ok else None,
        "fuel_mg": round(fuel_total, 1) if emissions_ok else None,
    }
