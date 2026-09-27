"""
traffic_env.py — Gymnasium-compatible SUMO traffic-signal environment.

Phase 3 deliverable. Wraps the verified Phase 2 read/act/step + clearance
logic into a standard reset()/step() RL interface.

State vector (71 dims, in the README's 60-100 target range):
    per-lane cell density   : 8 lanes x 3 cells             = 24
    per-lane cell mean speed : 8 lanes x 3 cells (normalized) = 24
    per-lane queue length    : 8 (normalized by MAX_QUEUE)    =  8
    per-lane cumulative wait  : 8 (normalized by MAX_WAIT)     =  8
    current phase one-hot     : 6                              =  6
    min-green-elapsed flag    : 1                              =  1
                                                              ----
                                                    total  =    71

Action space (Discrete(2)):
    0 -> request NS green (phase 0)
    1 -> request EW green (phase 3)

The ENVIRONMENT (not the agent) enforces minimum green time and inserts the
mandatory yellow + all-red clearance on every axis change.
"""

from __future__ import annotations

import os
import sys
from typing import Dict, List, Optional, Tuple

import numpy as np

try:
    import gymnasium as gym
    from gymnasium import spaces
except ImportError as exc:  # pragma: no cover
    raise RuntimeError("gymnasium is required: pip install gymnasium") from exc

from env.reward import RewardCalculator


# --------------------------------------------------------------------------- #
# Network constants (match network/intersection.net.xml + tls.add.xml)
# --------------------------------------------------------------------------- #
TLS_ID = "center"
PROGRAM = "static"  # deterministic 6-phase program

INCOMING_LANES: List[str] = [
    "N_in_0", "N_in_1",
    "S_in_0", "S_in_1",
    "E_in_0", "E_in_1",
    "W_in_0", "W_in_1",
]
NS_LANES = ["N_in_0", "N_in_1", "S_in_0", "S_in_1"]
EW_LANES = ["E_in_0", "E_in_1", "W_in_0", "W_in_1"]

PHASE_NS_GREEN = 0
PHASE_NS_YELLOW = 1
PHASE_ALLRED_1 = 2
PHASE_EW_GREEN = 3
PHASE_EW_YELLOW = 4
PHASE_ALLRED_2 = 5
NUM_PHASES = 6

ACTION_TO_GREEN = {0: PHASE_NS_GREEN, 1: PHASE_EW_GREEN}

# State-vector parameters
NUM_LANES = 8
NUM_CELLS = 3          # coarse cells per lane
LANE_LENGTH = 200.0    # meters (matches edge length)
CELL_LENGTH = LANE_LENGTH / NUM_CELLS
MAX_SPEED = 13.89      # m/s
MAX_QUEUE = 20.0       # normalization cap
MAX_WAIT = 300.0       # normalization cap (== time-to-teleport)

STATE_DIM = (
    NUM_LANES * NUM_CELLS      # density  = 24
    + NUM_LANES * NUM_CELLS    # speed    = 24
    + NUM_LANES                # queue    = 8
    + NUM_LANES                # wait     = 8
    + NUM_PHASES               # phase    = 6
    + 1                        # min-green flag
)  # = 71

# PCU factors (IRC 106-1990) keyed by SUMO vType id used in
# network/intersection_hetero.rou.xml. Used only when pcu_weighting is on.
PCU_FACTORS = {
    "car": 1.0,
    "motorcycle": 0.5,
    "auto": 0.8,
    "bus": 3.0,
    "passenger": 1.0,   # homogeneous scenarios use this vType
}
DEFAULT_PCU = 1.0


def _import_traci():
    sumo_home = os.environ.get("SUMO_HOME")
    if sumo_home:
        tools = os.path.join(sumo_home, "tools")
        if tools not in sys.path:
            sys.path.insert(0, tools)
    import traci  # noqa: WPS433
    return traci


class TrafficSignalEnv(gym.Env):
    """Single 4-way intersection, discrete phase-selection RL environment."""

    metadata = {"render_modes": []}

    def __init__(self, sumocfg_path: str, config: Optional[dict] = None) -> None:
        super().__init__()
        if not os.path.exists(sumocfg_path):
            raise FileNotFoundError(f"Missing SUMO config: {sumocfg_path}")
        self.sumocfg_path = sumocfg_path

        cfg = config or {}
        self.min_green = int(cfg.get("min_green", 10))
        self.yellow_time = int(cfg.get("yellow_time", 3))
        self.all_red_time = int(cfg.get("all_red_time", 2))
        self.decision_interval = int(cfg.get("decision_interval", 5))
        self.max_sim_time = float(cfg.get("max_sim_time", 3600.0))
        self.pcu_weighting = bool(cfg.get("pcu_weighting", False))

        reward_cfg = cfg.get("reward", {})
        self.reward_calc = RewardCalculator(
            waiting_time_weight=reward_cfg.get("waiting_time_weight", 1.0),
            switch_penalty=reward_cfg.get("switch_penalty", 0.5),
            queue_weight=reward_cfg.get("queue_weight", 0.1),
            clip_range=tuple(reward_cfg.get("clip_range", [-10.0, 10.0])),
        )

        self.observation_space = spaces.Box(
            low=0.0, high=1.0, shape=(STATE_DIM,), dtype=np.float32,
        )
        self.action_space = spaces.Discrete(2)

        self._traci = None
        self._label = "default"
        self._current_green = PHASE_NS_GREEN
        self._time_in_green = 0.0
        self._prev_action = 0
        self._prev_wait = 0.0
        self._sim_time = 0.0
        self._arrived = 0

    # ------------------------------------------------------------------ #
    # Gym API
    # ------------------------------------------------------------------ #
    def reset(self, *, seed: Optional[int] = None, options: Optional[dict] = None
              ) -> Tuple[np.ndarray, dict]:
        super().reset(seed=seed)
        self._close_sim()

        traci = _import_traci()
        self._traci = traci

        import uuid
        self._label = f"env_{uuid.uuid4().hex[:8]}"

        sumo_cmd = [
            "sumo",
            "--configuration-file", self.sumocfg_path,
            "--no-step-log", "true",
            "--no-warnings", "true",
            "--quit-on-end", "true",
        ]
        if seed is not None:
            sumo_cmd += ["--seed", str(int(seed))]

        traci.start(sumo_cmd, label=self._label)
        conn = traci.getConnection(self._label)

        conn.trafficlight.setProgram(TLS_ID, PROGRAM)
        conn.trafficlight.setPhase(TLS_ID, PHASE_NS_GREEN)

        self._current_green = PHASE_NS_GREEN
        self._time_in_green = 0.0
        self._prev_action = 0
        self._sim_time = 0.0
        self._arrived = 0
        self.reward_calc.reset()
        self._prev_wait = self._total_wait(conn)

        return self._get_state(conn), {}

    def step(self, action: int) -> Tuple[np.ndarray, float, bool, bool, dict]:
        conn = self._traci.getConnection(self._label)
        action = int(action)
        target_green = ACTION_TO_GREEN[action]

        # ---- ACT: enforce min-green, insert yellow + all-red on axis change ---
        switched = False
        if target_green != self._current_green and self._time_in_green >= self.min_green:
            yellow = PHASE_NS_YELLOW if self._current_green == PHASE_NS_GREEN else PHASE_EW_YELLOW
            all_red = PHASE_ALLRED_1 if self._current_green == PHASE_NS_GREEN else PHASE_ALLRED_2
            conn.trafficlight.setPhase(TLS_ID, yellow)
            self._advance(conn, self.yellow_time)
            conn.trafficlight.setPhase(TLS_ID, all_red)
            self._advance(conn, self.all_red_time)
            conn.trafficlight.setPhase(TLS_ID, target_green)
            self._current_green = target_green
            self._time_in_green = 0.0
            switched = True
        else:
            self._time_in_green += self.decision_interval

        # ---- STEP the decision interval ----
        self._advance(conn, self.decision_interval)

        # ---- READ new state + reward ----
        # PCU-aware queues drive the reward's queue penalty (when pcu_weighting
        # is on, a bus counts ~3x, a motorcycle ~0.5x). Raw halting counts are
        # kept separately for fair metric reporting across controllers.
        queues_for_reward = [self._lane_queue(conn, l) for l in INCOMING_LANES]
        raw_queues = [conn.lane.getLastStepHaltingNumber(l) for l in INCOMING_LANES]
        curr_wait = self._total_wait(conn)
        reward, components = self.reward_calc.compute(
            self._prev_wait, curr_wait, self._prev_action, action, queues_for_reward,
        )
        self._prev_wait = curr_wait
        self._prev_action = action

        state = self._get_state(conn)
        terminated = False
        truncated = (
            self._sim_time >= self.max_sim_time
            or conn.simulation.getMinExpectedNumber() <= 0
        )
        info = {
            "reward_components": components,
            "sim_time": self._sim_time,
            "total_queue": int(sum(raw_queues)),
            "total_wait": float(curr_wait),
            "switched": switched,
            "arrived": int(self._arrived),
        }
        return state, reward, terminated, truncated, info

    def close(self) -> None:
        self._close_sim()

    # ------------------------------------------------------------------ #
    # Internals
    # ------------------------------------------------------------------ #
    def _advance(self, conn, n_steps: int) -> None:
        for _ in range(int(n_steps)):
            conn.simulationStep()
            self._arrived += conn.simulation.getArrivedNumber()
            self._sim_time = conn.simulation.getTime()

    def _total_wait(self, conn) -> float:
        return float(sum(conn.lane.getWaitingTime(l) for l in INCOMING_LANES))

    def _lane_queue(self, conn, lane: str) -> float:
        """
        Queue length for a lane. Raw halting-vehicle count normally; when
        pcu_weighting is enabled, sum the PCU factors of halting vehicles
        (IRC 106-1990) so a bus counts as ~3 cars and a motorcycle as ~0.5.
        """
        if not self.pcu_weighting:
            return float(conn.lane.getLastStepHaltingNumber(lane))
        pcu_sum = 0.0
        for vid in conn.lane.getLastStepVehicleIDs(lane):
            if conn.vehicle.getSpeed(vid) < 0.1:  # halting
                vtype = conn.vehicle.getTypeID(vid)
                pcu_sum += PCU_FACTORS.get(vtype, DEFAULT_PCU)
        return pcu_sum

    def _get_state(self, conn) -> np.ndarray:
        density = np.zeros((NUM_LANES, NUM_CELLS), dtype=np.float32)
        speed = np.zeros((NUM_LANES, NUM_CELLS), dtype=np.float32)
        cell_counts = np.zeros((NUM_LANES, NUM_CELLS), dtype=np.float32)

        for li, lane in enumerate(INCOMING_LANES):
            veh_ids = conn.lane.getLastStepVehicleIDs(lane)
            for vid in veh_ids:
                pos = conn.vehicle.getLanePosition(vid)  # 0 at lane start, LANE_LENGTH at stop line
                dist_from_stop = LANE_LENGTH - pos
                cell = int(dist_from_stop / CELL_LENGTH)
                if 0 <= cell < NUM_CELLS:
                    cell_counts[li, cell] += 1.0
                    speed[li, cell] += min(conn.vehicle.getSpeed(vid) / MAX_SPEED, 1.0)
            # normalize density by an assumed max of ~ (cell_length / 7.5m per veh)
            max_veh_per_cell = max(CELL_LENGTH / 7.5, 1.0)
            for c in range(NUM_CELLS):
                density[li, c] = min(cell_counts[li, c] / max_veh_per_cell, 1.0)
                if cell_counts[li, c] > 0:
                    speed[li, c] = speed[li, c] / cell_counts[li, c]

        queue = np.array(
            [min(self._lane_queue(conn, l), MAX_QUEUE) / MAX_QUEUE
             for l in INCOMING_LANES], dtype=np.float32,
        )
        wait = np.array(
            [min(conn.lane.getWaitingTime(l), MAX_WAIT) / MAX_WAIT
             for l in INCOMING_LANES], dtype=np.float32,
        )
        phase_onehot = np.zeros(NUM_PHASES, dtype=np.float32)
        cur_phase = conn.trafficlight.getPhase(TLS_ID)
        if 0 <= cur_phase < NUM_PHASES:
            phase_onehot[cur_phase] = 1.0
        min_green_flag = np.array(
            [1.0 if self._time_in_green >= self.min_green else 0.0], dtype=np.float32,
        )

        state = np.concatenate([
            density.flatten(), speed.flatten(), queue, wait, phase_onehot, min_green_flag,
        ]).astype(np.float32)
        return np.clip(state, 0.0, 1.0)

    def _close_sim(self) -> None:
        if self._traci is not None:
            try:
                self._traci.getConnection(self._label).close()
            except Exception:  # noqa: BLE001 — best-effort shutdown
                pass
            self._traci = None
