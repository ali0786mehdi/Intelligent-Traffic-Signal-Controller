"""
reward.py — Reward calculation for the traffic-signal RL environment.

Design (from README Problem #4 — shaped, bounded reward):
  * primary term : negative change in cumulative waiting time (W_{t-1} - W_t)
                   -> positive reward when the controller REDUCES waiting.
  * switch penalty: small negative term when the phase axis changes, to
                    discourage flickering / rapid switching.
  * queue penalty : small negative term proportional to total queue length,
                    catching cases waiting-time alone misses.
  * clipped/normalized into a bounded range for Q-learning stability.

Every component is returned separately so training can log WHY the agent is
being rewarded, not just the scalar total.
"""

from __future__ import annotations

from typing import Dict, List, Tuple


class RewardCalculator:
    """Computes shaped, bounded reward from traffic-state transitions."""

    def __init__(
        self,
        waiting_time_weight: float = 1.0,
        switch_penalty: float = 0.5,
        queue_weight: float = 0.1,
        clip_range: Tuple[float, float] = (-10.0, 10.0),
    ) -> None:
        self.waiting_time_weight = waiting_time_weight
        self.switch_penalty = switch_penalty
        self.queue_weight = queue_weight
        self.clip_range = clip_range

    def compute(
        self,
        prev_waiting_time: float,
        curr_waiting_time: float,
        prev_action: int,
        curr_action: int,
        queue_lengths: List[float],
    ) -> Tuple[float, Dict[str, float]]:
        """
        Compute the scalar reward and its components.

        Returns:
            (reward, components) where components is a dict with keys:
            waiting_time_delta, switch_penalty, queue_penalty, total_clipped.
        """
        # Positive when waiting time DROPS (curr < prev).
        wt_delta = (prev_waiting_time - curr_waiting_time) * self.waiting_time_weight
        switch_term = -self.switch_penalty if curr_action != prev_action else 0.0
        queue_term = -sum(queue_lengths) * self.queue_weight

        raw = wt_delta + switch_term + queue_term
        clipped = float(max(self.clip_range[0], min(self.clip_range[1], raw)))

        components: Dict[str, float] = {
            "waiting_time_delta": float(wt_delta),
            "switch_penalty": float(switch_term),
            "queue_penalty": float(queue_term),
            "total_clipped": clipped,
        }
        return clipped, components

    def reset(self) -> None:
        """Reset any per-episode internal state (none currently)."""
        return None
