# Presentation guide

A plain-language guide for presenting this project in a viva or demo: what to say, in what order, what to show, and how to answer the usual questions. Every number here comes from [REPORT.md](REPORT.md).

---

## 1. The project in one minute

> Most traffic lights run on a fixed timer. They give each road the same green time whether cars are waiting or not, so people sit at red lights in front of empty roads.
>
> We built a traffic light controller that learns. It watches the junction, sees which roads have cars queued, and decides which direction gets the green. It learned this by practising thousands of times in a traffic simulator called SUMO.
>
> We compared it against two normal controllers: a fixed timer, and an "actuated" controller that extends the green while cars keep arriving. Our learned controller cut the average waiting time by about 75–83% compared with the fixed timer and by 18–38% compared with the actuated one, while letting the same number of cars through.

If you only get one minute, say that.

---

## 2. Talk outline (about 8–10 minutes)

### Step 1: The problem (1 min)
- Fixed-time signals waste green time on empty roads.
- They can't react when traffic suddenly increases, for example at rush hour.
- Waiting cars mean lost time, more fuel burned and more pollution.

### Step 2: The idea (1 min)
- Use **reinforcement learning**: the controller learns by trial and error, like training a pet with rewards.
- It gets a small reward when waiting time goes down and a penalty when queues build up.
- After many practice runs, it learns which choice works best in each situation.

### Step 3: How it is built (2–3 min)
The project has three parts:

1. **The simulator (SUMO).** A realistic traffic simulator. We built one four-way junction with two lanes in each direction, 200 m roads, and real car behaviour (speeding up, braking, keeping gaps). Python talks to SUMO through a connection called TraCI.
2. **The learning agent (D3QN).** A small neural network. Every 5 seconds it looks at the junction and picks one of two actions: give green to north–south, or give green to east–west.
3. **The evaluation.** We ran all three controllers on exactly the same traffic, with 3 different random seeds each, and compared the results.

### Step 4: What the agent sees, does and is rewarded for (2 min)
- **What it sees (71 numbers):** for each lane, how crowded it is, how fast cars are moving, how long the queue is, and how long cars have waited. It also knows which light is currently on and whether the minimum green time has passed.
- **What it can do (2 choices):** green for north–south, or green for east–west.
- **Safety rules (the agent can't break these):** every green lasts at least 10 seconds, and every change goes through 3 seconds of yellow and 2 seconds of all-red. The simulator enforces these, not the agent.
- **Reward, in words:** "Did total waiting go down since last time? Good. Did you switch the light? Small penalty, so it doesn't flicker. Are queues long? Small penalty."

### Step 5: Results (2 min)
Show this table (average waiting time in seconds, lower is better):

| Traffic pattern | Fixed timer | Actuated | **Our D3QN** | Better than fixed timer by |
|---|---|---|---|---|
| Balanced (equal traffic) | 56.9 | 19.3 | **12.0** | 79% |
| Asymmetric (one road much busier) | 64.6 | 23.8 | **15.8** | 76% |
| Surge (traffic jumps mid-way) | 34.9 | 7.4 | **6.1** | 83% |

Points to make:
- It wins in all three traffic patterns, including against the actuated controller, which is a strong baseline.
- All three controllers let through the same number of cars. The improvement is **less waiting**, not fewer cars served.
- Estimated CO₂ was roughly 7–9 times lower, because cars idle and stop-start less. Call this an estimate from the simulator, not a measurement.

### Step 6: Mixed traffic (1 min, optional)
- We also tested a mixed fleet of cars, motorbikes, autos and buses.
- We taught the agent that a bus counts more than a motorbike, using standard Indian road "PCU" values (car 1.0, motorcycle 0.5, auto 0.8, bus 3.0).
- That made the agent 24% better (22.4 s vs 29.4 s waiting) and more consistent.
- Be honest here: in mixed traffic the actuated controller (18.5 s) is still ahead of our agent. Closing that gap is future work.

### Step 7: Limitations and future work (1 min)
- Only one junction. A whole city grid, with lights coordinating, is much harder.
- Simulation only; not tested on real roads.
- Training was kept short so it would finish in reasonable time. Longer runs would tighten the numbers.
- Future ideas: protected left-turn arrows, many junctions, and one model that handles every traffic pattern.

---

## 3. Running the live demo (the 3D view)

Start it before you present (see "How to run" in [README.md](README.md)):

```
cd ui3d
npm install
npm run dev        # open http://localhost:5173
```

Or run `npm run build` once and open `ui3d/dist/index.html` directly. That works offline.

**Suggested demo flow (2–3 minutes):**

1. **Overview camera.** "This is our junction in a stylised New York block. Three controllers are running the same traffic at the same time, and we're watching one of them."
2. **Pick the traffic pattern** at the top left. Use **Asymmetric**: "North–south is very busy and east–west is almost empty. A fixed timer still gives east–west half the time."
3. **Switch controllers** in the "Same traffic, three controllers" panel, or press `1` `2` `3`. Show the fixed timer building long queues, then the D3QN.
4. **Signal cabinet** (right panel): "This shows what the agent is thinking. Serve NS and Serve EW are its scores for each choice; it picks the higher one. You can see it wants to switch, but it waits until the 10-second minimum green has passed."
5. **Press `A`** ("Paint the state on the road"): "These are the 71 numbers the agent sees, drawn on the road. The amber strips are the queues."
6. **Press `L`** to show the signal badges above each approach, so everyone can read every light.
7. **Street** and **Tour** cameras make a good visual close.
8. **SUMO results** button: "These are the official numbers from the SUMO experiments."

**Important: know this before the demo.** The live 3D view is a simplified copy of the simulation that runs in the browser. It is not SUMO. In the browser copy the actuated controller often does better than the D3QN. If someone notices, say:

> "The live view is a lightweight browser copy, built to show *how* each controller behaves. The real comparison was done in SUMO, and those results are on the results board and in the report. In SUMO, D3QN wins in all three traffic patterns."

The built-in agent in the browser was trained on that browser copy with the same settings, because the repo doesn't ship SUMO checkpoint files. A SUMO-trained model can be loaded with "Load a SUMO checkpoint".

---

## 4. Likely questions and simple answers

**What is reinforcement learning?**
Learning by trial and error. The agent tries actions, gets a reward or penalty, and over time learns which actions lead to better results. Nobody gives it the "right answer"; it works that out from the rewards.

**What is a DQN? What does D3QN mean?**
A DQN (Deep Q-Network) is a neural network that gives each possible action a score for how good it will be in the long run, and then picks the highest score. D3QN adds two improvements:
- **Double:** one network picks the action and a second checks its score. This stops the agent from being over-optimistic.
- **Dueling:** the network separately estimates "how good is this situation overall" and "how much better is each action". This helps it learn faster when both actions are similar.

**Why SUMO and not your own simple simulator?**
SUMO is a widely used, realistic traffic simulator. Cars accelerate, brake and keep safe gaps like real drivers. A home-made simulator would make results easy to fake by accident.

**Why only two actions?**
A four-way junction mainly needs one decision: which direction gets the green. Keeping it to two choices makes learning faster and the behaviour easy to check. Yellow and all-red are added automatically.

**How do you stop it from doing something unsafe?**
The agent can only *ask* for a change. The environment enforces a 10-second minimum green and always inserts 3 s yellow and 2 s all-red. The agent can't skip these.

**Why does it get a penalty for switching?**
Without it, the agent could flicker the lights back and forth. Every switch costs 5 seconds of yellow and all-red, so frequent switching wastes time.

**How did you make sure the comparison was fair?**
All three controllers ran on exactly the same traffic files, with 3 different random seeds each, and we report the average and spread. The D3QN was tested with no random exploration.

**Is the actuated controller a weak baseline?**
No. It's a real-world style controller: it gives 10 to 60 seconds of green and ends the green when no car arrives for 3 seconds. Beating it is harder than beating a fixed timer, and we beat it in all three standard traffic patterns.

**How long did training take, and was it stable?**
150 practice episodes for the main scenarios (80 for one). The reward went up and then levelled off once exploration dropped to its minimum, around episode 40. Nothing blew up during training.

**Did anything go wrong?**
Yes. In the mixed-traffic test, the first short run made the bus-weighting look worse. When we also used it in the reward, trained longer and retuned exploration, it became clearly better. We kept both results in the report instead of hiding the first one.

**Would this work in a real city?**
Not directly yet. It's one junction in simulation. Real use would need real sensor data (cameras or loop detectors), many junctions working together, and safety testing. The method itself is the same idea used in real research on smart signals.

**What would you do with more time?**
Train longer with more seeds, add protected left-turn arrows, control several junctions together, and train one model that handles every traffic pattern.

**Is the 3D view the real simulation?**
No. It's a browser copy made for demonstration. The official results come from SUMO and are shown on the results board and in REPORT.md.

**How do I reproduce the results?**
Install Docker and run `.\run.ps1 all` on Windows or `make all` on Linux or Mac. It builds everything, trains, evaluates and writes the tables and charts to `results/`. See [README_BUILD.md](README_BUILD.md).

---

## 5. Quick-reference card

| Item | Value |
|---|---|
| Simulator | SUMO 1.27.1, controlled from Python through TraCI |
| Junction | One 4-way junction, 2 lanes each way, 200 m roads |
| Agent | D3QN (Dueling Double DQN), PyTorch, two hidden layers of 128 |
| Decision | Every 5 s, choose NS green or EW green |
| Safety rules | 10 s minimum green, 3 s yellow, 2 s all-red |
| State | 71 numbers: lane density, speed, queue, waiting time, current phase, min-green flag |
| Reward | Drop in waiting time, minus 0.5 per switch, minus 0.1 × queue, clipped to ±10 |
| Training settings | Learning rate 0.0005, discount 0.99, replay 50,000, batch 64, target copy every 500 steps |
| Main result | 76–83% less waiting than fixed time; 18–38% less than actuated |
| Mixed traffic | Bus-weighting (PCU) improved the agent by 24%; actuated still ahead there |
| Reproduce | `.\run.ps1 all` or `make all` (Docker) |
| Demo | `cd ui3d`, `npm install`, `npm run dev` |
