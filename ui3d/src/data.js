// Demand, vehicle types and reported results, transcribed from the repo:
//   network/intersection_*.rou.xml   (flows, vTypes)
//   network/tls.add.xml              (static + actuated programs)
//   REPORT.md                        (mean ± std across 3 seeds, SUMO)

export const VTYPES = {
  passenger:  { label: 'Car',        length: 5.0,  width: 1.8, accel: 2.6, decel: 4.5, maxSpeed: 13.89, sigma: 0.5, minGap: 2.5, tau: 1.0, pcu: 1.0 },
  car:        { label: 'Car',        length: 5.0,  width: 1.8, accel: 2.6, decel: 4.5, maxSpeed: 13.89, sigma: 0.5, minGap: 2.5, tau: 1.0, pcu: 1.0 },
  motorcycle: { label: 'Motorcycle', length: 2.2,  width: 0.9, accel: 3.0, decel: 6.0, maxSpeed: 16.67, sigma: 0.7, minGap: 1.0, tau: 1.0, pcu: 0.5 },
  auto:       { label: 'Auto',       length: 2.8,  width: 1.4, accel: 2.0, decel: 4.0, maxSpeed: 11.11, sigma: 0.6, minGap: 1.5, tau: 1.0, pcu: 0.8 },
  bus:        { label: 'Bus',        length: 12.0, width: 2.5, accel: 1.2, decel: 4.0, maxSpeed: 11.11, sigma: 0.4, minGap: 3.0, tau: 1.0, pcu: 3.0 },
};

// [from, to, type, begin, end, vehsPerHour]
const f = (rows) => rows.map(([od, type, begin, end, vph]) => ({ from: od[0], to: od[1], type, begin, end, vph }));

const arm = (from, through, left, right, type = 'passenger', begin = 0, end = 3600) => {
  const opp = { N: 'S', S: 'N', E: 'W', W: 'E' }[from];
  const leftTo = { N: 'E', S: 'W', E: 'S', W: 'N' }[from];
  const rightTo = { N: 'W', S: 'E', E: 'N', W: 'S' }[from];
  return [
    [from + opp, type, begin, end, through],
    [from + leftTo, type, begin, end, left],
    [from + rightTo, type, begin, end, right],
  ];
};

export const SCENARIOS = {
  balanced: {
    label: 'Balanced',
    blurb: '300 veh/h on every arm. The sanity check.',
    flows: f([...arm('N', 140, 80, 80), ...arm('S', 140, 80, 80), ...arm('E', 140, 80, 80), ...arm('W', 140, 80, 80)]),
  },
  asymmetric: {
    label: 'Asymmetric',
    blurb: 'Heavy north–south corridor (600 veh/h per arm), light east–west (100). Fixed time wastes green on empty roads.',
    flows: f([...arm('N', 280, 160, 160), ...arm('S', 280, 160, 160), ...arm('E', 40, 30, 30), ...arm('W', 40, 30, 30)]),
  },
  surge: {
    label: 'Surge',
    blurb: '200 veh/h per arm, then at 30:00 north→south through traffic jumps to 800 veh/h.',
    surgeAt: 1800,
    flows: f([
      ...arm('N', 90, 55, 55, 'passenger', 0, 1800), ...arm('S', 90, 55, 55, 'passenger', 0, 1800),
      ...arm('E', 90, 55, 55, 'passenger', 0, 1800), ...arm('W', 90, 55, 55, 'passenger', 0, 1800),
      ...arm('N', 800, 55, 55, 'passenger', 1800, 3600), ...arm('S', 90, 55, 55, 'passenger', 1800, 3600),
      ...arm('E', 90, 55, 55, 'passenger', 1800, 3600), ...arm('W', 90, 55, 55, 'passenger', 1800, 3600),
    ]),
  },
  hetero: {
    label: 'Mixed fleet',
    blurb: 'Cars 50%, motorcycles 30%, autos 15%, buses 5%. Queues are weighted by PCU (bus 3.0, motorcycle 0.5).',
    pcu: true,
    flows: (() => {
      const rows = [];
      for (const from of ['N', 'S', 'E', 'W']) {
        const opp = { N: 'S', S: 'N', E: 'W', W: 'E' }[from];
        const leftTo = { N: 'E', S: 'W', E: 'S', W: 'N' }[from];
        const rightTo = { N: 'W', S: 'E', E: 'N', W: 'S' }[from];
        rows.push([from + opp, 'car', 0, 3600, 70], [from + opp, 'motorcycle', 0, 3600, 42],
          [from + opp, 'auto', 0, 3600, 21], [from + opp, 'bus', 0, 3600, 7]);
        for (const t of [leftTo, rightTo]) rows.push([from + t, 'car', 0, 3600, 40], [from + t, 'motorcycle', 0, 3600, 24]);
      }
      return f(rows);
    })(),
  },
};

export const SCENARIO_ORDER = ['balanced', 'asymmetric', 'surge', 'hetero'];

// REPORT.md §4.1 / §4.4 — average waiting time (s), mean ± std, 3 seeds, 1200 s episodes.
export const REPORTED = {
  balanced:   { static: [56.85, 3.53], actuated: [19.29, 2.66], dqn: [11.97, 0.76], co2: [19.4, 15.5, 2.1], throughput: 1170 },
  asymmetric: { static: [64.64, 1.11], actuated: [23.82, 0.17], dqn: [15.82, 0.62], co2: [23.3, 17.8, 2.6], throughput: 1360 },
  surge:      { static: [34.88, 0.17], actuated: [7.42, 0.94],  dqn: [6.08, 1.77],  co2: [12.6, 9.5, 1.5],  throughput: 785 },
  hetero:     { static: [56.11, 0.95], actuated: [18.53, 1.49], dqn: [22.36, 1.95], dqnNoPcu: [29.38, 4.85] },
};

export const PHASES = [
  { name: 'NS green',  short: 'NS', kind: 'green',  axis: 'NS' },
  { name: 'NS yellow', short: 'NS', kind: 'yellow', axis: 'NS' },
  { name: 'All red',   short: 'AR', kind: 'red',    axis: null },
  { name: 'EW green',  short: 'EW', kind: 'green',  axis: 'EW' },
  { name: 'EW yellow', short: 'EW', kind: 'yellow', axis: 'EW' },
  { name: 'All red',   short: 'AR', kind: 'red',    axis: null },
];

export const CONTROLLERS = [
  { id: 'static',   label: 'Fixed-time', note: '35 s green per axis, 80 s cycle' },
  { id: 'actuated', label: 'Actuated',   note: 'Gap-based, 10–60 s green' },
  { id: 'dqn',      label: 'D3QN',       note: 'Picks NS or EW every 5 s' },
];
