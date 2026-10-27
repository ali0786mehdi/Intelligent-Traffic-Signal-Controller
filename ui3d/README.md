# ui3d — 3D daytime view of the Intelligent Traffic Signal Controller

A browser view of the project's single SUMO intersection. Three controllers run the
same traffic at the same time: the fixed-time plan, the gap-actuated plan, and the
D3QN agent. You choose which one the 3D city shows, and you can paint the agent's
71-value state onto the road.

## Run it

```
cd ui3d
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/index.html, one self-contained file you can open from disk
```

## What is faithful to the repo

| Piece | Source |
|---|---|
| Geometry: 4 arms, 2+2 lanes of 3.2 m, 189.6 m incoming lanes, stop line 10.4 m from the centre, right-hand traffic | `network/intersection.net.xml` |
| Demand: every flow, rate and time window, including the 30:00 surge and the mixed fleet | `network/intersection_*.rou.xml` |
| Vehicle parameters (accel, decel, length, minGap, tau, sigma) and PCU factors | route files, `env/traffic_env.py` |
| 6-phase program, fixed 35/3/2 timings, actuated 10–60 s green with a 3 s max gap | `network/tls.add.xml` |
| D3QN env rules: decide every 5 s, 10 s min green, 3 s yellow + 2 s all red on every switch | `env/traffic_env.py` |
| 71-dim state (density, speed, queue, wait, phase one-hot, min-green flag) with the same normalisation | `env/traffic_env.py::_get_state` |
| Reward `(W_prev − W) − 0.5·switch − 0.1·Σqueue`, clipped to ±10 | `env/reward.py` |
| Network: dueling 71→128→128, V and A heads, `Q = V + A − mean(A)` | `agent/dqn.py` |
| "Avg wait": mean of summed lane waiting time, sampled every 5 s | `evaluate.py` |
| Results board numbers | `REPORT.md` |

## What is not SUMO

`src/sim.js` is a small IDM microsimulator, not SUMO. It has no SL2015 sublane model
and no lane changing, and permissive left turns use a simple gap check. Fixed-time
waits land close to the SUMO numbers (about 52 s vs 57 s balanced, 64 s vs 65 s
asymmetric). The gap-actuated controller does much better here than in SUMO,
so in the live race it usually leads the D3QN. The SUMO results board is the
evidence for the report; the live race shows the controllers' behaviour.

## The D3QN weights

`agent/models/` in the repo has no checkpoints, so the built-in weights in
`src/weights/` were trained on this browser mirror with the repo's settings
(Adam 5e-4, γ 0.99, ε 1→0.05 over 3500 steps, replay 50k, batch 64, hard target
copy every 500 steps, Huber loss, grad clip 10, Double-DQN targets, 150 episodes):

```
node tools/train.mjs asymmetric 150 900 7    # writes src/weights/asymmetric.json
node tools/bench.mjs 1200                    # headless 3-controller check
```

To run the SUMO-trained policy instead, export a checkpoint and load it from the
cabinet panel ("Load a SUMO checkpoint"):

```
python ui3d/tools/export_weights.py agent/models/dqn_asymmetric.pt dqn_asymmetric.json
```

## Controls

Drag to orbit, scroll or pinch to zoom. `Space` plays or pauses, `1` `2` `3` choose the
controller in view, `A` paints the state on the road, and `L` (or the Signals button)
shows or hides a small signal badge above each approach's overhead head, so every
approach's light and countdown can be read from any angle. In the painted state, each
lane's queue is an amber strip that grows back from the stop line one car length per
queued vehicle, with the count shown above the stop line. The Tour camera slowly circles
the junction for demos.

URL options: `?scenario=hetero` opens a scenario, `?warm=600` fast-forwards the
simulation 600 s before it starts, and `?q=high` keeps ambient occlusion on even on a
slow GPU (by default the view drops AO, then resolution, if frames take over 30 ms).

`node tools/shoot.mjs` takes desktop and mobile screenshots of the build with local
Edge or Chrome.

## Look and assets

The scene is a stylized, toon-shaded New York block at mid-morning. The art direction is
in `DESIGN.md`.

Almost everything is procedural:
- `src/nyc.js` builds the brick and brownstone buildings (fire escapes, water towers,
  art-deco towers), modern glass office towers and the skyline.
- `src/stylize.js` provides the toon materials, canvas textures, grass, tree canopies and
  clouds.
- `src/scene.js` builds the road, park, street props and signals.

The only external asset is the car set:

| Asset | Source | Licence |
|---|---|---|
| Cars (sedan, sports, hatchback, SUV, luxury SUV, taxi, van) | [Kenney Car Kit](https://kenney.nl/assets/car-kit) | CC0 |

`node tools/fetch-assets.mjs` downloads the kit and packs it into `src/assets/cars.glb`
with gltf-transform. The packed file is committed, so you only need the script to change
it. Car paint colours are swapped per vehicle in the shader. Buses, motorcycles with
riders, and autos are modelled in code.
