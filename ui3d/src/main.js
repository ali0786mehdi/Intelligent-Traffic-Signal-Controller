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
const HEX = { static: '#ff8f70', actuated: '#f4c15d', dqn: '#5ce1cf' };
const SPEEDS = [1, 5, 20, 60];
const VIEWS = [['overview', 'Overview'], ['street', 'Street'], ['plan', 'Plan'], ['tour', 'Tour']];
const DUR = [35, 3, 2, 35, 3, 2];
const LAMP = { green: 'var(--g)', yellow: 'var(--y)', red: 'var(--r)' };

const $ = (id) => document.getElementById(id);
const app = $('app');
const params = new URLSearchParams(location.search);
const fmtClock = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
  scenario: params.get('scenario') && SCENARIOS[params.get('scenario')] ? params.get('scenario') : 'asymmetric',
  seed: (Math.random() * 1e9) | 0,
  speed: 5,
  playing: true,
  watched: 'dqn',
  agentView: false,
  runs: {},
  custom: null,
  qWindow: [],
  surgeShown: false,
  finished: false,
  shown: {},              // eased numbers on screen
};

app.classList.add('pre');
const scene = new IntersectionScene($('stage'), { quality: params.get('q') || 'auto' });
scene.onUserCamera = () => setSegValue($('viewSeg'), null);

function start() {
  S.runs = {};
  for (const c of CONTROLLERS) {
    const sim = new TrafficSim(S.scenario, S.seed);
    const cfg = c.id === 'dqn' ? { net: S.custom ? S.custom.net : netFor(S.scenario) } : undefined;
    S.runs[c.id] = { sim, ctl: makeController(c.id, cfg) };
  }
  const warm = Number(params.get('warm') || 0);
  if (warm > 0 && !S.warmed) {
    S.warmed = true;
    for (const id in S.runs) { const r = S.runs[id]; while (r.sim.time < warm) { r.ctl.update(r.sim); r.sim.step(); } }
  }
  S.acc = 0;
  S.qWindow = [];
  S.surgeShown = false;
  S.finished = false;
  S.shown = {};
  S.lastLogKey = null;
  app.classList.remove('surging');
  $('surgeMark').hidden = !SCENARIOS[S.scenario].surgeAt;
  buildCabinetDetail(false);
  renderBoard();
  tickUI(true);
}

// ------------------------------------------------------------ segmented
function moveThumb(el) {
  const sel = [...el.querySelectorAll('button')].find((b) => b.getAttribute('aria-checked') === 'true');
  const th = el.querySelector('.thumb');
  if (!sel) { th.style.opacity = '0'; return; }
  th.style.opacity = '1';
  th.style.width = `${sel.offsetWidth}px`;
  th.style.transform = `translateX(${sel.offsetLeft}px)`;
}
function setSegValue(el, value) {
  for (const x of el.querySelectorAll('button')) x.setAttribute('aria-checked', String(x.dataset.value === String(value)));
  moveThumb(el);
}
function segmented(el, items, current, onPick) {
  el.innerHTML = '<span class="thumb" aria-hidden="true"></span>';
  for (const [value, label] of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.textContent = label;
    b.dataset.value = value;
    b.setAttribute('aria-checked', String(value === current));
    b.addEventListener('click', () => { setSegValue(el, value); onPick(value); });
    el.appendChild(b);
  }
  el.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const kids = [...el.querySelectorAll('button')];
    const i = kids.indexOf(document.activeElement);
    if (i < 0) return;
    const n = kids[(i + (e.key === 'ArrowRight' ? 1 : kids.length - 1)) % kids.length];
    n.focus(); n.click(); e.preventDefault();
  });
  el.classList.add('no-anim');
  requestAnimationFrame(() => { moveThumb(el); requestAnimationFrame(() => el.classList.remove('no-anim')); });
}
window.addEventListener('resize', () => document.querySelectorAll('.seg').forEach(moveThumb));

segmented($('scenarioSeg'), SCENARIO_ORDER.map((k) => [k, SCENARIOS[k].label]), S.scenario, (v) => {
  S.scenario = v; S.seed = (Math.random() * 1e9) | 0;
  $('scenarioBlurb').textContent = SCENARIOS[v].blurb;
  start();
});
$('scenarioBlurb').textContent = SCENARIOS[S.scenario].blurb;
segmented($('speedSeg'), SPEEDS.map((s) => [String(s), `${s}×`]), String(S.speed), (v) => { S.speed = Number(v); });
segmented($('viewSeg'), VIEWS, 'overview', (v) => scene.setView(v));

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
  if (S.agentView) { scene.setView('agent'); setSegValue($('viewSeg'), null); }
});

$('badgeBtn').addEventListener('click', () => {
  const on = $('badgeBtn').getAttribute('aria-pressed') !== 'true';
  $('badgeBtn').setAttribute('aria-pressed', String(on));
  scene.setSignalBadges(on);
});

const boardOpen = (open) => {
  $('board').hidden = !open;
  document.querySelector('.cabinet').hidden = open && window.matchMedia('(min-width: 901px)').matches;
  $('boardBtn').setAttribute('aria-expanded', String(open));
  if (open) { renderBoard(); $('boardClose').focus(); }
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
  if (e.key.toLowerCase() === 'l') $('badgeBtn').click();
});

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
}

// ------------------------------------------------------------ race rows
const racers = {};
for (const c of CONTROLLERS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'racer';
  b.setAttribute('role', 'radio');
  b.style.setProperty('--k', COLORS[c.id]);
  b.innerHTML = `<span>
      <span class="name"><span class="dot" aria-hidden="true"></span>${c.label}<span class="tag lead-tag">Leading</span></span>
      <span class="sub">${c.note}</span>
      <span class="mono stats">queue – · – veh/h</span>
    </span>
    <span class="val"><b>–</b><span>avg wait</span></span>`;
  b.addEventListener('click', () => pickWatched(c.id));
  $('raceRows').appendChild(b);
  racers[c.id] = b;
}
function pickWatched(id) {
  if (S.watched === id) return;
  S.watched = id;
  buildCabinetDetail(true);
  tickUI(true);
}

// ------------------------------------------------------------- cabinet
const phasesEl = $('phases');
PHASES.forEach((p) => {
  const li = document.createElement('li');
  li.className = p.kind;
  li.innerHTML = `<span class="seg-bar"><i></i></span><span>${p.kind === 'green' ? p.short : p.kind === 'yellow' ? 'Y' : 'R'}</span>`;
  li.title = p.name;
  phasesEl.appendChild(li);
});

function buildCabinetDetail(animate) {
  const id = S.watched;
  const ctl = CONTROLLERS.find((c) => c.id === id);
  $('cabWho').querySelector('span').textContent = ctl.label;
  $('cabWho').style.setProperty('--k', COLORS[id]);
  const el = $('ctlDetail');
  if (id === 'static') {
    el.innerHTML = `<p class="detail-line">A fixed plan from <b>tls.add.xml</b>: 35 s green each way, 3 s yellow, 2 s all red. It never looks at the traffic, so the poles show a countdown.</p>
      <div class="meter"><div class="meter-label"><span>Next change</span><span class="mono" id="dNext">–</span></div><div class="meter-track"><i id="dBar"></i></div></div>`;
  } else if (id === 'actuated') {
    el.innerHTML = `<p class="detail-line">Extends green while cars keep crossing detectors <b>28 m</b> before the stop line. Ends after a <b>3 s</b> gap, never before 10 s or after 60 s.</p>
      <div class="meter"><div class="meter-label"><span>Green elapsed, min 10 s, max 60 s</span><span class="mono" id="dGreen">–</span></div><div class="meter-track"><i id="dBar"></i><u style="left:16.6%"></u></div></div>
      <div class="meter"><div class="meter-label"><span>Gap since last detection</span><span class="mono" id="dGap">–</span></div><div class="meter-track" id="dGapTrack"><i id="dGapBar"></i></div></div>`;
  } else {
    el.innerHTML = `<div class="decision">
        <div><span>Decision</span><b id="dAct">–</b></div>
        <div class="countdown"><span>Next decision in</span><span class="mono" id="dNextDec">–</span></div>
      </div>
      <div class="qvals" id="qvals">
        <div class="q" data-a="0"><span class="lbl">Serve NS</span><span class="bar"><i></i></span><span class="num">–</span></div>
        <div class="q" data-a="1"><span class="lbl">Serve EW</span><span class="bar"><i></i></span><span class="num">–</span></div>
      </div>
      <div class="meter"><div class="meter-label"><span>Time in green, switch allowed from 10 s</span><span class="mono" id="dTig">–</span></div><div class="meter-track" id="dTigTrack"><i id="dBar"></i><u style="left:50%"></u></div></div>
      <ol class="log" id="dLog" aria-label="Recent decisions"></ol>
      <div class="reward" aria-label="Last reward, from env/reward.py">
        <div>Wait Δ<b id="rW">–</b></div><div>Switch<b id="rS">–</b></div><div>Queue<b id="rQ">–</b></div><div>Reward<b id="rT">–</b></div>
      </div>
      <p class="policy-note">${S.custom
        ? `Running <b>${escapeHtml(S.custom.name)}</b>. <button class="linkish" id="dropW">Back to the built-in weights</button>`
        : `<b>Real network, browser-trained.</b> Trained on this mirror with the repo's D3QN settings (150 episodes). <button class="linkish" id="loadW">Load a SUMO checkpoint</button>`}</p>
      <input type="file" id="wFile" accept=".json,application/json" hidden />`;
    const file = $('wFile');
    $('loadW')?.addEventListener('click', () => file.click());
    $('dropW')?.addEventListener('click', () => { S.custom = null; S.runs.dqn.ctl.net = netFor(S.scenario); buildCabinetDetail(true); toast('Back to the built-in weights.'); });
    file.addEventListener('change', async () => {
      const f = file.files[0];
      if (!f) return;
      try {
        const net = makeNetwork(JSON.parse(await f.text()));
        S.custom = { net, name: f.name };
        S.runs.dqn.ctl.net = net;
        S.qWindow = [];
        buildCabinetDetail(true);
        toast(`Loaded ${f.name}. The D3QN now runs these weights.`);
      } catch (err) {
        toast(`Could not load ${f.name}: ${err.message}. Export it with ui3d/tools/export_weights.py.`);
      }
    });
    S.lastLogKey = null;
  }
  if (animate) { el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); }
}

// state vector strip
const SV_GROUPS = [
  ['Density', 0, 24, 3, '92,225,207'], ['Speed', 24, 24, 3, '92,225,207'], ['Queue', 48, 8, 1, '244,193,93'],
  ['Wait', 56, 8, 1, '255,143,112'], ['Phase', 64, 6, 0, '243,243,241'], ['Min green', 70, 1, 0, '243,243,241'],
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
  $('stateVec').appendChild(g);
}

// ---------------------------------------------------------------- board
function renderBoard() {
  const rows = SCENARIO_ORDER.map((k) => {
    const r = REPORTED[k];
    const best = Math.min(r.static[0], r.actuated[0], r.dqn[0]);
    const cell = (v) => `<td class="${v[0] === best ? 'win' : ''}">${v[0].toFixed(1)}<span class="dim">±${v[1].toFixed(1)}</span></td>`;
    const vs = ((r.dqn[0] - r.static[0]) / r.static[0]) * 100;
    return `<tr class="${k === S.scenario ? 'current' : ''}"><td>${SCENARIOS[k].label}</td>${cell(r.static)}${cell(r.actuated)}${cell(r.dqn)}<td>${vs.toFixed(0)}%</td></tr>`;
  }).join('');
  const r = REPORTED[S.scenario];
  const max = Math.max(r.static[0], r.actuated[0], r.dqn[0], r.dqnNoPcu ? r.dqnNoPcu[0] : 0);
  const bar = (label, v, k) => `<div><span>${label}</span><em style="--k:${k};width:${(v / max) * 100}%"></em><span>${v.toFixed(1)} s</span></div>`;
  $('boardBody').innerHTML = `
    <table>
      <thead><tr><th>Scenario</th><th>Fixed</th><th>Actuated</th><th>D3QN</th><th>vs fixed</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h3>${SCENARIOS[S.scenario].label}</h3>
    <div class="bars">
      ${bar('Fixed-time', r.static[0], COLORS.static)}
      ${bar('Actuated', r.actuated[0], COLORS.actuated)}
      ${r.dqnNoPcu ? bar('D3QN, no PCU', r.dqnNoPcu[0], 'var(--text-3)') : ''}
      ${bar(r.dqnNoPcu ? 'D3QN, PCU' : 'D3QN', r.dqn[0], COLORS.dqn)}
    </div>
    <p class="fine">${r.co2
      ? `CO₂ over the episode: fixed ${r.co2[0]}M mg, actuated ${r.co2[1]}M mg, D3QN ${r.co2[2]}M mg (SUMO emission model, indicative). Throughput is matched at about ${r.throughput} veh/h, so the gain is in delay, not vehicles served.`
      : 'Mixed fleet under SUMO\'s SL2015 sublane model. PCU weighting improves the D3QN by 23.9% over the same policy without it, but it does not beat actuated at this training budget.'}</p>
    <p class="fine">The live race runs a browser mirror without SUMO's sublane model or lane changing. Its absolute numbers differ, and the gap-based controller is stronger there than in SUMO.</p>`;
}

// ---------------------------------------------------------------- chart
const chart = $('chart');
function drawChart() {
  const runs = S.runs;
  const t = runs.dqn.sim.time;
  const T = Math.max(600, Math.ceil(t / 300) * 300);
  const W = 320, H = 120;
  if (runs.dqn.sim.history.length < 3) {
    chart.innerHTML = `<line class="base" x1="0" x2="${W}" y1="${H}" y2="${H}"/><text class="empty" x="0" y="${H - 8}">First samples arrive every 5 s of simulated time</text>`;
    $('chartMax').textContent = '';
    return;
  }
  let max = 10;
  for (const id in runs) for (const h of runs[id].sim.history) max = Math.max(max, h.wait);
  max = Math.ceil(max / 50) * 50;
  const xy = (h) => [((h.t / T) * W).toFixed(1), (H - (h.wait / max) * H).toFixed(1)];
  const pts = (hist) => {
    const step = Math.max(1, Math.floor(hist.length / 240));
    const out = [];
    for (let i = 0; i < hist.length; i += step) out.push(xy(hist[i]));
    out.push(xy(hist[hist.length - 1]));
    return out;
  };
  const surge = SCENARIOS[S.scenario].surgeAt;
  let svg = `<defs><linearGradient id="ga" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${HEX[S.watched]}" stop-opacity="0.28"/><stop offset="1" stop-color="${HEX[S.watched]}" stop-opacity="0"/></linearGradient></defs><g class="grid">`;
  for (let k = 1; k <= 3; k++) svg += `<line x1="0" x2="${W}" y1="${(H * k) / 4}" y2="${(H * k) / 4}"/>`;
  svg += '</g>';
  if (surge && surge <= T) svg += `<line class="surge" x1="${(surge / T) * W}" x2="${(surge / T) * W}" y1="0" y2="${H}"/>`;
  const order = ['static', 'actuated', 'dqn'].filter((id) => id !== S.watched).concat(S.watched);
  for (const id of order) {
    const p = pts(runs[id].sim.history);
    const line = p.map((q) => q.join(',')).join(' ');
    if (id === S.watched) svg += `<polygon class="area" fill="url(#ga)" points="${p[0][0]},${H} ${line} ${p[p.length - 1][0]},${H}"/>`;
    svg += `<polyline class="${id === S.watched ? 'watched' : ''}" stroke="${HEX[id]}" stroke-opacity="${id === S.watched ? 1 : 0.45}" points="${line}"/>`;
  }
  chart.innerHTML = svg;
  $('chartMax').textContent = `0–${max} s · ${fmtClock(T)}`;
}

// eased number display
function ease(key, target, k = 0.18) {
  const cur = S.shown[key];
  const v = cur === undefined || !Number.isFinite(cur) ? target : cur + (target - cur) * k;
  S.shown[key] = v;
  return v;
}

// ------------------------------------------------------- countdowns (static only)
function countdowns(sim) {
  if (S.watched !== 'static') return null;
  const p = sim.phase, t = sim.phaseTime;
  const until = (from, to) => { let s = DUR[from] - t, i = (from + 1) % 6; while (i !== to) { s += DUR[i]; i = (i + 1) % 6; } return s; };
  const forAxis = (green) => {
    const yellow = green + 1;
    if (p === green) return DUR[green] - t;
    if (p === yellow) return DUR[yellow] - t;
    return until(p, green);
  };
  const ns = forAxis(0), ew = forAxis(3);
  return { N: ns, S: ns, E: ew, W: ew };
}

// ---------------------------------------------------------------- UI tick
let lastUI = 0, lastPhase = -1;
function tickUI(force = false) {
  const now = performance.now();
  if (!force && now - lastUI < 90) return;
  lastUI = now;
  const run = S.runs[S.watched];
  const sim = run.sim;

  const ms = {};
  for (const id in S.runs) ms[id] = S.runs[id].sim.metrics();
  const lead = Object.keys(ms).reduce((a, b) => (ms[a].avgWait <= ms[b].avgWait ? a : b));
  for (const id in racers) {
    const b = racers[id];
    b.setAttribute('aria-checked', String(id === S.watched));
    b.classList.toggle('lead', sim.time > 120 && id === lead);
    const v = sim.time > 4 ? ease(`w-${id}`, ms[id].avgWait) : NaN;
    b.querySelector('.val b').innerHTML = Number.isFinite(v) ? `${v.toFixed(1)}<small>s</small>` : '–';
    b.querySelector('.stats').textContent = `queue ${ms[id].queueNow} · ${sim.time >= 120 ? fmt(ms[id].throughput, 0) : '–'} veh/h`;
  }
  drawChart();

  $('clock').textContent = fmtClock(sim.time);
  $('progress').style.transform = `scaleX(${sim.time / sim.endTime})`;

  // phase
  const p = sim.phase;
  const kind = PHASES[p].kind;
  [...phasesEl.children].forEach((li, i) => {
    li.classList.toggle('on', i === p);
    li.classList.toggle('done', i < p);
    const span = (S.watched !== 'static' && (i === 0 || i === 3)) ? 60 : DUR[i];
    li.querySelector('i').style.transform = i === p ? `scaleX(${Math.min(1, sim.phaseTime / span)})` : i < p ? 'scaleX(1)' : 'scaleX(0)';
  });
  const lamp = $('lamp');
  lamp.style.setProperty('--lc', LAMP[kind]);
  if (p !== lastPhase) { lamp.classList.remove('pulse'); void lamp.offsetWidth; lamp.classList.add('pulse'); lastPhase = p; }
  $('phaseName').textContent = PHASES[p].name;
  $('phaseSub').textContent = `Phase ${p + 1} of 6`;
  $('phaseTime').innerHTML = `${fmt(sim.phaseTime)}<small>s</small>`;

  // brand mark mirrors the north–south head
  const ns = sim.signalFor('N');
  $('markR').setAttribute('class', ns === 'R' ? 'on-r' : '');
  $('markY').setAttribute('class', ns === 'Y' ? 'on-y' : '');
  $('markG').setAttribute('class', ns === 'G' ? 'on-g' : '');

  const info = run.ctl.info(sim);
  if (S.watched === 'static') {
    $('dNext').textContent = `${fmt(info.remaining)} s`;
    $('dBar').style.transform = `scaleX(${1 - info.remaining / DUR[p]})`;
  } else if (S.watched === 'actuated') {
    const green = p === 0 || p === 3;
    $('dGreen').textContent = green ? `${fmt(sim.phaseTime)} s` : PHASES[p].name;
    $('dBar').style.transform = `scaleX(${green ? Math.min(1, sim.phaseTime / 60) : 0})`;
    $('dGap').textContent = green ? `${fmt(Math.min(info.gap, 9.9))} / 3.0 s` : '–';
    $('dGapBar').style.transform = `scaleX(${green ? Math.min(1, info.gap / 3) : 0})`;
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
      row.querySelector('i').style.transform = `scaleX(${0.08 + 0.92 * ((q[a] - lo) / span)})`;
      row.querySelector('.num').textContent = fmt(q[a], 2);
    });
    const top = info.log[0];
    $('dAct').textContent = top ? top.text.replace(', min green not reached', '') : 'Waiting for first decision';
    $('dNextDec').textContent = `${fmt(Math.max(0, info.next - sim.time))} s`;
    $('dTig').textContent = `${info.timeInGreen} s, ${info.timeInGreen >= 10 ? 'free' : 'locked'}`;
    $('dTigTrack').classList.toggle('ok', info.timeInGreen >= 10);
    $('dBar').style.transform = `scaleX(${Math.min(1, info.timeInGreen / 20)})`;
    const key = info.log.length ? `${info.log[0].t}` : '';
    if (key !== S.lastLogKey) {
      S.lastLogKey = key;
      $('dLog').innerHTML = info.log.slice(0, 5).map((l, i) => `<li class="${l.kind}${i === 0 ? ' fresh' : ''}"><span class="mono">${fmtClock(l.t)}</span><span class="what">${l.text}</span></li>`).join('');
    }
    const r = info.reward;
    if (r) { $('rW').textContent = fmt(r.wait); $('rS').textContent = fmt(r.switch); $('rQ').textContent = fmt(r.queue); $('rT').textContent = fmt(r.total, 2); }
  }

  const st = S.watched === 'dqn' && run.ctl.decisions ? run.ctl.lastState : sim.state(sim.phaseTime);
  S.viewState = sim.state(S.watched === 'dqn' ? run.ctl.timeInGreen : sim.phaseTime);
  for (let k = 0; k < 71; k++) {
    const c = svCells[k];
    let rgb = c.dataset.rgb;
    if (k >= 64 && k < 70) rgb = ['47,224,138', '255,178,26', '255,85,71', '47,224,138', '255,178,26', '255,85,71'][k - 64];
    c.style.background = `rgba(${rgb},${(0.06 + 0.94 * st[k]).toFixed(2)})`;
  }

  scene.setCountdowns(countdowns(sim));
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
      const m = Object.fromEntries(Object.entries(S.runs).map(([k, r]) => [k, r.sim.metrics().avgWait]));
      toast(`Hour complete. Avg wait: fixed ${fmt(m.static)} s, actuated ${fmt(m.actuated)} s, D3QN ${fmt(m.dqn)} s. Press play for a new seed.`);
    }
  }
  const sim = S.runs[S.watched].sim;
  scene.updateVehicles(sim, S.playing ? dt * S.speed : 0);
  const sigs = {}; for (const d of ['N', 'E', 'S', 'W']) sigs[d] = sim.signalFor(d);
  scene.setSignals(sigs);
  tickUI();
  scene.updateOverlay(S.viewState, dt);
  scene.render(dt);
  requestAnimationFrame(frame);
}

Promise.all([document.fonts.ready, scene.ready]).then(() => {
  start();
  setPlaying(true);
  $('loader').classList.add('gone');
  app.classList.remove('pre');
  app.classList.add('intro');
  document.querySelectorAll('.seg').forEach(moveThumb);
  scene.setView('overview', { dur: 3.6, arc: 0 });
  last = performance.now();
  requestAnimationFrame(frame);
}).catch((err) => {
  console.error(err);
  $('loaderText').textContent = `Could not build the scene: ${err.message}`;
});
