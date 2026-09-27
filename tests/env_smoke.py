"""Live end-to-end smoke test for TrafficSignalEnv (requires SUMO).

Not a pytest unit test (needs a running SUMO); run directly:
    python3 tests/env_smoke.py
"""
import numpy as np

from env.traffic_env import TrafficSignalEnv, STATE_DIM


def main() -> int:
    env = TrafficSignalEnv(
        "network/intersection_balanced.sumocfg",
        config={"max_sim_time": 400},
    )
    obs, info = env.reset(seed=42)
    assert obs.shape == (STATE_DIM,), f"bad shape {obs.shape}"
    assert env.observation_space.contains(obs), "obs outside observation_space"
    in_range = bool(np.all((obs >= 0.0) & (obs <= 1.0)))
    print(f"reset OK  state_dim={STATE_DIM}  obs_in_range={in_range}")

    total_r = 0.0
    for t in range(20):
        action = t % 2  # alternate NS/EW to exercise switching + clearance
        obs, r, term, trunc, info = env.step(action)
        total_r += r
        if t % 5 == 0:
            q = info["total_queue"]
            w = info["total_wait"]
            sw = info["switched"]
            print(f"  t={t:2d} action={action} reward={r:+.2f} "
                  f"queue={q:3d} wait={w:6.0f} switched={sw}")
        if trunc:
            print(f"  truncated at t={t}")
            break

    env.close()
    print(f"ENV_SMOKE_OK total_reward={round(total_r, 2)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
