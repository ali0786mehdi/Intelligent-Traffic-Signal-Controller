import './style.css';
import { TrafficSim, DT } from './sim.js';
import { makeController, makeNetwork } from './controllers.js';
import { IntersectionScene } from './scene.js';
import { SCENARIOS, SCENARIO_ORDER, REPORTED, PHASES, CONTROLLERS } from './data.js';
import wBalanced from './weights/balanced.json';
import wAsymmetric from './weights/asymmetric.json';
import wSurge from './weights/surge.json';
import wHetero from './weights/hetero.json';

const WEIGHTS = { balanced: wBalanced, asymmetric: wAsymmetric, surge: wSurge, hetero: wHetero };
const NETS = {};
const netFor = (id) => (NETS[id] ||= makeNetwork(WEIGHTS[id]));
const COLORS = { static: 'var(--c-static)', actuated: 'var(--c-actuated)', dqn: 'var(--c-dqn)' };
const HEX = { static: '#ff8a6b', actuated: '#efbf32', dqn: '#45d8c4' };
const SPEEDS = [1, 5, 20, 60];
const VIEWS = [['overview', 'Overview'], ['street', 'Street'], ['plan', 'Plan']];

const $ = (id) => document.getElementById(id);
const app = $('app');
const fmtClock = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–');

const S = {
  scenario: 'asymmetric',
  seed: (Math.random() * 1e9) | 0,
  speed: 5,
  playing: true,
  watched: 'dqn',
  agentView: false,
  runs: {},
  custom: null,          // { net, name } user-loaded checkpoint
  qWindow: [],
  surgeShown: false,
  finished: false,
};

// ----------------------------------------------------------------- scene
const scene = new IntersectionScene($('stage'));
new ResizeObserver(() => scene.resize()).observe($('stage'));

function start() {
  S.runs = {};
  for (const c of CONTROLLERS) {
    const sim = new TrafficSim(S.scenario, S.seed);
    const cfg = c.id === 'dqn' ? { net: S.custom ? S.custom.net : netFor(S.scenario) } : undefined;
    S.runs[c.id] = { sim, ctl: makeController(c.id, cfg) };
  }
  S.acc = 0;
  S.qWindow = [];
  S.surgeShown = false;
  S.finished = false;
  app.classList.remove('surging');
  $('surgeMark').hidden = !SCENARIOS[S.scenario].surgeAt;
  buildCabinetDetail();
  renderBoard();
  tickUI(true);
}

// ------------------------------------------------------------ controls
function segmented(el, items, current, onPick) {
  el.innerHTML = '';
  for (const [value, label] of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.textContent = label;
    b.dataset.value = value;
    b.setAttribute('aria-checked', String(value === current));
    b.addEventListener('click', () => {
      for (const x of el.children) x.setAttribute('aria-checked', String(x === b));
      onPick(value);
    });
    el.appendChild(b);
  }
  // arrow-key movement inside a radiogroup
  el.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const kids = [...el.children];
    const i = kids.indexOf(document.activeElement);
    if (i < 0) return;
    const n = kids[(i + (e.key === 'ArrowRight' ? 1 : kids.length - 1)) % kids.length];
    n.focus(); n.click(); e.preventDefault();
  });
}

segmented($('scenarioSeg'), SCENARIO_ORDER.map((k) => [k, SCENARIOS[k].label]), S.scenario, (v) => {
  S.scenario = v; S.seed = (Math.random() * 1e9) | 0;
  $('scenarioBlurb').textContent = SCENARIOS[v].blurb;
  start();
});
$('scenarioBlurb').textContent = SCENARIOS[S.scenario].blurb;
segmented($('speedSeg'), SPEEDS.map((s) => [s, `${s}×`]), S.speed, (v) => { S.speed = v; });
segmented($('viewSeg'), VIEWS, 'overview', (v) => { scene.setView(v); if (S.agentView && v !== 'plan') { /* keep overlay */ } });

function setPlaying(p) {
  S.playing = p;
  app.classList.toggle('paused', !p);
  $('playBtn').setAttribute('aria-label', p ? 'Pause' : 'Play');
}
$('playBtn').addEventListener('click', () => {
  if (S.finished) { S.seed = (Math.random() * 1e9) | 0; start(); setPlaying(true); return; }
  setPlaying(!S.playing);
});
$('restartBtn').addEventListener('click', () => { S.seed = (Math.random() * 1e9) | 0; start(); setPlaying(true); toast('New traffic seed. All three controllers restart on the same demand.'); });

$('agentToggle').addEventListener('click', () => {
  S.agentView = !S.agentView;
  $('agentToggle').setAttribute('aria-pressed', String(S.agentView));
  $('agentToggle').querySelector('span').textContent = S.agentView ? 'Hide the painted state' : 'Paint the state on the road';
  scene.setOverlay(S.agentView);
  if (S.agentView) {
    scene.setView('agent');
    for (const x of $('viewSeg').children) x.setAttribute('aria-checked', 'false');
  }
});

const boardOpen = (open) => {
  $('board').hidden = !open;
  document.querySelector('.cabinet').hidden = open && window.matchMedia('(min-width: 901px)').matches;
  $('boardBtn').setAttribute('aria-expanded', String(open));
  if (open) $('boardClose').focus();
};
$('boardBtn').addEventListener('click', () => boardOpen($('board').hidden));
$('boardClose').addEventListener('click', () => { boardOpen(false); $('boardBtn').focus(); });

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  if (e.key === 'Escape' && !$('board').hidden) { boardOpen(false); $('boardBtn').focus(); }
  if (e.target.closest('button') && (e.key === ' ' || e.key === 'Enter')) return;
  if (e.key === ' ') { e.preventDefault(); $('playBtn').click(); }
  if (['1', '2', '3'].includes(e.key)) pickWatched(CONTROLLERS[Number(e.key) - 1].id);
  if (e.key.toLowerCase() === 'a') $('agentToggle').click();
});

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
}

// ------------------------------------------------------------ race rows
const raceRows = $('raceRows');
const racers = {};
for (const c of CONTROLLERS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'racer';
  b.setAttribute('role', 'radio');
  b.style.setProperty('--k', COLORS[c.id]);
  b.innerHTML = `<span class="key" aria-hidden="true"></span>
    <span class="name">${c.label}<span class="tag">In view</span></span>
    <span class="sub">${c.note}<span class="mono stats">queue – · – veh/h</span></span>
    <span class="val"><b>–</b><span>avg wait s</span></span>`;
  b.addEventListener('click', () => pickWatched(c.id));
  raceRows.appendChild(b);
  racers[c.id] = b;
}
function pickWatched(id) {
  S.watched = id;
  buildCabinetDetail();
  tickUI(true);
}

// ------------------------------------------------------------- cabinet
const phasesEl = $('phases');
PHASES.forEach((p) => {
  const li = document.createElement('li');
  li.className = p.kind;
  li.innerHTML = `<i></i><span>${p.kind === 'green' ? p.short : p.kind === 'yellow' ? 'Y' : 'R'}</span>`;
  li.title = p.name;
  phasesEl.appendChild(li);
});

function buildCabinetDetail() {
  const id = S.watched;
  $('cabWho').textContent = CONTROLLERS.find((c) => c.id === id).label;
  const el = $('ctlDetail');
  if (id === 'static') {
    el.innerHTML = `<div class="detail">
      <p class="detail-line">A fixed plan from <b>tls.add.xml</b>: 35 s green each way, 3 s yellow, 2 s all red. It ignores the traffic.</p>
      <div class="meter"><div class="meter-label"><span>Next change</span><span class="mono" id="dNext">–</span></div><div class="meter-track"><i id="dBar"></i></div></div>
    </div>`;
  } else if (id === 'actuated') {
    el.innerHTML = `<div class="detail">
      <p class="detail-line">Extends green while cars keep crossing detectors <b>28 m</b> before the stop line. Ends after a <b>3 s</b> gap, never before 10 s or after 60 s.</p>
      <div class="meter"><div class="meter-label"><span>Green elapsed</span><span class="mono" id="dGreen">–</span></div><div class="meter-track"><i id="dBar"></i><u style="left:16.6%"></u></div></div>
      <div class="meter"><div class="meter-label"><span>Gap since last car</span><span class="mono" id="dGap">–</span></div><div class="meter-track"><i id="dGapBar"></i></div></div>
    </div>`;
  } else {
    const custom = S.custom;
    el.innerHTML = `<div class="detail">
      <div class="qvals" id="qvals">
        <div class="q" data-a="0"><span class="lbl">Serve NS</span><span class="bar"><i></i></span><span class="num">–</span></div>
        <div class="q" data-a="1"><span class="lbl">Serve EW</span><span class="bar"><i></i></span><span class="num">–</span></div>
      </div>
      <div class="meter"><div class="meter-label"><span>Time in green, switch allowed from 10 s</span><span class="mono" id="dTig">–</span></div><div class="meter-track"><i id="dBar"></i><u style="left:50%"></u></div></div>
      <ol class="log" id="dLog" aria-label="Recent decisions"></ol>
      <div class="reward" aria-label="Last reward, from env/reward.py">
        <div>Wait Δ<b id="rW">–</b></div><div>Switch<b id="rS">–</b></div><div>Queue<b id="rQ">–</b></div><div>Reward<b id="rT">–</b></div>
      </div>
      <p class="policy-note">${custom
        ? `Running <b>${escapeHtml(custom.name)}</b>. <button class="linkish" id="dropW">Back to the built-in weights</button>`
        : `<b>Real network, browser-trained.</b> These weights were trained on this mirror with the repo's D3QN settings (150 episodes). <button class="linkish" id="loadW">Load a SUMO checkpoint</button>`}</p>
      <input type="file" id="wFile" accept=".json,application/json" hidden />
    </div>`;
    const file = $('wFile');
    $('loadW')?.addEventListener('click', () => file.click());
    $('dropW')?.addEventListener('click', () => { S.custom = null; S.runs.dqn.ctl.net = netFor(S.scenario); buildCabinetDetail(); toast('Back to the built-in weights.'); });
    file.addEventListener('change', async () => {
      const f = file.files[0];
      if (!f) return;
      try {
        const net = makeNetwork(JSON.parse(await f.text()));
        S.custom = { net, name: f.name };
        S.runs.dqn.ctl.net = net;
        S.qWindow = [];
        buildCabinetDetail();
        toast(`Loaded ${f.name}. The D3QN now runs these weights.`);
      } catch (err) {
        toast(`Could not load ${f.name}: ${err.message}. Export it with ui3d/tools/export_weights.py.`);
      }
    });
  }
}
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// state vector strip
const svEl = $('stateVec');
const SV_GROUPS = [
  ['Density', 0, 24, 3, '69,216,196'], ['Speed', 24, 24, 3, '69,216,196'], ['Queue', 48, 8, 1, '239,191,50'],
  ['Wait', 56, 8, 1, '255,138,107'], ['Phase', 64, 6, 0, '245,243,236'], ['Min green', 70, 1, 0, '245,243,236'],
];
const svCells = [];
for (const [label, off, n, per, rgb] of SV_GROUPS) {
  const g = document.createElement('div');
  g.className = 'sv-group';
  g.innerHTML = `<span>${label}</span><div class="sv-cells"></div>`;
  const cells = g.querySelector('.sv-cells');
  for (let k = 0; k < n; k++) {
    const i = document.createElement('i');
    if (per && k > 0 && k % per === 0) i.className = 'lane-gap';
    i.dataset.rgb = rgb;
    cells.appendChild(i);
    svCells[off + k] = i;
  }
  if (label === 'Min green') cells.style.gridAutoColumns = '12px';
  svEl.appendChild(g);
}

// ---------------------------------------------------------------- board
function renderBoard() {
  const rows = SCENARIO_ORDER.map((k) => {
    const r = REPORTED[k];
    const vals = [r.static[0], r.actuated[0], r.dqn[0]];
    const best = Math.min(...vals);
    const cell = (v, sd) => `<td class="${v[0] === best ? 'win' : ''}">${v[0].toFixed(1)}<span class="dim"> ±${sd.toFixed(1)}</span></td>`;
    const vs = ((r.dqn[0] - r.static[0]) / r.static[0]) * 100;
    return `<tr class="${k === S.scenario ? 'current' : ''}"><td>${SCENARIOS[k].label}</td>${cell(r.static, r.static[1])}${cell(r.actuated, r.actuated[1])}${cell(r.dqn, r.dqn[1])}<td>${vs.toFixed(0)}%</td></tr>`;
  }).join('');
  const r = REPORTED[S.scenario];
  const max = Math.max(r.static[0], r.actuated[0], r.dqn[0], r.dqnNoPcu ? r.dqnNoPcu[0] : 0);
  const bar = (label, v, k) => `<div><span>${label}</span><em style="--k:${k};width:${(v / max) * 100}%"></em><span>${v.toFixed(1)} s</span></div>`;
  $('boardBody').innerHTML = `
    <table>
      <thead><tr><th>Scenario</th><th>Fixed</th><th>Actuated</th><th>D3QN</th><th>D3QN vs fixed</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h3>${SCENARIOS[S.scenario].label}</h3>
    <div class="bars">
      ${bar('Fixed-time', r.static[0], COLORS.static)}
      ${bar('Actuated', r.actuated[0], COLORS.actuated)}
      ${r.dqnNoPcu ? bar('D3QN, no PCU', r.dqnNoPcu[0], 'var(--paint-3)') : ''}
      ${bar(r.dqnNoPcu ? 'D3QN, PCU' : 'D3QN', r.dqn[0], COLORS.dqn)}
    </div>
    <p class="fine">${r.co2
      ? `CO₂ over the episode: fixed ${r.co2[0]}M mg, actuated ${r.co2[1]}M mg, D3QN ${r.co2[2]}M mg (SUMO emission model, indicative). Throughput is matched at about ${r.throughput} veh/h, so the gain is in delay, not vehicles served.`
      : `Mixed fleet under SUMO's SL2015 sublane model. PCU weighting improves the D3QN by 23.9% over the same policy without it, but it does not beat actuated at this training budget.`}</p>
    <p class="fine">The live race on the left runs a browser mirror without SUMO's sublane model or lane changing. Its absolute numbers differ, and the gap-based controller is stronger there than in SUMO.</p>`;
}

// ---------------------------------------------------------------- chart
const chart = $('chart');
function drawChart() {
  const runs = S.runs;
  const t = runs.dqn.sim.time;
  const T = Math.max(600, Math.ceil(t / 300) * 300);
  let max = 10;
  for (const id in runs) for (const h of runs[id].sim.history) max = Math.max(max, h.wait);
  max = Math.ceil(max / 50) * 50;
  const W = 320, H = 110;
  const pts = (hist) => {
    const step = Math.max(1, Math.floor(hist.length / 260));
    let s = '';
    for (let i = 0; i < hist.length; i += step) s += `${((hist[i].t / T) * W).toFixed(1)},${(H - (hist[i].wait / max) * H).toFixed(1)} `;
    if (hist.length) { const h = hist[hist.length - 1]; s += `${((h.t / T) * W).toFixed(1)},${(H - (h.wait / max) * H).toFixed(1)}`; }
    return s;
  };
  const surge = SCENARIOS[S.scenario].surgeAt;
  let svg = '<g class="grid">';
  for (let k = 1; k <= 3; k++) svg += `<line x1="0" x2="${W}" y1="${(H * k) / 4}" y2="${(H * k) / 4}"/>`;
  svg += '</g>';
  if (surge && surge <= T) svg += `<line class="surge" x1="${(surge / T) * W}" x2="${(surge / T) * W}" y1="0" y2="${H}"/>`;
  if (runs.dqn.sim.history.length < 3) {
    chart.innerHTML = `${svg}<line class="base" x1="0" x2="${W}" y1="${H}" y2="${H}"/><text class="empty" x="0" y="${H - 8}">First samples arrive every 5 s of simulated time</text>`;
    $('chartMax').textContent = '';
    return;
  }
  for (const id of ['static', 'actuated', 'dqn']) svg += `<polyline stroke="${HEX[id]}" stroke-opacity="${id === S.watched ? 1 : 0.55}" points="${pts(runs[id].sim.history)}"/>`;
  chart.innerHTML = svg;
  $('chartMax').textContent = `max ${max} · ${fmtClock(T)}`;
}

// ---------------------------------------------------------------- UI tick
let lastUI = 0;
function tickUI(force = false) {
  const now = performance.now();
  if (!force && now - lastUI < 120) return;
  lastUI = now;
  const run = S.runs[S.watched];
  const sim = run.sim;

  // race
  const ms = {};
  for (const id in S.runs) ms[id] = S.runs[id].sim.metrics();
  const lead = Object.keys(ms).reduce((a, b) => (ms[a].avgWait <= ms[b].avgWait ? a : b));
  for (const id in racers) {
    const b = racers[id];
    b.setAttribute('aria-checked', String(id === S.watched));
    b.classList.toggle('lead', sim.time > 60 && id === lead);
    b.querySelector('.val b').textContent = sim.time > 4 ? fmt(ms[id].avgWait) : '–';
    b.querySelector('.stats').textContent = `queue now ${ms[id].queueNow} · ${sim.time >= 120 ? fmt(ms[id].throughput, 0) : '–'} veh/h`;
  }
  drawChart();

  // clock
  $('clock').textContent = fmtClock(sim.time);
  $('progress').style.width = `${(sim.time / sim.endTime) * 100}%`;

  // phases
  const p = sim.phase;
  [...phasesEl.children].forEach((li, i) => {
    li.classList.toggle('on', i === p);
    const fixed = [35, 3, 2, 35, 3, 2][i];
    const frac = i === p ? Math.min(1, sim.phaseTime / ((S.watched !== 'static' && (i === 0 || i === 3)) ? 60 : fixed)) : 0;
    li.querySelector('i').style.width = `${frac * 100}%`;
  });
  $('phaseName').textContent = PHASES[p].name;
  $('phaseTime').textContent = `${fmt(sim.phaseTime)} s`;

  // controller detail
  const info = run.ctl.info(sim);
  if (S.watched === 'static') {
    $('dNext').textContent = `${fmt(info.remaining)} s`;
    $('dBar').style.width = `${(1 - info.remaining / [35, 3, 2, 35, 3, 2][p]) * 100}%`;
  } else if (S.watched === 'actuated') {
    const green = p === 0 || p === 3;
    $('dGreen').textContent = green ? `${fmt(sim.phaseTime)} / 60 s` : PHASES[p].name;
    $('dBar').style.width = `${green ? Math.min(1, sim.phaseTime / 60) * 100 : 0}%`;
    $('dGap').textContent = green ? `${fmt(Math.min(info.gap, 9.9))} / 3.0 s` : '–';
    $('dGapBar').style.width = `${green ? Math.min(1, info.gap / 3) * 100 : 0}%`;
  } else {
    const ctl = run.ctl;
    const q = info.q;
    const best = q[1] > q[0] ? 1 : 0;
    if (ctl.decisions !== S.lastDecisionCount) {
      S.lastDecisionCount = ctl.decisions;
      S.qWindow.push(q[0], q[1]);
      if (S.qWindow.length > 120) S.qWindow.splice(0, 2);
    }
    const lo = Math.min(...S.qWindow, q[0], q[1]), hi = Math.max(...S.qWindow, q[0], q[1]);
    const span = Math.max(1e-6, hi - lo);
    document.querySelectorAll('#qvals .q').forEach((row) => {
      const a = Number(row.dataset.a);
      row.classList.toggle('best', a === best);
      row.querySelector('i').style.width = `${8 + 92 * ((q[a] - lo) / span)}%`;
      row.querySelector('.num').textContent = fmt(q[a], 2);
    });
    $('dTig').textContent = `${info.timeInGreen} s ${info.timeInGreen >= 10 ? 'free' : 'locked'}`;
    $('dBar').style.width = `${Math.min(1, info.timeInGreen / 20) * 100}%`;
    $('dLog').innerHTML = info.log.map((l) => `<li class="${l.kind}"><span class="mono">${fmtClock(l.t)}</span><span class="what">${l.text}</span></li>`).join('');
    const r = info.reward;
    if (r) { $('rW').textContent = fmt(r.wait); $('rS').textContent = fmt(r.switch); $('rQ').textContent = fmt(r.queue); $('rT').textContent = fmt(r.total, 2); }
  }

  // state vector (the D3QN's last observation, or the same features for the other controllers)
  const st = S.watched === 'dqn' && run.ctl.decisions ? run.ctl.lastState : sim.state(sim.phaseTime);
  S.viewState = sim.state(S.watched === 'dqn' ? run.ctl.timeInGreen : sim.phaseTime);
  for (let k = 0; k < 71; k++) {
    const c = svCells[k];
    let rgb = c.dataset.rgb;
    if (k >= 64 && k < 70) rgb = ['43,212,127', '255,179,0', '255,90,71', '43,212,127', '255,179,0', '255,90,71'][k - 64];
    c.style.background = `rgba(${rgb},${(0.07 + 0.93 * st[k]).toFixed(2)})`;
  }

  // compass
  $('compassNeedle').setAttribute('transform', `rotate(${(-scene.heading() * 180) / Math.PI} 16 16)`);
}

// -------------------------------------------------------------- main loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (S.playing && !S.finished) {
    S.acc += dt * S.speed;
    let steps = 0;
    while (S.acc >= DT && steps < 800) {
      for (const id in S.runs) { const r = S.runs[id]; r.ctl.update(r.sim); r.sim.step(); }
      S.acc -= DT; steps++;
    }
    if (steps >= 800) S.acc = 0;
    const sim = S.runs.dqn.sim;
    const surge = SCENARIOS[S.scenario].surgeAt;
    if (surge && !S.surgeShown && sim.time >= surge) {
      S.surgeShown = true;
      app.classList.add('surging');
      toast('30:00 · Rush hour. North→south through traffic jumps from 90 to 800 veh/h.');
    }
    if (sim.done) {
      S.finished = true;
      setPlaying(false);
      const ms = Object.fromEntries(Object.entries(S.runs).map(([k, r]) => [k, r.sim.metrics().avgWait]));
      toast(`Hour complete. Avg wait: fixed ${fmt(ms.static)} s, actuated ${fmt(ms.actuated)} s, D3QN ${fmt(ms.dqn)} s. Press play for a new seed.`);
    }
  }
  const sim = S.runs[S.watched].sim;
  scene.updateVehicles(sim);
  const sigs = {}; for (const d of ['N', 'E', 'S', 'W']) sigs[d] = sim.signalFor(d);
  scene.setSignals(sigs);
  tickUI();
  scene.updateOverlay(S.viewState);
  scene.render(dt);
  requestAnimationFrame(frame);
}

document.fonts.ready.then(() => {
  start();
  setPlaying(true);
  requestAnimationFrame(frame);
});
