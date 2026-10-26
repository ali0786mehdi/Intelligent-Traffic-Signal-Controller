// Headless check: node tools/bench.mjs [seconds]
// Runs fixed-time, actuated and the D3QN controller on identical demand.
import { TrafficSim } from '../src/sim.js';
import { makeController } from '../src/controllers.js';
import { SCENARIO_ORDER } from '../src/data.js';

const T = Number(process.argv[2] || 1200);
for (const sc of SCENARIO_ORDER) {
  const row = [];
  for (const id of ['static', 'actuated', 'dqn']) {
    const res = [];
    for (const seed of [1, 2, 3]) {
      const sim = new TrafficSim(sc, seed);
      sim.endTime = T;
      const c = makeController(id);
      let maxVeh = 0;
      while (!sim.done) { c.update(sim); sim.step(); maxVeh = Math.max(maxVeh, sim.vehicles.length); }
      const m = sim.metrics();
      res.push({ ...m, maxVeh, pending: Object.values(sim.pending).reduce((a, q) => a + q.length, 0) });
    }
    const mean = (k) => res.reduce((a, r) => a + r[k], 0) / res.length;
    row.push(`${id.padEnd(8)} wait ${mean('avgWait').toFixed(1).padStart(6)}  queue ${mean('avgQueue').toFixed(2).padStart(6)}  thr ${mean('throughput').toFixed(0).padStart(5)}  maxVeh ${mean('maxVeh').toFixed(0)} pend ${mean('pending').toFixed(0)}`);
  }
  console.log(`== ${sc}\n  ${row.join('\n  ')}`);
}
