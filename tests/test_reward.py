"""Unit tests for RewardCalculator (pure logic, no SUMO needed)."""
import pytest

from env.reward import RewardCalculator


def test_no_change_no_switch():
    r = RewardCalculator(queue_weight=0.0)
    reward, comp = r.compute(100.0, 100.0, 0, 0, [])
    assert reward == pytest.approx(0.0)
    assert comp["waiting_time_delta"] == pytest.approx(0.0)


def test_improvement_rewarded():
    r = RewardCalculator(switch_penalty=0.0, queue_weight=0.0)
    reward, comp = r.compute(100.0, 80.0, 0, 0, [])
    assert reward > 0
    assert comp["waiting_time_delta"] == pytest.approx(20.0)


def test_worsening_penalized():
    r = RewardCalculator(switch_penalty=0.0, queue_weight=0.0)
    reward, comp = r.compute(80.0, 100.0, 0, 0, [])
    assert reward < 0


def test_switch_penalty_applied():
    r = RewardCalculator(waiting_time_weight=0.0, queue_weight=0.0, switch_penalty=0.5)
    reward, comp = r.compute(0.0, 0.0, 0, 1, [])
    assert comp["switch_penalty"] == pytest.approx(-0.5)


def test_no_switch_penalty_when_same_action():
    r = RewardCalculator(waiting_time_weight=0.0, queue_weight=0.0, switch_penalty=0.5)
    _, comp = r.compute(0.0, 0.0, 1, 1, [])
    assert comp["switch_penalty"] == pytest.approx(0.0)


def test_queue_penalty():
    r = RewardCalculator(waiting_time_weight=0.0, switch_penalty=0.0, queue_weight=0.1)
    _, comp = r.compute(0.0, 0.0, 0, 0, [5, 5])
    assert comp["queue_penalty"] == pytest.approx(-1.0)


def test_clip_upper():
    r = RewardCalculator(switch_penalty=0.0, queue_weight=0.0, clip_range=(-10.0, 10.0))
    reward, _ = r.compute(10000.0, 0.0, 0, 0, [])
    assert reward == pytest.approx(10.0)


def test_clip_lower():
    r = RewardCalculator(switch_penalty=0.0, queue_weight=0.0, clip_range=(-10.0, 10.0))
    reward, _ = r.compute(0.0, 10000.0, 0, 0, [])
    assert reward == pytest.approx(-10.0)


def test_component_dict_keys():
    r = RewardCalculator()
    _, comp = r.compute(50.0, 60.0, 0, 1, [2, 3])
    assert set(comp.keys()) == {
        "waiting_time_delta", "switch_penalty", "queue_penalty", "total_clipped",
    }
