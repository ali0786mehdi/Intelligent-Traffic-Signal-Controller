"""
dqn.py — D3QN agent (Dueling + Double DQN) in raw PyTorch.

Components (README Problem #5 stabilizers):
  * DuelingQNetwork : shared trunk -> separate Value(s) and Advantage(s,a)
                      streams, combined with mean-subtraction aggregation:
                      Q(s,a) = V(s) + (A(s,a) - mean_a A(s,a))
  * ReplayBuffer    : fixed-capacity, uniform random minibatch sampling.
  * DQNAgent        : epsilon-greedy action selection with decay, Double-DQN
                      target computation (online net selects the argmax action,
                      target net evaluates it), and a target network updated by
                      hard copy or Polyak soft update.

Hand-coded (not Stable-Baselines3) so the raw implementation is available for
grading.
"""

from __future__ import annotations

import random
from collections import deque
from typing import Deque, List, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F


# --------------------------------------------------------------------------- #
# Dueling Q-Network
# --------------------------------------------------------------------------- #
class DuelingQNetwork(nn.Module):
    """Dueling DQN: shared trunk + value and advantage streams."""

    def __init__(self, state_dim: int, action_dim: int,
                 hidden_sizes: Tuple[int, int] = (128, 128)) -> None:
        super().__init__()
        h1, h2 = hidden_sizes
        self.trunk = nn.Sequential(
            nn.Linear(state_dim, h1),
            nn.ReLU(),
            nn.Linear(h1, h2),
            nn.ReLU(),
        )
        # Value stream: V(s) -> scalar
        self.value_head = nn.Sequential(
            nn.Linear(h2, h2),
            nn.ReLU(),
            nn.Linear(h2, 1),
        )
        # Advantage stream: A(s, a) -> per-action
        self.advantage_head = nn.Sequential(
            nn.Linear(h2, h2),
            nn.ReLU(),
            nn.Linear(h2, action_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        features = self.trunk(x)
        value = self.value_head(features)                 # (B, 1)
        advantage = self.advantage_head(features)         # (B, A)
        # Mean-subtraction aggregation for identifiability.
        q = value + (advantage - advantage.mean(dim=1, keepdim=True))
        return q


# --------------------------------------------------------------------------- #
# Replay Buffer
# --------------------------------------------------------------------------- #
class ReplayBuffer:
    """Fixed-capacity experience replay with uniform sampling."""

    def __init__(self, capacity: int) -> None:
        self.buffer: Deque = deque(maxlen=capacity)

    def push(self, state, action, reward, next_state, done) -> None:
        self.buffer.append((state, action, reward, next_state, done))

    def sample(self, batch_size: int):
        batch = random.sample(self.buffer, batch_size)
        states, actions, rewards, next_states, dones = zip(*batch)
        return (
            np.array(states, dtype=np.float32),
            np.array(actions, dtype=np.int64),
            np.array(rewards, dtype=np.float32),
            np.array(next_states, dtype=np.float32),
            np.array(dones, dtype=np.float32),
        )

    def __len__(self) -> int:
        return len(self.buffer)


# --------------------------------------------------------------------------- #
# D3QN Agent
# --------------------------------------------------------------------------- #
class DQNAgent:
    """Dueling Double DQN agent."""

    def __init__(
        self,
        state_dim: int,
        action_dim: int,
        hidden_sizes: Tuple[int, int] = (128, 128),
        learning_rate: float = 5e-4,
        gamma: float = 0.99,
        epsilon_start: float = 1.0,
        epsilon_end: float = 0.05,
        epsilon_decay_steps: int = 20000,
        replay_capacity: int = 50000,
        batch_size: int = 64,
        target_update_freq: int = 500,
        tau: float = 0.0,          # >0 -> Polyak soft update; 0 -> hard copy
        double_dqn: bool = True,
        seed: int | None = None,
        device: str | None = None,
    ) -> None:
        self.state_dim = state_dim
        self.action_dim = action_dim
        self.gamma = gamma
        self.batch_size = batch_size
        self.target_update_freq = target_update_freq
        self.tau = tau
        self.double_dqn = double_dqn

        self.epsilon = epsilon_start
        self.epsilon_start = epsilon_start
        self.epsilon_end = epsilon_end
        self.epsilon_decay_steps = max(1, epsilon_decay_steps)

        if seed is not None:
            random.seed(seed)
            np.random.seed(seed)
            torch.manual_seed(seed)

        self.device = torch.device(
            device or ("cuda" if torch.cuda.is_available() else "cpu")
        )
        self.online = DuelingQNetwork(state_dim, action_dim, hidden_sizes).to(self.device)
        self.target = DuelingQNetwork(state_dim, action_dim, hidden_sizes).to(self.device)
        self.target.load_state_dict(self.online.state_dict())
        self.target.eval()

        self.optimizer = torch.optim.Adam(self.online.parameters(), lr=learning_rate)
        self.replay = ReplayBuffer(replay_capacity)
        self.learn_step = 0

    # ------------------------------------------------------------------ #
    def act(self, state: np.ndarray, greedy: bool = False) -> int:
        """Epsilon-greedy action selection."""
        if (not greedy) and random.random() < self.epsilon:
            return random.randrange(self.action_dim)
        with torch.no_grad():
            s = torch.as_tensor(state, dtype=torch.float32, device=self.device).unsqueeze(0)
            q = self.online(s)
            return int(q.argmax(dim=1).item())

    def remember(self, state, action, reward, next_state, done) -> None:
        self.replay.push(state, action, reward, next_state, done)

    def decay_epsilon(self) -> None:
        frac = min(1.0, self.learn_step / self.epsilon_decay_steps)
        self.epsilon = self.epsilon_start + frac * (self.epsilon_end - self.epsilon_start)

    def replay_update(self) -> float | None:
        """One gradient step on a sampled minibatch. Returns loss or None."""
        if len(self.replay) < self.batch_size:
            return None

        states, actions, rewards, next_states, dones = self.replay.sample(self.batch_size)
        states = torch.as_tensor(states, device=self.device)
        actions = torch.as_tensor(actions, device=self.device).unsqueeze(1)
        rewards = torch.as_tensor(rewards, device=self.device).unsqueeze(1)
        next_states = torch.as_tensor(next_states, device=self.device)
        dones = torch.as_tensor(dones, device=self.device).unsqueeze(1)

        # Current Q(s, a)
        q_values = self.online(states).gather(1, actions)

        with torch.no_grad():
            if self.double_dqn:
                # Online net picks the action; target net evaluates it.
                next_actions = self.online(next_states).argmax(dim=1, keepdim=True)
                next_q = self.target(next_states).gather(1, next_actions)
            else:
                next_q = self.target(next_states).max(dim=1, keepdim=True)[0]
            target_q = rewards + self.gamma * next_q * (1.0 - dones)

        loss = F.smooth_l1_loss(q_values, target_q)  # Huber loss

        self.optimizer.zero_grad()
        loss.backward()
        nn.utils.clip_grad_norm_(self.online.parameters(), max_norm=10.0)
        self.optimizer.step()

        self.learn_step += 1
        self.decay_epsilon()
        self._update_target()

        return float(loss.item())

    def _update_target(self) -> None:
        if self.tau > 0.0:
            # Polyak soft update every step.
            for tp, op in zip(self.target.parameters(), self.online.parameters()):
                tp.data.mul_(1.0 - self.tau).add_(self.tau * op.data)
        elif self.learn_step % self.target_update_freq == 0:
            # Hard copy periodically.
            self.target.load_state_dict(self.online.state_dict())

    # ------------------------------------------------------------------ #
    def save(self, path: str) -> None:
        torch.save(
            {
                "online": self.online.state_dict(),
                "target": self.target.state_dict(),
                "optimizer": self.optimizer.state_dict(),
                "epsilon": self.epsilon,
                "learn_step": self.learn_step,
            },
            path,
        )

    def load(self, path: str) -> None:
        ckpt = torch.load(path, map_location=self.device)
        self.online.load_state_dict(ckpt["online"])
        self.target.load_state_dict(ckpt["target"])
        self.optimizer.load_state_dict(ckpt["optimizer"])
        self.epsilon = ckpt.get("epsilon", self.epsilon)
        self.learn_step = ckpt.get("learn_step", 0)
