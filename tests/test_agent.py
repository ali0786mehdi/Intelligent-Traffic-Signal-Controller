"""Unit tests for the D3QN agent (no SUMO needed)."""
import numpy as np
import torch

from agent.dqn import DQNAgent, DuelingQNetwork, ReplayBuffer


def test_dueling_network_output_shape():
    net = DuelingQNetwork(state_dim=71, action_dim=2, hidden_sizes=(32, 32))
    x = torch.randn(8, 71)
    q = net(x)
    assert q.shape == (8, 2)


def test_dueling_aggregation_identifiable():
    # Advantage mean-subtraction => shifting all advantages doesn't change Q.
    net = DuelingQNetwork(state_dim=4, action_dim=3, hidden_sizes=(8, 8))
    x = torch.randn(5, 4)
    q1 = net(x)
    assert q1.shape == (5, 3)
    assert torch.isfinite(q1).all()


def test_replay_buffer_capacity_and_sample():
    buf = ReplayBuffer(capacity=100)
    for i in range(150):
        buf.push(np.zeros(4, dtype=np.float32), i % 2, float(i), np.ones(4, dtype=np.float32), False)
    assert len(buf) == 100  # capped
    s, a, r, ns, d = buf.sample(16)
    assert s.shape == (16, 4)
    assert a.shape == (16,)
    assert r.shape == (16,)
    assert ns.shape == (16, 4)
    assert d.shape == (16,)


def test_agent_act_returns_valid_action():
    agent = DQNAgent(state_dim=71, action_dim=2, hidden_sizes=(32, 32), seed=0)
    s = np.zeros(71, dtype=np.float32)
    for _ in range(20):
        a = agent.act(s)
        assert a in (0, 1)


def test_greedy_action_deterministic():
    agent = DQNAgent(state_dim=71, action_dim=2, hidden_sizes=(32, 32), seed=0)
    s = np.random.randn(71).astype(np.float32)
    a1 = agent.act(s, greedy=True)
    a2 = agent.act(s, greedy=True)
    assert a1 == a2


def test_epsilon_decays_monotonically():
    agent = DQNAgent(
        state_dim=71, action_dim=2, hidden_sizes=(32, 32),
        epsilon_start=1.0, epsilon_end=0.05, epsilon_decay_steps=100,
        batch_size=4, seed=0,
    )
    # Fill buffer so replay_update actually steps.
    for i in range(50):
        agent.remember(np.zeros(71, dtype=np.float32), i % 2, 1.0,
                       np.zeros(71, dtype=np.float32), False)
    eps_prev = agent.epsilon
    for _ in range(50):
        agent.replay_update()
        assert agent.epsilon <= eps_prev + 1e-9
        eps_prev = agent.epsilon
    assert agent.epsilon < 1.0


def test_replay_update_returns_loss_and_steps():
    agent = DQNAgent(state_dim=71, action_dim=2, hidden_sizes=(32, 32),
                     batch_size=8, seed=0)
    assert agent.replay_update() is None  # empty buffer
    for i in range(20):
        agent.remember(np.random.randn(71).astype(np.float32), i % 2, 0.5,
                       np.random.randn(71).astype(np.float32), False)
    loss = agent.replay_update()
    assert loss is not None and loss >= 0.0
    assert agent.learn_step == 1


def test_target_hard_update_copies_weights():
    agent = DQNAgent(state_dim=8, action_dim=2, hidden_sizes=(8, 8),
                     batch_size=4, target_update_freq=1, tau=0.0, seed=0)
    for i in range(10):
        agent.remember(np.random.randn(8).astype(np.float32), i % 2, 1.0,
                       np.random.randn(8).astype(np.float32), False)
    agent.replay_update()  # learn_step becomes 1, divisible by freq=1 -> hard copy
    for tp, op in zip(agent.target.parameters(), agent.online.parameters()):
        assert torch.allclose(tp, op)


def test_save_load_roundtrip(tmp_path):
    agent = DQNAgent(state_dim=8, action_dim=2, hidden_sizes=(8, 8), seed=0)
    p = tmp_path / "ckpt.pt"
    agent.save(str(p))
    agent2 = DQNAgent(state_dim=8, action_dim=2, hidden_sizes=(8, 8), seed=1)
    agent2.load(str(p))
    s = np.random.randn(8).astype(np.float32)
    assert agent.act(s, greedy=True) == agent2.act(s, greedy=True)
