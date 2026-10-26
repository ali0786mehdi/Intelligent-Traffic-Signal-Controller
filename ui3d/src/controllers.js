// Signal controllers. Each drives sim.phase through the 6-phase program in
// network/tls.add.xml:  0 NS green · 1 NS yellow · 2 all red · 3 EW green · 4 EW yellow · 5 all red

const DUR = [35, 3, 2, 35, 3, 2];

export class StaticController {
  constructor() { this.id = 'static'; }
  update(sim) {
    if (sim.phaseTime + 1e-6 >= DUR[sim.phase]) sim.setPhase((sim.phase + 1) % 6);
  }
  info(sim) { return { remaining: Math.max(0, DUR[sim.phase] - sim.phaseTime) }; }
}

// Gap-based actuation, as SUMO's type="actuated" with max-gap 3 s and
// detectors 2 s (at 13.89 m/s) upstream of the stop line. minDur 10, maxDur 60.
export class ActuatedController {
  constructor() {
    this.id = 'actuated';
    this.lastDetect = -1e9;
    this.detectorS = 189.6 - 2.0 * 13.89;
  }
  detecting(sim, dirs) {
    for (const d of dirs) for (const i of [0, 1]) {
      for (const v of sim.lanes[d + i]) {
        if (v.s >= this.detectorS && v.s - v.t.length <= this.detectorS) return true;
      }
    }
    return false;
  }
  update(sim) {
    const p = sim.phase;
    if (p === 0 || p === 3) {
      const dirs = p === 0 ? ['N', 'S'] : ['E', 'W'];
      if (sim.phaseTime < 0.21) this.lastDetect = sim.time;
      if (this.detecting(sim, dirs)) this.lastDetect = sim.time;
      const gap = sim.time - this.lastDetect;
      if (sim.phaseTime >= 60 || (sim.phaseTime >= 10 && gap > 3.0)) sim.setPhase(p + 1);
    } else if (sim.phaseTime + 1e-6 >= DUR[p]) {
      sim.setPhase((p + 1) % 6);
    }
  }
  info(sim) {
    const p = sim.phase;
    if (p === 0 || p === 3) return { gap: sim.time - this.lastDetect, maxLeft: 60 - sim.phaseTime, minLeft: Math.max(0, 10 - sim.phaseTime) };
    return { remaining: Math.max(0, DUR[p] - sim.phaseTime) };
  }
}

// ---------------------------------------------------------------------------
// D3QN policy
// With a checkpoint exported by ui3d/tools/export_weights.py the controller
// runs the real dueling network (agent/dqn.py: trunk 71→128→128, value and
// advantage heads 128→128→1 / 128→128→2, Q = V + A − mean(A)).
// Without one, it runs a transparent stand-in that scores each axis from the
// same 71 state values. The UI labels which one is active.
// ---------------------------------------------------------------------------

function linear(W, b, x) {
  const out = new Float32Array(W.length);
  for (let i = 0; i < W.length; i++) {
    const row = W[i];
    let s = b[i];
    for (let j = 0; j < row.length; j++) s += row[j] * x[j];
    out[i] = s;
  }
  return out;
}
const relu = (x) => { for (let i = 0; i < x.length; i++) if (x[i] < 0) x[i] = 0; return x; };

function decodeTensors(json) {
  if (json.tensors) {
    const out = {};
    for (const [k, t] of Object.entries(json.tensors)) {
      const bin = typeof atob === 'function' ? atob(t.b64) : Buffer.from(t.b64, 'base64').toString('binary');
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const flat = new Float32Array(bytes.buffer);
      if (t.shape.length === 1) out[k] = flat;
      else {
        const [rows, cols] = t.shape;
        out[k] = Array.from({ length: rows }, (_, r) => flat.subarray(r * cols, (r + 1) * cols));
      }
    }
    return out;
  }
  return json.weights || json;
}

export function makeNetwork(json) {
  const w = decodeTensors(json);
  const need = ['trunk.0.weight', 'trunk.2.weight', 'value_head.0.weight', 'value_head.2.weight', 'advantage_head.0.weight', 'advantage_head.2.weight'];
  for (const k of need) if (!w[k]) throw new Error(`Missing tensor "${k}" in weights file`);
  if (w['trunk.0.weight'][0].length !== 71) throw new Error(`Network expects ${w['trunk.0.weight'][0].length} inputs, the environment state has 71`);
  return (x) => {
    const h = relu(linear(w['trunk.2.weight'], w['trunk.2.bias'], relu(linear(w['trunk.0.weight'], w['trunk.0.bias'], x))));
    const v = linear(w['value_head.2.weight'], w['value_head.2.bias'], relu(linear(w['value_head.0.weight'], w['value_head.0.bias'], h)))[0];
    const a = linear(w['advantage_head.2.weight'], w['advantage_head.2.bias'], relu(linear(w['advantage_head.0.weight'], w['advantage_head.0.bias'], h)));
    const mean = (a[0] + a[1]) / 2;
    return [v + a[0] - mean, v + a[1] - mean];
  };
}

// Axis pressure from the state vector: queued vehicles, vehicles in the cell
// nearest the stop line, and accumulated waiting time.
function standInQ(state, currentAxis) {
  const lanesOf = (axis) => (axis === 0 ? [0, 1, 2, 3] : [4, 5, 6, 7]);
  const pressure = (axis) => {
    let p = 0;
    for (const li of lanesOf(axis)) {
      p += state[48 + li] * 20;               // queue (veh)
      p += state[li * 3] * 8.9 * 0.6;         // density, nearest cell
      p += (state[56 + li] * 300) / 15;       // waiting seconds
    }
    return p;
  };
  const switchCost = 4;
  const q = [pressure(0), pressure(1)];
  q[1 - currentAxis] -= switchCost;
  return q.map((x) => x / 10);
}

export class DQNController {
  constructor(cfg = {}) {
    this.id = 'dqn';
    this.minGreen = 10; this.yellow = 3; this.allRed = 2; this.interval = 5;
    this.net = cfg.net || null;
    this.netName = cfg.netName || null;
    this.currentGreen = 0;      // 0 = NS green phase, 3 = EW green phase
    this.timeInGreen = 0;
    this.prevAction = 0;
    this.prevWait = 0;
    this.nextDecision = 0;
    this.schedule = [];         // [{t, phase}]
    this.q = [0, 0];
    this.lastState = new Float32Array(71);
    this.reward = null;
    this.log = [];
    this.decisions = 0;
  }

  update(sim) {
    while (this.schedule.length && sim.time + 1e-6 >= this.schedule[0].t) sim.setPhase(this.schedule.shift().phase);
    if (sim.time + 1e-6 < this.nextDecision) return;
    this.decide(sim);
  }

  decide(sim) {
    const t = sim.time;
    const state = sim.state(this.timeInGreen, this.minGreen);
    this.lastState = state;

    // reward for the previous step, exactly as env/reward.py
    const pcu = !!sim.scenario.pcu;
    let qsum = 0;
    for (const k of Object.keys(sim.lanes)) qsum += sim.laneHalting(k, pcu);
    const curWait = sim.totalWait();
    if (this.decisions > 0) {
      const wt = this.prevWait - curWait;
      const sw = this.lastAction !== this.prevAction ? -0.5 : 0;
      const qp = -0.1 * qsum;
      this.reward = { wait: wt, switch: sw, queue: qp, total: Math.max(-10, Math.min(10, wt + sw + qp)) };
      this.prevAction = this.lastAction;
    }
    this.prevWait = curWait;

    const axis = this.currentGreen === 0 ? 0 : 1;
    this.q = this.net ? this.net(state) : standInQ(state, axis);
    const action = this.q[1] > this.q[0] ? 1 : 0;
    const target = action === 0 ? 0 : 3;
    this.lastAction = action;
    this.decisions++;

    let note;
    if (target !== this.currentGreen && this.timeInGreen >= this.minGreen) {
      const yellow = this.currentGreen === 0 ? 1 : 4;
      const red = this.currentGreen === 0 ? 2 : 5;
      sim.setPhase(yellow);
      this.schedule = [{ t: t + this.yellow, phase: red }, { t: t + this.yellow + this.allRed, phase: target }];
      this.currentGreen = target;
      this.timeInGreen = 0;
      this.nextDecision = t + this.yellow + this.allRed + this.interval;
      note = { kind: 'switch', text: `Switch to ${action === 0 ? 'NS' : 'EW'}` };
    } else if (target !== this.currentGreen) {
      this.timeInGreen += this.interval;
      this.nextDecision = t + this.interval;
      note = { kind: 'blocked', text: `Wants ${action === 0 ? 'NS' : 'EW'}, min green not reached` };
    } else {
      this.timeInGreen += this.interval;
      this.nextDecision = t + this.interval;
      note = { kind: 'hold', text: `Hold ${action === 0 ? 'NS' : 'EW'}` };
    }
    this.log.unshift({ t, action, q: [...this.q], ...note });
    if (this.log.length > 7) this.log.pop();
  }

  info() {
    return { q: this.q, timeInGreen: this.timeInGreen, minGreen: this.minGreen, reward: this.reward, log: this.log, next: this.nextDecision };
  }
}

export function makeController(id, cfg) {
  if (id === 'static') return new StaticController();
  if (id === 'actuated') return new ActuatedController();
  return new DQNController(cfg);
}
