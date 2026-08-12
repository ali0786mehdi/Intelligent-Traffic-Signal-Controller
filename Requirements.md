# Requirements Document

## Introduction

This feature implements an Intelligent Traffic Signal Controller that replaces fixed-time signal logic at a single road intersection with a Reinforcement Learning agent (Deep Q-Network). The system uses the SUMO traffic simulator as the environment and TraCI as the real-time control interface. The agent observes lane-level traffic state, selects signal phases dynamically, and is trained to minimize cumulative vehicle waiting time. The system must also produce a reproducible benchmark comparing the trained agent against static (fixed-time) and actuated (gap-based) baseline controllers on identical demand scenarios.

## Requirements

### Requirement 1: Simulation Environment Setup

**User Story:** As a developer, I want a working SUMO intersection network with configurable traffic demand, so that I have a realistic and controllable environment to train and evaluate a signal controller.

#### Acceptance Criteria

1. WHEN the project is initialized THEN the system SHALL provide a SUMO network file (`.net.xml`) representing a single 4-way intersection with at least two lanes per approach.
2. WHEN a simulation is started THEN the system SHALL load vehicle demand from a route file (`.rou.xml`) referenced by a `.sumocfg` configuration.
3. WHEN demand scenarios are required THEN the system SHALL support at minimum three distinct traffic patterns: balanced, asymmetric, and rush-hour-surge.
4. IF the `.sumocfg` file references a missing network or route file THEN the system SHALL fail with a clear error before simulation start rather than a silent TraCI connection failure.
5. WHEN the simulation is run in headless mode THEN the system SHALL execute without rendering the GUI, to support fast repeated training runs.

### Requirement 2: Real-Time State Observation via TraCI

**User Story:** As the RL agent, I want to observe the intersection's current traffic state at each decision step, so that I can select an appropriate signal phase.

#### Acceptance Criteria

1. WHEN a simulation step is queried THEN the system SHALL retrieve, per incoming lane: queue length, cumulative waiting time, and mean vehicle speed via TraCI.
2. WHEN state is constructed THEN the system SHALL discretize each incoming lane into fixed-length cells and encode vehicle presence and normalized speed per cell.
3. WHEN state is constructed THEN the system SHALL include the current active signal phase as a one-hot encoded component.
4. WHEN the state vector is returned THEN the system SHALL return a fixed-length numeric vector regardless of the number of vehicles currently present.
5. IF TraCI returns no data for a lane (e.g., simulation just started) THEN the system SHALL default missing values to zero rather than raising an exception.

### Requirement 3: Signal Phase Control (Action Space)

**User Story:** As the RL agent, I want to select which signal phase should be active next, so that I can influence traffic flow through the intersection.

#### Acceptance Criteria

1. WHEN an action is selected THEN the system SHALL choose from a fixed discrete set of legal signal phases (e.g., NS-green, EW-green, NS-left-green, EW-left-green).
2. WHEN a phase change is requested THEN the system SHALL automatically insert a yellow-light clearance interval before the new phase becomes active.
3. WHEN a phase change is requested THEN the system SHALL automatically insert an all-red clearance interval after yellow and before the next green phase, to prevent unsafe transitions.
4. IF the currently active phase has not yet met its configured minimum green duration THEN the system SHALL reject or defer a phase-change action until the minimum duration elapses.
5. WHEN the agent selects the same phase that is already active THEN the system SHALL extend the current phase without inserting a clearance interval.

### Requirement 4: Reward Function

**User Story:** As the RL agent, I want a reward signal that reflects traffic efficiency, so that I can learn a policy that reduces congestion.

#### Acceptance Criteria

1. WHEN a simulation step completes THEN the system SHALL compute reward primarily as the negative change in cumulative vehicle waiting time since the previous step.
2. WHEN a phase change occurs THEN the system SHALL apply a configurable small penalty to discourage excessive switching.
3. WHEN reward is computed THEN the system SHALL clip the final reward value to a configurable bounded range.
4. WHEN reward components are computed THEN the system SHALL log each component (waiting-time term, switch penalty, queue term) separately for later analysis.

### Requirement 5: DQN Agent Training

**User Story:** As a developer, I want to train a Deep Q-Network agent against the environment, so that it learns an effective signal control policy.

#### Acceptance Criteria

1. WHEN training starts THEN the system SHALL initialize a Q-network and a separate target network with identical architecture.
2. WHEN an action is chosen during training THEN the system SHALL use an epsilon-greedy policy with a configurable decay schedule.
3. WHEN a transition occurs THEN the system SHALL store (state, action, reward, next_state, done) in a replay buffer of configurable capacity.
4. WHEN a training step occurs THEN the system SHALL sample a random minibatch from the replay buffer and update the Q-network using the target network's bootstrapped values.
5. WHEN a configurable number of steps has elapsed THEN the system SHALL update the target network's weights from the Q-network (hard or soft update).
6. WHEN training completes an episode THEN the system SHALL log total episodic reward, average waiting time, and epsilon value.
7. WHEN training finishes THEN the system SHALL persist the trained model weights to disk in a resumable/loadable format.

### Requirement 6: Baseline Controllers

**User Story:** As an evaluator, I want static and actuated baseline controllers on the same network, so that I can quantify the DQN agent's improvement over conventional methods.

#### Acceptance Criteria

1. WHEN the static baseline is run THEN the system SHALL cycle through a fixed, hardcoded sequence of phases with fixed durations, independent of traffic state.
2. WHEN the actuated baseline is run THEN the system SHALL extend the green phase while vehicles continue to arrive on the active approach, up to a configured maximum green time.
3. WHEN either baseline is run THEN the system SHALL be evaluated on the same network file and same route/demand file as the DQN agent, with no code changes to the network itself.

### Requirement 7: Evaluation and Benchmarking

**User Story:** As a project stakeholder, I want quantitative comparison results across controllers, so that I can verify and report whether the RL approach outperforms conventional signal control.

#### Acceptance Criteria

1. WHEN an evaluation run is executed THEN the system SHALL report, per controller: average waiting time, average queue length, throughput (vehicles cleared per hour), and average travel time.
2. WHEN an evaluation run is executed THEN the system SHALL run each controller across at least 3 random seeds per demand scenario and report mean and standard deviation.
3. WHEN evaluation completes THEN the system SHALL generate comparison plots (bar charts across controllers, and a DQN training reward curve).
4. IF emission/fuel data is available via TraCI THEN the system SHALL additionally report estimated CO2/fuel consumption per controller.
5. WHEN results are generated THEN the system SHALL save all raw metrics to a structured file (CSV or JSON) in addition to any plots, so results are reproducible and re-analyzable.

### Requirement 8: Configuration and Reproducibility

**User Story:** As a developer, I want training and evaluation runs to be configurable and reproducible, so that results can be trusted and repeated.

#### Acceptance Criteria

1. WHEN training or evaluation is launched THEN the system SHALL accept a configuration file or CLI arguments specifying hyperparameters (learning rate, epsilon schedule, replay buffer size, episode count, reward weights).
2. WHEN a random seed is provided THEN the system SHALL apply it consistently to SUMO, the replay buffer sampling, and the neural network initialization.
3. IF no seed is provided THEN the system SHALL generate and log one automatically so the run can be reproduced later.

## Out of Scope

- Multi-intersection / network-wide coordination (multi-agent RL) is explicitly excluded from this spec and is documented as future work.
- Real-world hardware integration (physical traffic controllers, live camera/sensor feeds) is out of scope; this spec covers simulation only.
