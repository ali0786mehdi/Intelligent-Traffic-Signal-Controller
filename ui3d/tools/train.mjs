// Train a Dueling Double DQN on the browser traffic mirror, with the repo's
// hyperparameters (config.yaml / agent/dqn.py):
//   trunk 71→128→128, value 128→128→1, advantage 128→128→2, Q = V + A − mean(A)
//   Adam lr 5e-4, γ 0.99, ε 1.0→0.05 linear over 3500 learn steps,
//   replay 50k, batch 64, hard target copy every 500 learn steps,
//   Huber loss, global grad-norm clip 10, Double-DQN targets.
// Reward and state come from the same code the UI runs (src/controllers.js, src/sim.js).
//
//   node tools/train.mjs <scenario> [episodes=120] [episodeSeconds=900] [seed=7]
// Writes src/weights/<scenario>.json in the same tensor layout as a PyTorch
// state_dict exported by tools/export_weights.py.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TrafficSim, mulberry32 } from '../src/sim.js';
import { DQNController, makeController, makeNetwork } from '../src/controllers.js';

const [scenario = 'balanced', EPISODES = '120', EP_SECONDS = '900', SEED = '7'] = process.argv.slice(2);
const H = 128, S = 71, A = 2;
const rng = mulberry32(Number(SEED));
const randn = () => { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
void randn;

// ---- parameters --------------------------------------------------------
const LAYERS = [
  ['trunk.0', S, H], ['trunk.2', H, H],
  ['value_head.0', H, H], ['value_head.2', H, 1],
  ['advantage_head.0', H, H], ['advantage_head.2', H, A],
];
function initParams() {
  const p = {};
  for (const [name, inp, out] of LAYERS) {
    const bound = 1 / Math.sqrt(inp); // PyTorch nn.Linear default init
    const W = new Float32Array(out * inp), b = new Float32Array(out);
    for (let i = 0; i < W.length; i++) W[i] = (rng() * 2 - 1) * bound;
    for (let i = 0; i < b.length; i++) b[i] = (rng() * 2 - 1) * bound;
    p[name] = { W, b, inp, out };
  }
  return p;
}
const cloneParams = (p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { ...v, W: v.W.slice(), b: v.b.slice() }]));
const zerosLike = (p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { ...v, W: new Float32Array(v.W.length), b: new Float32Array(v.b.length) }]));

function lin(L, x, out, relu) {
  const { W, b, inp, out: n } = L;
  for (let i = 0; i < n; i++) {
    let s = b[i]; const o = i * inp;
    for (let j = 0; j < inp; j++) s += W[o + j] * x[j];
    out[i] = relu && s < 0 ? 0 : s;
  }
  return out;
}
function forward(p, x, cache) {
  const c = cache || { h1: new Float32Array(H), h2: new Float32Array(H), v1: new Float32Array(H), a1: new Float32Array(H), v: new Float32Array(1), a: new Float32Array(A) };
  lin(p['trunk.0'], x, c.h1, true);
  lin(p['trunk.2'], c.h1, c.h2, true);
  lin(p['value_head.0'], c.h2, c.v1, true);
  lin(p['value_head.2'], c.v1, c.v, false);
  lin(p['advantage_head.0'], c.h2, c.a1, true);
  lin(p['advantage_head.2'], c.a1, c.a, false);
  const m = (c.a[0] + c.a[1]) / 2;
  c.q = [c.v[0] + c.a[0] - m, c.v[0] + c.a[1] - m];
  return c;
}
// accumulate grads of a linear layer: dy -> dW, db, dx (masked by relu of x if needed)
function backLin(L, G, x, dy, dx) {
  const { W, inp, out } = L;
  if (dx) dx.fill(0);
  for (let i = 0; i < out; i++) {
    const g = dy[i]; if (g === 0) continue;
    const o = i * inp;
    G.b[i] += g;
    for (let j = 0; j < inp; j++) { G.W[o + j] += g * x[j]; if (dx) dx[j] += g * W[o + j]; }
  }
}
const reluMask = (d, h) => { for (let i = 0; i < d.length; i++) if (h[i] <= 0) d[i] = 0; return d; };

// ---- Adam ----------------------------------------------------------------
const LR = 5e-4, B1 = 0.9, B2 = 0.999, EPS = 1e-8;
let adamT = 0;
function adamStep(p, g, m, v) {
  adamT++;
  // global grad-norm clip 10
  let n2 = 0;
  for (const k in g) { for (const x of g[k].W) n2 += x * x; for (const x of g[k].b) n2 += x * x; }
  const norm = Math.sqrt(n2), scale = norm > 10 ? 10 / (norm + 1e-6) : 1;
  const bc1 = 1 - B1 ** adamT, bc2 = 1 - B2 ** adamT;
  for (const k in p) for (const f of ['W', 'b']) {
    const P = p[k][f], Gk = g[k][f], M = m[k][f], V = v[k][f];
    for (let i = 0; i < P.length; i++) {
      const gi = Gk[i] * scale;
      M[i] = B1 * M[i] + (1 - B1) * gi;
      V[i] = B2 * V[i] + (1 - B2) * gi * gi;
      P[i] -= (LR * (M[i] / bc1)) / (Math.sqrt(V[i] / bc2) + EPS);
    }
  }
}

// ---- agent -----------------------------------------------------------------
const online = initParams();
let target = cloneParams(online);
const grads = zerosLike(online), mAdam = zerosLike(online), vAdam = zerosLike(online);
const CAP = 50000, BATCH = 64, GAMMA = 0.99, TARGET_EVERY = 500, DECAY = 3500;
const buf = { s: new Float32Array(CAP * S), a: new Uint8Array(CAP), r: new Float32Array(CAP), s2: new Float32Array(CAP * S), d: new Uint8Array(CAP), n: 0, i: 0 };
let learnStep = 0, epsilon = 1.0;

function remember(s, a, r, s2, d) {
  buf.s.set(s, buf.i * S); buf.s2.set(s2, buf.i * S);
  buf.a[buf.i] = a; buf.r[buf.i] = r; buf.d[buf.i] = d ? 1 : 0;
  buf.i = (buf.i + 1) % CAP; buf.n = Math.min(CAP, buf.n + 1);
}

const cA = forward(online, new Float32Array(S));
const cB = forward(online, new Float32Array(S));
const cT = forward(online, new Float32Array(S));
const dH2 = new Float32Array(H), dV1 = new Float32Array(H), dA1 = new Float32Array(H), dH1 = new Float32Array(H), tmp = new Float32Array(H);

function learn() {
  if (buf.n < BATCH) return null;
  for (const k in grads) { grads[k].W.fill(0); grads[k].b.fill(0); }
  let loss = 0;
  for (let n = 0; n < BATCH; n++) {
    const idx = Math.floor(rng() * buf.n);
    const s = buf.s.subarray(idx * S, idx * S + S), s2 = buf.s2.subarray(idx * S, idx * S + S);
    const a = buf.a[idx];
    forward(online, s2, cB);
    const a2 = cB.q[1] > cB.q[0] ? 1 : 0;
    forward(target, s2, cT);
    const y = buf.r[idx] + GAMMA * cT.q[a2] * (1 - buf.d[idx]);
    forward(online, s, cA);
    const diff = cA.q[a] - y;
    const ad = Math.abs(diff);
    loss += ad < 1 ? 0.5 * diff * diff : ad - 0.5;
    const g = (ad < 1 ? diff : Math.sign(diff)) / BATCH;
    // dQ_a/dV = 1 ; dQ_a/dA_j = δ_aj − 1/2
    const dv = [g], da = [g * ((a === 0 ? 1 : 0) - 0.5), g * ((a === 1 ? 1 : 0) - 0.5)];
    backLin(online['value_head.2'], grads['value_head.2'], cA.v1, dv, dV1); reluMask(dV1, cA.v1);
    backLin(online['advantage_head.2'], grads['advantage_head.2'], cA.a1, da, dA1); reluMask(dA1, cA.a1);
    backLin(online['value_head.0'], grads['value_head.0'], cA.h2, dV1, dH2);
    backLin(online['advantage_head.0'], grads['advantage_head.0'], cA.h2, dA1, tmp);
    for (let i = 0; i < H; i++) dH2[i] += tmp[i];
    reluMask(dH2, cA.h2);
    backLin(online['trunk.2'], grads['trunk.2'], cA.h1, dH2, dH1); reluMask(dH1, cA.h1);
    backLin(online['trunk.0'], grads['trunk.0'], s, dH1, null);
  }
  adamStep(online, grads, mAdam, vAdam);
  learnStep++;
  epsilon = 1.0 + Math.min(1, learnStep / DECAY) * (0.05 - 1.0);
  if (learnStep % TARGET_EVERY === 0) target = cloneParams(online);
  return loss / BATCH;
}

// ---- episode loop (env.step semantics live in DQNController.decide) --------
function runEpisode(seed, seconds, train) {
  const sim = new TrafficSim(scenario, seed);
  sim.endTime = seconds;
  const c = new DQNController();
  let prev = null, epR = 0, losses = 0, nl = 0;
  c.net = (state) => {
    if (prev && train) {
      remember(prev.s, prev.a, c.reward.total, state, false);
      const l = learn(); if (l !== null) { losses += l; nl++; }
    }
    if (c.reward) epR += c.reward.total;
    let a;
    if (train && rng() < epsilon) a = rng() < 0.5 ? 0 : 1;
    else { const q = forward(online, state, cA).q; a = q[1] > q[0] ? 1 : 0; }
    prev = { s: state.slice(), a };
    return a === 0 ? [1, 0] : [0, 1];
  };
  while (!sim.done) { c.update(sim); sim.step(); }
  // terminal transition (env reports truncated -> stored as done)
  if (train && prev) {
    c.net = () => [0, 0];
    const savedNet = c.net;
    c.decide(sim); void savedNet;
    remember(prev.s, prev.a, c.reward.total, c.lastState, true);
    const l = learn(); if (l !== null) { losses += l; nl++; }
  }
  return { reward: epR, wait: sim.metrics().avgWait, loss: nl ? losses / nl : 0 };
}

function evaluate(seconds = 1200) {
  const out = {};
  for (const id of ['static', 'actuated', 'dqn']) {
    let w = 0;
    for (const seed of [101, 102, 103]) {
      const sim = new TrafficSim(scenario, seed);
      sim.endTime = seconds;
      const c = id === 'dqn' ? new DQNController({ net: (s) => forward(online, s, cA).q.slice() }) : makeController(id);
      while (!sim.done) { c.update(sim); sim.step(); }
      w += sim.metrics().avgWait;
    }
    out[id] = w / 3;
  }
  return out;
}

const t0 = Date.now();
let best = { wait: Infinity, params: null, ep: 0 };
const curve = [];
for (let ep = 1; ep <= Number(EPISODES); ep++) {
  const r = runEpisode(Number(SEED) * 1000 + ep, Number(EP_SECONDS), true);
  curve.push({ ep, reward: +r.reward.toFixed(2), wait: +r.wait.toFixed(2), epsilon: +epsilon.toFixed(3), loss: +r.loss.toFixed(4) });
  if (ep % 10 === 0 || ep === 1) {
    console.log(`[${scenario}] ep ${ep} R=${r.reward.toFixed(1)} wait=${r.wait.toFixed(1)} eps=${epsilon.toFixed(2)} loss=${r.loss.toFixed(3)} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  if (ep >= 40 && ep % 10 === 0) {
    const e = evaluate(1200);
    console.log(`[${scenario}]   eval static ${e.static.toFixed(1)} actuated ${e.actuated.toFixed(1)} dqn ${e.dqn.toFixed(1)}`);
    if (e.dqn < best.wait) best = { wait: e.dqn, params: cloneParams(online), ep, eval: e };
  }
}

// ---- export (PyTorch state_dict layout, float32 base64) --------------------
const toB64 = (f32) => Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength).toString('base64');
const p = best.params || online;
const tensors = {};
for (const [name, inp, out] of LAYERS) {
  tensors[`${name}.weight`] = { shape: [out, inp], b64: toB64(p[name].W) };
  tensors[`${name}.bias`] = { shape: [out], b64: toB64(p[name].b) };
}
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..', 'src', 'weights');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${scenario}.json`), JSON.stringify({
  format: 'd3qn-f32-b64', scenario, state_dim: S, action_dim: A,
  trained_on: 'ui3d browser traffic mirror (not SUMO)',
  episodes: Number(EPISODES), episode_seconds: Number(EP_SECONDS), seed: Number(SEED),
  best_episode: best.ep, eval_1200s_3seeds: best.eval, curve, tensors,
}));
console.log(`[${scenario}] saved best ep ${best.ep}`, best.eval, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
void makeNetwork;
