# Implementation Plan

- [ ] 1. Set up project structure and environment verification
  - Create the folder structure (`network/`, `env/`, `agent/`, `baselines/`, `results/`) as defined in design.md
  - Verify SUMO, `SUMO_HOME`, and TraCI import work via a throwaway smoke-test script
  - Initialize `requirements.txt` / dependency list
  - _Requirements: 1.1, 1.4_

- [ ] 2. Build the SUMO network and demand scenarios
  - [ ] 2.1 Build the base 4-way intersection network in `netedit`/`netgenerate`, export `intersection.net.xml`
    - _Requirements: 1.1_
  - [ ] 2.2 Generate the balanced-demand route file using `randomTrips.py`
    - _Requirements: 1.2, 1.3_
  - [ ] 2.3 Generate the asymmetric-demand route file (heavy one direction, light cross-street)
    - _Requirements: 1.3_
  - [ ] 2.4 Generate the rush-hour-surge route file (demand increases mid-episode)
    - _Requirements: 1.3_
  - [ ] 2.5 Write one `.sumocfg` per scenario, and validate each loads correctly in `sumo-gui` with visible vehicle movement
    - _Requirements: 1.2, 1.4, 1.5_

- [ ] 3. Implement the traffic light program definitions for baselines
  - [ ] 3.1 Define the static TLS program (`type="static"`) with fixed phase durations in `tls.add.xml`
    - _Requirements: 6.1_
  - [ ] 3.2 Define the actuated TLS program (`type="actuated"`) with gap-based extension and max green
    - _Requirements: 6.2_
  - [ ] 3.3 Confirm both programs run against the same network/route files with no network file changes
    - _Requirements: 6.3_

- [ ] 4. Implement TraCI-based state extraction
  - [ ] 4.1 Write a function to query per-lane queue length, waiting time, and mean speed via TraCI
    - _Requirements: 2.1_
  - [ ] 4.2 Implement lane cell-discretization producing the presence/speed grid
    - _Requirements: 2.2_
  - [ ] 4.3 Implement one-hot encoding of the current active phase and concatenate into the full state vector
    - _Requirements: 2.3, 2.4_
  - [ ] 4.4 Add default-to-zero handling for missing/absent lane data
    - _Requirements: 2.5_
  - [ ] 4.5 Write unit tests asserting fixed output shape and zero-fill behavior
    - _Requirements: 2.4, 2.5_

- [ ] 5. Implement signal phase control (action application)
  - [ ] 5.1 Define the fixed discrete phase set and map action indices to SUMO phase strings
    - _Requirements: 3.1_
  - [ ] 5.2 Implement minimum-green enforcement (reject/defer phase change before min duration elapses)
    - _Requirements: 3.4_
  - [ ] 5.3 Implement automatic yellow-phase insertion on a legal phase change
    - _Requirements: 3.2_
  - [ ] 5.4 Implement automatic all-red clearance insertion after yellow, before the new green
    - _Requirements: 3.3_
  - [ ] 5.5 Implement same-phase action handling (extend without clearance)
    - _Requirements: 3.5_
  - [ ] 5.6 Write unit tests covering: legal switch, illegal switch during min-green, repeated-phase extension
    - _Requirements: 3.2, 3.3, 3.4, 3.5_

- [ ] 6. Implement the reward calculator
  - [ ] 6.1 Implement negative waiting-time-delta as the primary reward term
    - _Requirements: 4.1_
  - [ ] 6.2 Implement the phase-switch penalty term
    - _Requirements: 4.2_
  - [ ] 6.3 Implement queue-length penalty term and reward clipping
    - _Requirements: 4.3_
  - [ ] 6.4 Implement per-component logging output (dict of components alongside scalar reward)
    - _Requirements: 4.4_
  - [ ] 6.5 Write unit tests with synthetic waiting-time sequences asserting expected reward + component values
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [ ] 7. Assemble the Gym-style `TrafficSignalEnv` wrapper
  - [ ] 7.1 Implement `__init__` with SUMO startup, config validation, and file-existence checks
    - _Requirements: 1.4, 8.1_
  - [ ] 7.2 Implement `reset()`: (re)start SUMO, apply seed, return initial state
    - _Requirements: 2.4, 8.2, 8.3_
  - [ ] 7.3 Implement `step(action)`: apply action (Task 5), advance simulation across the decision interval, compute state (Task 4) and reward (Task 6), return `(state, reward, done, info)`
    - _Requirements: 2.1-2.5, 3.1-3.5, 4.1-4.4_
  - [ ] 7.4 Implement `close()` for clean TraCI/SUMO shutdown
    - _Requirements: 1.5_
  - [ ] 7.5 Write an integration smoke test: run 2-3 short episodes end-to-end with no exceptions
    - _Requirements: 1.1-1.5, 2.1-2.5, 3.1-3.5, 4.1-4.4_

- [ ] 8. Implement the DQN agent
  - [ ] 8.1 Implement `QNetwork` (fully connected architecture per design.md)
    - _Requirements: 5.1_
  - [ ] 8.2 Implement `ReplayBuffer` with fixed capacity and random sampling
    - _Requirements: 5.3_
  - [ ] 8.3 Implement epsilon-greedy `act()` with configurable decay schedule
    - _Requirements: 5.2_
  - [ ] 8.4 Implement `replay()`: minibatch sampling, target-network bootstrapped Q-value computation, backprop step
    - _Requirements: 5.4_
  - [ ] 8.5 Implement `update_target_network()` (hard or soft update, configurable frequency)
    - _Requirements: 5.5_
  - [ ] 8.6 Implement `save()`/`load()` checkpointing
    - _Requirements: 5.7_
  - [ ] 8.7 Write unit tests: replay buffer sampling shapes, target network update timing, epsilon decay monotonicity
    - _Requirements: 5.2, 5.3, 5.5_

- [ ] 9. Implement configuration and reproducibility handling
  - [ ] 9.1 Implement config loading (YAML file + CLI overrides) per the schema in design.md
    - _Requirements: 8.1_
  - [ ] 9.2 Implement consistent seeding across SUMO, NumPy/PyTorch, and replay buffer sampling
    - _Requirements: 8.2_
  - [ ] 9.3 Implement auto-generation and logging of a seed when none is provided
    - _Requirements: 8.3_

- [ ] 10. Implement `train.py` entrypoint
  - [ ] 10.1 Wire config loading, environment construction, and agent construction together
    - _Requirements: 5.1, 8.1_
  - [ ] 10.2 Implement the episode loop (reset → act/step/remember/replay loop → episode-end logging)
    - _Requirements: 5.2, 5.3, 5.4, 5.6_
  - [ ] 10.3 Implement periodic target-network updates and periodic checkpointing during training
    - _Requirements: 5.5, 5.7_
  - [ ] 10.4 Add try/finally crash-safe final checkpoint save
    - _Requirements: 5.7_
  - [ ] 10.5 Run a full training pass (all three scenarios) and confirm reward curves trend upward
    - _Requirements: 5.6_

- [ ] 11. Implement baseline controller runners
  - [ ] 11.1 Implement `static_controller.py` runner using the static TLS program
    - _Requirements: 6.1, 6.3_
  - [ ] 11.2 Implement `actuated_controller.py` runner using the actuated TLS program
    - _Requirements: 6.2, 6.3_

- [ ] 12. Implement the evaluation harness
  - [ ] 12.1 Implement the run loop over {controllers × scenarios × seeds}
    - _Requirements: 7.2_
  - [ ] 12.2 Implement metrics collection per run (waiting time, queue length, throughput, travel time)
    - _Requirements: 7.1_
  - [ ] 12.3 Implement optional emissions/fuel metric collection via TraCI
    - _Requirements: 7.4_
  - [ ] 12.4 Implement mean/std aggregation per (controller, scenario) and CSV export
    - _Requirements: 7.2, 7.5_
  - [ ] 12.5 Implement comparison bar-chart generation and the DQN training reward-curve plot
    - _Requirements: 7.3_
  - [ ] 12.6 Write a short sanity test: run one scenario/seed for all three controllers, assert metrics CSV has all expected columns populated
    - _Requirements: 7.1, 7.5_

- [ ] 13. Final integration pass
  - [ ] 13.1 Run the complete pipeline end-to-end: train DQN → evaluate all controllers across all scenarios/seeds → generate final plots and CSV
    - _Requirements: 7.1, 7.2, 7.3, 7.5_
  - [ ] 13.2 Review results for at least one scenario where DQN clearly outperforms the static baseline; document in README
    - _Requirements: 7.1, 7.2_
