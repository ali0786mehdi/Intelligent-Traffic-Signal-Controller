// A small microscopic traffic simulator that mirrors the repo's SUMO setup:
//   - network/intersection.net.xml: 4 arms, 2 incoming + 2 outgoing lanes each,
//     3.2 m lanes, 189.6 m incoming lanes ending 10.4 m from the junction centre,
//     right-hand traffic, lane 0 = outer (through + right), lane 1 = inner (through + left)
//   - permissive left turns (yield to opposing through/right traffic)
//   - IDM car following with the vType parameters from the route files
//   - SUMO-style per-lane waiting time (consecutive time below 0.1 m/s)
// It is a teaching mirror, not SUMO: there is no sublane model or lane changing.

import { VTYPES, SCENARIOS } from './data.js';

export const LANE_W = 3.2;
export const STOP = 10.4;          // stop line distance from junction centre
export const ARM = 200;            // edge length
export const LANE_LEN = 189.6;     // incoming / outgoing lane length
export const DT = 0.2;             // integration step (s)
export const DIRS = ['N', 'E', 'S', 'W'];
export const IN_LANES = [['N', 0], ['N', 1], ['S', 0], ['S', 1], ['E', 0], ['E', 1], ['W', 0], ['W', 1]]; // env INCOMING_LANES order

const U = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] }; // centre -> arm, in (x, z); north is -z
const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
const AXIS = { N: 'NS', S: 'NS', E: 'EW', W: 'EW' };
const right = (v) => [-v[1], v[0]];
const laneOffset = (idx) => LANE_W / 2 + LANE_W * (1 - idx);

export function inLanePoint(dir, idx, s) {
  const d = [-U[dir][0], -U[dir][1]];
  const r = right(d);
  const off = laneOffset(idx);
  return [U[dir][0] * ARM + r[0] * off + d[0] * s, U[dir][1] * ARM + r[1] * off + d[1] * s, d];
}

export function outLanePoint(dir, idx, s) {
  const e = U[dir];
  const r = right(e);
  const off = laneOffset(idx);
  return [e[0] * STOP + r[0] * off + e[0] * s, e[1] * STOP + r[1] * off + e[1] * s, e];
}

function movementOf(from, to) {
  if (OPP[from] === to) return 'T';
  const d = [-U[from][0], -U[from][1]];
  const r = right(d);
  return (U[to][0] === r[0] && U[to][1] === r[1]) ? 'R' : 'L';
}

// Junction paths: straight for through movements, cubic Bezier for turns.
const pathCache = new Map();
function junctionPath(from, li, to, lo) {
  const key = `${from}${li}${to}${lo}`;
  if (pathCache.has(key)) return pathCache.get(key);
  const [px, pz, d] = inLanePoint(from, li, LANE_LEN);
  const [qx, qz, e] = outLanePoint(to, lo, 0);
  const n = 28;
  const pts = [];
  const straight = OPP[from] === to;
  const k = 0.5523 * Math.abs((qx - px) * d[0] + (qz - pz) * d[1]);
  const c1 = [px + d[0] * k, pz + d[1] * k];
  const c2 = [qx - e[0] * k, qz - e[1] * k];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (straight) { pts.push([px + (qx - px) * t, pz + (qz - pz) * t]); continue; }
    const a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, w = t ** 3;
    pts.push([a * px + b * c1[0] + c * c2[0] + w * qx, a * pz + b * c1[1] + c * c2[1] + w * qz]);
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const p = { pts, cum, len: cum[cum.length - 1] };
  pathCache.set(key, p);
  return p;
}

function pathPoint(p, s) {
  s = Math.max(0, Math.min(p.len, s));
  let i = 1;
  while (i < p.cum.length - 1 && p.cum[i] < s) i++;
  const t = (s - p.cum[i - 1]) / Math.max(1e-6, p.cum[i] - p.cum[i - 1]);
  const a = p.pts[i - 1], b = p.pts[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, [b[0] - a[0], b[1] - a[1]]];
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let VID = 0;

export class TrafficSim {
  constructor(scenarioId, seed) {
    this.scenarioId = scenarioId;
    this.scenario = SCENARIOS[scenarioId];
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.time = 0;
    this.endTime = 3600;
    this.phase = 0;            // index into the 6-phase tls program
    this.phaseTime = 0;
    this.lanes = {};           // 'N0' -> [front ... back]
    for (const [d, i] of IN_LANES) this.lanes[d + i] = [];
    this.corridors = {};       // 'S0' -> vehicles in junction or on outgoing lane S_out_0
    for (const d of DIRS) { this.corridors[d + 0] = []; this.corridors[d + 1] = []; }
    this.pending = { N: [], E: [], S: [], W: [] };
    this.vehicles = [];
    this.arrived = 0;
    this.departed = 0;
    this.samples = { wait: [], queue: [] };
    this.history = [];         // [{t, wait, queue}] every 5 s, for the chart
    this.nextSample = 5;
    // SUMO flows with vehsPerHour are evenly spaced; the seed shifts each flow's phase.
    this.flows = this.scenario.flows.map((fl) => {
      const period = 3600 / fl.vph;
      return { ...fl, period, next: fl.begin + this.rng() * period };
    });
  }

  // ---- signal helpers -------------------------------------------------
  signalFor(dir) {
    const axis = AXIS[dir];
    const p = this.phase;
    if (axis === 'NS') return p === 0 ? 'G' : p === 1 ? 'Y' : 'R';
    return p === 3 ? 'G' : p === 4 ? 'Y' : 'R';
  }

  setPhase(p) {
    if (p !== this.phase) { this.phase = p; this.phaseTime = 0; }
  }

  // ---- measurement (mirrors env/traffic_env.py) -------------------------
  laneWaiting(key) {
    let w = 0;
    for (const v of this.lanes[key]) w += v.wait;
    return w;
  }
  laneHalting(key, pcu = false) {
    let q = 0;
    for (const v of this.lanes[key]) if (v.v < 0.1) q += pcu ? v.t.pcu : 1;
    return q;
  }
  totalWait() {
    let w = 0;
    for (const [d, i] of IN_LANES) w += this.laneWaiting(d + i);
    return w;
  }
  totalQueue() {
    let q = 0;
    for (const [d, i] of IN_LANES) q += this.laneHalting(d + i);
    return q;
  }

  // 71-dim state, same layout and normalisation as TrafficSignalEnv._get_state
  state(timeInGreen, minGreen = 10, pcu = !!this.scenario.pcu) {
    const NUM_CELLS = 3, LANE_LENGTH = 200, CELL = LANE_LENGTH / NUM_CELLS, MAXV = 13.89;
    const density = new Float32Array(24), speed = new Float32Array(24);
    const maxPerCell = Math.max(CELL / 7.5, 1);
    IN_LANES.forEach(([d, i], li) => {
      const counts = [0, 0, 0], sp = [0, 0, 0];
      for (const v of this.lanes[d + i]) {
        const c = Math.floor((LANE_LENGTH - v.s) / CELL);
        if (c >= 0 && c < NUM_CELLS) { counts[c] += 1; sp[c] += Math.min(v.v / MAXV, 1); }
      }
      for (let c = 0; c < 3; c++) {
        density[li * 3 + c] = Math.min(counts[c] / maxPerCell, 1);
        speed[li * 3 + c] = counts[c] > 0 ? sp[c] / counts[c] : 0;
      }
    });
    const out = new Float32Array(71);
    out.set(density, 0);
    out.set(speed, 24);
    IN_LANES.forEach(([d, i], li) => {
      out[48 + li] = Math.min(this.laneHalting(d + i, pcu), 20) / 20;
      out[56 + li] = Math.min(this.laneWaiting(d + i), 300) / 300;
    });
    out[64 + this.phase] = 1;
    out[70] = timeInGreen >= minGreen ? 1 : 0;
    for (let k = 0; k < 71; k++) out[k] = Math.min(1, Math.max(0, out[k]));
    return out;
  }

  metrics() {
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    return {
      avgWait: mean(this.samples.wait),
      avgQueue: mean(this.samples.queue),
      throughput: this.time > 0 ? (this.arrived / this.time) * 3600 : 0,
      arrived: this.arrived,
      onNetwork: this.vehicles.length,
      waitNow: this.totalWait(),
      queueNow: this.totalQueue(),
    };
  }

  get done() { return this.time >= this.endTime; }

  // ---- stepping -------------------------------------------------------
  step(dt = DT) {
    if (this.done) return;
    this.spawn();
    this.insert();
    this.move(dt);
    this.time += dt;
    this.phaseTime += dt;
    if (this.time + 1e-6 >= this.nextSample) {
      const w = this.totalWait(), q = this.totalQueue();
      this.samples.wait.push(w);
      this.samples.queue.push(q);
      this.history.push({ t: this.nextSample, wait: w, queue: q });
      this.nextSample += 5;
    }
  }

  spawn() {
    for (const fl of this.flows) {
      while (fl.next <= this.time && fl.next < fl.end) {
        this.pending[fl.from].push({ from: fl.from, to: fl.to, type: fl.type });
        fl.next += fl.period;
      }
    }
  }

  insert() {
    for (const d of DIRS) {
      const q = this.pending[d];
      let tries = 0;
      while (q.length && tries < 2) {
        tries++;
        const req = q[0];
        const t = VTYPES[req.type];
        const move = movementOf(req.from, req.to);
        let li;
        if (move === 'R') li = 0;
        else if (move === 'L') li = 1;
        else li = this.backGap(d + 0) >= this.backGap(d + 1) ? 0 : 1;
        const gap = this.backGap(d + li);
        if (gap < t.minGap + 0.5) break;
        const back = this.lanes[d + li][this.lanes[d + li].length - 1];
        let v = t.maxSpeed;
        if (back) v = Math.min(v, Math.max(0, (gap - t.minGap) / t.tau), back.v + 2);
        const lo = move === 'R' ? 0 : move === 'L' ? 1 : li;
        const path = junctionPath(req.from, li, req.to, lo);
        const veh = {
          id: VID++, t, type: req.type, from: req.from, to: req.to, move, li, lo, path,
          seg: 0, s: 0, v, acc: 0, wait: 0, waitTotal: 0,
          color: Math.floor(this.rng() * 1000), dawdle: 0,
        };
        this.lanes[d + li].push(veh);
        this.vehicles.push(veh);
        this.departed++;
        q.shift();
      }
    }
  }

  backGap(key) {
    const arr = this.lanes[key];
    if (!arr.length) return Infinity;
    const b = arr[arr.length - 1];
    return b.s - b.t.length;
  }

  distToExit(v) {
    if (v.seg === 0) return (LANE_LEN - v.s) + v.path.len + LANE_LEN;
    if (v.seg === 1) return (v.path.len - v.s) + LANE_LEN;
    return LANE_LEN - v.s;
  }

  // Is there opposing through/right traffic that a permissive left turner must yield to?
  leftConflict(v) {
    const o = OPP[v.from];
    const oSig = this.signalFor(o);
    if (oSig !== 'R') {
      for (const i of [0, 1]) {
        const ov = this.lanes[o + i][0];
        if (!ov || ov.move === 'L') continue; // an opposing left turner blocks its own lane
        const dist = LANE_LEN - ov.s;
        if (ov.v > 1.0 && dist < ov.v * 4.0 + 4) return true;
        if (oSig === 'G' && dist < 6) return true; // queued at the line, about to pull away
      }
    }
    for (const key of [v.to + 0, v.from + 0, v.from + 1]) {
      for (const ov of this.corridors[key] || []) {
        if (ov.seg === 1 && ov.from === o && ov.move !== 'L' && ov.s < ov.path.len * 0.8) return true;
      }
    }
    return false;
  }

  idm(v, gap, leadV, v0) {
    const t = v.t;
    const a = t.accel, b = t.decel;
    const sStar = t.minGap + Math.max(0, v.v * t.tau + (v.v * (v.v - leadV)) / (2 * Math.sqrt(a * b)));
    const free = 1 - Math.pow(v.v / Math.max(v0, 0.1), 4);
    const inter = gap < 1e5 ? Math.pow(sStar / Math.max(gap, 0.05), 2) : 0;
    return Math.max(-9, a * (free - inter));
  }

  move(dt) {
    // Sort corridors front-first by remaining distance.
    for (const k in this.corridors) this.corridors[k].sort((a, b) => this.distToExit(a) - this.distToExit(b));

    for (const v of this.vehicles) {
      let gap = Infinity, leadV = 0;
      let v0 = v.t.maxSpeed;
      const turnV = v.move === 'R' ? 5.5 : v.move === 'L' ? 7.0 : v.t.maxSpeed;

      if (v.seg === 0) {
        const arr = this.lanes[v.from + v.li];
        const k = arr.indexOf(v);
        const toLine = LANE_LEN - v.s;
        if (v.move !== 'T' && toLine < Math.max(0, (v.v * v.v - turnV * turnV) / 3.0) + 8) v0 = Math.min(v0, turnV);
        if (k > 0) {
          const L = arr[k - 1];
          gap = L.s - L.t.length - v.s; leadV = L.v;
        } else {
          // signal
          const sig = this.signalFor(v.from);
          let mustStop = sig === 'R';
          if (sig === 'Y') {
            if (v.committed === undefined || v.committedAt !== this.phase) {
              v.committed = toLine < (v.v * v.v) / (2 * v.t.decel * 0.9) + 0.3;
              v.committedAt = this.phase;
            }
            mustStop = !v.committed;
          }
          if (sig === 'R' && toLine < 0.4 && v.v > 3) mustStop = false; // already over the line
          if (mustStop) { gap = toLine - 0.3 + v.t.minGap; leadV = 0; }
          // corridor leader (vehicles already in the junction / on the exit lane)
          const corr = this.corridors[v.to + v.lo];
          if (corr.length) {
            const L = corr[corr.length - 1];
            const g = this.distToExit(v) - this.distToExit(L) - L.t.length;
            if (g < gap) { gap = g; leadV = L.v; }
          }
        }
      } else {
        const corr = this.corridors[v.to + v.lo];
        const k = corr.indexOf(v);
        if (v.seg === 1) v0 = Math.min(v0, turnV);
        if (k > 0) {
          const L = corr[k - 1];
          gap = this.distToExit(v) - this.distToExit(L) - L.t.length; leadV = L.v;
        }
        if (v.seg === 1 && v.move === 'L') {
          const yieldS = v.path.len * 0.42;
          const sig = this.signalFor(v.from);
          if (v.s < yieldS && sig === 'G' && this.leftConflict(v)) {
            const g = yieldS - v.s + v.t.minGap;
            if (g < gap) { gap = g; leadV = 0; }
          }
        }
      }

      let acc = this.idm(v, gap, leadV, v0);
      // SUMO-style dawdling (sigma) applied to the desired speed
      if (v.v > 0.5 && this.rng() < 0.15) acc -= v.t.sigma * v.t.accel * this.rng();
      v.acc = acc;
      let nv = v.v + acc * dt;
      if (nv < 0) nv = 0;
      v.s += (v.v + nv) * 0.5 * dt;
      v.v = nv;
      if (v.v < 0.1) { v.wait += dt; v.waitTotal += dt; } else v.wait = 0;
    }

    // segment transitions
    const keep = [];
    for (const v of this.vehicles) {
      if (v.seg === 0 && v.s >= LANE_LEN) {
        const arr = this.lanes[v.from + v.li];
        const k = arr.indexOf(v); if (k >= 0) arr.splice(k, 1);
        v.s -= LANE_LEN; v.seg = 1; v.wait = 0;
        this.corridors[v.to + v.lo].push(v);
      }
      if (v.seg === 1 && v.s >= v.path.len) { v.s -= v.path.len; v.seg = 2; }
      if (v.seg === 2 && v.s >= LANE_LEN) {
        const corr = this.corridors[v.to + v.lo];
        const k = corr.indexOf(v); if (k >= 0) corr.splice(k, 1);
        this.arrived++;
        continue;
      }
      keep.push(v);
    }
    this.vehicles = keep;
  }

  // World-space pose of a vehicle's centre: [x, z, heading(rad)]
  pose(v) {
    const half = v.t.length / 2;
    let seg = v.seg, s = v.s - half;
    if (seg === 2 && s < 0) { seg = 1; s += v.path.len; }
    if (seg === 1 && s < 0) { seg = 0; s += LANE_LEN; }
    let x, z, dx, dz;
    if (seg === 0) { const p = inLanePoint(v.from, v.li, Math.max(0, s)); x = p[0]; z = p[1]; dx = p[2][0]; dz = p[2][1]; }
    else if (seg === 1) { const p = pathPoint(v.path, s); x = p[0]; z = p[1]; dx = p[2][0]; dz = p[2][1]; }
    else { const p = outLanePoint(v.to, v.lo, s); x = p[0]; z = p[1]; dx = p[2][0]; dz = p[2][1]; }
    return [x, z, Math.atan2(dx, dz)];
  }
}
