# Project Setup Guide
## Intelligent Traffic Signal Controller (SUMO + TraCI + DQN)

This guide takes you from a clean machine to a verified, working SUMO + Python + TraCI environment, ready for RL development. Follow it top to bottom — don't skip the verification steps, they catch 90% of the errors people hit later.

---

## 0. What You're Installing, and Why

| Component | What it is | Why you need it |
|---|---|---|
| SUMO | The traffic simulator itself | Runs the actual intersection simulation |
| SUMO_HOME env variable | Points Python to SUMO's internal tools | Required for TraCI import to work |
| Python 3.10+ | Your dev language | Runs the RL agent and controls SUMO |
| `traci` / `sumolib` | Python packages bundled with SUMO | Let Python talk to SUMO in real time |
| PyTorch | Deep learning framework | Builds/trains the DQN |
| Gym-style wrapper (custom or `sumo-rl`) | RL environment interface | Standardizes state/action/reward/step |

---

## 1. Install SUMO

### Windows
1. Download the installer from the official Eclipse SUMO downloads page: https://sumo.dlr.de/docs/Downloads.php
2. Run the installer. Default install path is typically `C:\Program Files (x86)\Eclipse\Sumo`.
3. During/after install, note the install path — you'll need it for the environment variable in Step 2.

### macOS
```bash
brew tap dlr-ts/sumo
brew install sumo
```

### Linux (Ubuntu/Debian)
```bash
sudo add-apt-repository ppa:sumo/stable
sudo apt-get update
sudo apt-get install sumo sumo-tools sumo-doc
```

### Verify SUMO itself works (before touching Python)
```bash
sumo --version
sumo-gui
```
The GUI should open a blank simulation window. If it does, SUMO itself is correctly installed. Close it and continue.

---

## 2. Set the `SUMO_HOME` Environment Variable

TraCI and SUMO's Python tools locate each other via this variable. This step is the single most common source of "traci not found" or "cannot import sumolib" errors — do not skip it.

### Windows (PowerShell, run as your normal user)
```powershell
[System.Environment]::SetEnvironmentVariable('SUMO_HOME', 'C:\Program Files (x86)\Eclipse\Sumo', 'User')
```
Close and reopen your terminal/IDE afterward so it picks up the variable.

### macOS/Linux
Add to your `~/.bashrc` or `~/.zshrc`:
```bash
export SUMO_HOME="/usr/share/sumo"
```
(Adjust path if Homebrew installed it elsewhere — check with `brew info sumo`.)
Then:
```bash
source ~/.bashrc   # or ~/.zshrc
```

### Verify
```bash
echo $SUMO_HOME        # macOS/Linux
echo $env:SUMO_HOME     # Windows PowerShell
```
This must print a real path, not blank.

---

## 3. Set Up Python Environment

Use a virtual environment so this project's dependencies don't clash with anything else on your machine.

```bash
python3 -m venv traffic-rl-env

# Activate:
source traffic-rl-env/bin/activate      # macOS/Linux
traffic-rl-env\Scripts\activate         # Windows
```

Install core dependencies:
```bash
pip install --upgrade pip
pip install traci sumolib
pip install torch --index-url https://download.pytorch.org/whl/cpu   # CPU is fine for this project size
pip install numpy pandas matplotlib gymnasium
pip install stable-baselines3   # optional, only if you're using SB3's DQN instead of hand-rolled
```

### Verify TraCI is importable
```bash
python -c "import traci; import sumolib; print('TraCI OK:', traci.__file__)"
```
If this fails with a `SUMO_HOME` related error, go back to Step 2 — the venv doesn't fix a missing environment variable.

---

## 4. Project Folder Structure

Create this structure now so every later step has a home:

```
traffic-rl-project/
│
├── network/
│   ├── intersection.net.xml       # road network (built in netedit)
│   ├── intersection.rou.xml       # vehicle routes/demand
│   ├── intersection.sumocfg       # SUMO config tying network + routes together
│   └── tls.add.xml                # traffic light program definitions (static/actuated)
│
├── env/
│   └── traffic_env.py             # your Gym-style wrapper around TraCI
│
├── agent/
│   ├── dqn.py                     # DQN network + replay buffer + training loop
│   └── models/                    # saved trained model checkpoints
│
├── baselines/
│   ├── static_controller.py
│   └── actuated_controller.py     # or just use SUMO's built-in actuated TLS type
│
├── train.py                       # main training entrypoint
├── evaluate.py                    # runs static vs actuated vs DQN, produces comparison metrics
├── results/
│   ├── plots/
│   └── logs/
│
├── requirements.txt
└── README.md
```

Generate `requirements.txt` once your environment is working:
```bash
pip freeze > requirements.txt
```

---

## 5. Build a Minimal Test Network (Sanity Check Before Any Code)

Before writing a single line of RL code, confirm you can build and run a basic 4-way intersection.

1. Launch the network editor:
   ```bash
   netedit
   ```
2. Create a simple 4-way intersection: draw 4 edges meeting at one junction (or use `netgenerate` for a quick default grid):
   ```bash
   netgenerate --grid --grid.number=1 --output-file=network/intersection.net.xml
   ```
3. Generate a basic traffic demand file (random trips) using SUMO's bundled script:
   ```bash
   python "$SUMO_HOME/tools/randomTrips.py" -n network/intersection.net.xml -r network/intersection.rou.xml -e 3600 -p 2
   ```
   (`-e 3600` = simulate 1 hour, `-p 2` = a vehicle roughly every 2 seconds — adjust for your demand scenario.)
4. Create `network/intersection.sumocfg`:
   ```xml
   <configuration>
       <input>
           <net-file value="intersection.net.xml"/>
           <route-files value="intersection.rou.xml"/>
       </input>
       <time>
           <begin value="0"/>
           <end value="3600"/>
       </time>
   </configuration>
   ```
5. Run it visually to confirm vehicles actually move through the intersection:
   ```bash
   sumo-gui -c network/intersection.sumocfg
   ```

If you see cars driving and queuing at the junction, your simulation foundation is solid — proceed to TraCI control.

---

## 6. Verify TraCI Can Control the Simulation

Create a throwaway test script `test_traci.py` in the project root:

```python
import os, sys

if 'SUMO_HOME' in os.environ:
    tools = os.path.join(os.environ['SUMO_HOME'], 'tools')
    sys.path.append(tools)
else:
    sys.exit("Please declare SUMO_HOME")

import traci

sumo_cmd = ["sumo", "-c", "network/intersection.sumocfg"]  # headless
traci.start(sumo_cmd)

step = 0
while step < 100:
    traci.simulationStep()
    vehicle_ids = traci.vehicle.getIDList()
    print(f"Step {step}: {len(vehicle_ids)} vehicles active")
    step += 1

traci.close()
```

Run it:
```bash
python test_traci.py
```

If this prints increasing/changing vehicle counts without errors, your entire environment stack (SUMO + SUMO_HOME + TraCI + Python) is fully verified and working. **This is the checkpoint to reach before writing any RL code.**

---

## 7. Common Setup Errors and Fixes

| Error | Cause | Fix |
|---|---|---|
| `ModuleNotFoundError: No module named 'traci'` | `SUMO_HOME/tools` not on Python path, or SUMO_HOME unset | Recheck Step 2; ensure `sys.path.append(tools)` is in your script |
| `SUMO_HOME` not declared | Env variable not set or terminal not restarted | Set it again, restart terminal/IDE fully |
| `traci.exceptions.FatalTraCIError: connection closed by SUMO` | `.sumocfg` file has a bad path or malformed XML | Double check relative paths inside the `.sumocfg` are correct from where you run the script |
| SUMO opens but no vehicles appear | Route file demand starts after your simulation `end` time, or route file wasn't linked in `.sumocfg` | Check `-e` value in randomTrips.py matches your `.sumocfg` end time |
| `netedit`/`sumo-gui` won't launch (Linux) | Missing GUI dependencies | `sudo apt-get install sumo-gui` (separate package on some distros) |
| PyTorch install fails / wrong CUDA build | Installed GPU build on a machine with no compatible GPU | Use the CPU-only index URL shown in Step 3 — this project doesn't need GPU |

---

## 8. What "Done with Setup" Looks Like

Before moving to RL development, you should be able to check off all of these:
- [ ] `sumo --version` runs without error
- [ ] `sumo-gui` opens and you can manually load a `.sumocfg`
- [ ] `echo $SUMO_HOME` (or Windows equivalent) prints a valid path
- [ ] `python -c "import traci"` runs with no error
- [ ] Your minimal test network runs in `sumo-gui` with visible vehicle movement
- [ ] `test_traci.py` runs headless and prints live vehicle counts per step
- [ ] Project folder structure from Step 4 exists

Once every box is checked, you have a fully working foundation — the environment/TraCI layer will not cause you problems later, and you can move straight into state extraction, the Gym wrapper, and the DQN agent.

---

Next step once this is done: build `env/traffic_env.py` (the Gym-style wrapper with `reset()`/`step()`), which is where state extraction, action application (phase switching), and reward calculation actually live.
