#!/usr/bin/env python3
"""
verify_sumo.py
==============
Smoke-test script for the Intelligent Traffic Signal Controller SUMO environment.

What it checks:
  1. SUMO_HOME environment variable is set and points to a valid SUMO install.
  2. traci and sumolib packages are importable.
  3. SUMO (headless) starts successfully with the balanced demand scenario.
  4. 100 simulation steps run without errors.
  5. Reads and prints: lane IDs at the junction, a waiting-time sample,
     and the current TLS phase index.
  6. TraCI connection closes cleanly.

Exit codes:
  0 — all checks passed
  1 — any failure
"""

import os
import sys
import traceback

NETWORK_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "network")
SUMOCFG     = os.path.join(NETWORK_DIR, "intersection_balanced.sumocfg")
NUM_STEPS   = 100
TLS_ID      = "center"


# ---------------------------------------------------------------------------
# 1. Check SUMO_HOME
# ---------------------------------------------------------------------------
def check_sumo_home() -> str:
    """Return path to sumo binary, or raise RuntimeError."""
    sumo_home = os.environ.get("SUMO_HOME", "")
    if not sumo_home:
        raise RuntimeError(
            "SUMO_HOME environment variable is not set.\n"
            "Fix: set SUMO_HOME to your SUMO installation directory, e.g.\n"
            "  Windows : set SUMO_HOME=C:\\Program Files (x86)\\Eclipse\\Sumo\n"
            "  Linux   : export SUMO_HOME=/usr/share/sumo\n"
            "  macOS   : export SUMO_HOME=/opt/homebrew/opt/sumo/share/sumo"
        )

    # Verify the directory exists
    if not os.path.isdir(sumo_home):
        raise RuntimeError(
            f"SUMO_HOME is set to '{sumo_home}' but that directory does not exist."
        )

    # Locate the headless sumo binary
    candidates = [
        os.path.join(sumo_home, "bin", "sumo"),
        os.path.join(sumo_home, "bin", "sumo.exe"),
    ]
    sumo_bin = next((c for c in candidates if os.path.isfile(c)), None)
    if sumo_bin is None:
        raise RuntimeError(
            f"Could not find 'sumo' binary under {sumo_home}/bin/.\n"
            f"Checked: {candidates}"
        )

    print(f"[OK] SUMO_HOME = {sumo_home}")
    print(f"[OK] sumo binary found: {sumo_bin}")
    return sumo_bin


# ---------------------------------------------------------------------------
# 2. Import traci and sumolib
# ---------------------------------------------------------------------------
def import_sumo_libs():
    """Import traci and sumolib; add SUMO tools to path if needed."""
    sumo_home = os.environ["SUMO_HOME"]
    tools_path = os.path.join(sumo_home, "tools")
    if tools_path not in sys.path:
        sys.path.insert(0, tools_path)

    try:
        import traci  # noqa: F401 — checking importability
        _ver = getattr(traci, "__version__", None) or getattr(getattr(traci, "constants", None), "TRACI_VERSION", None) or "unknown"
        print(f"[OK] traci imported successfully (version: {_ver})")
    except ImportError as exc:
        raise RuntimeError(
            "Failed to import 'traci'.\n"
            f"  Error: {exc}\n"
            "  Make sure $SUMO_HOME/tools is on PYTHONPATH, or install traci via pip."
        ) from exc

    try:
        import sumolib  # noqa: F401
        print(f"[OK] sumolib imported successfully")
    except ImportError as exc:
        raise RuntimeError(
            "Failed to import 'sumolib'.\n"
            f"  Error: {exc}\n"
            "  Make sure $SUMO_HOME/tools is on PYTHONPATH."
        ) from exc

    return True


# ---------------------------------------------------------------------------
# 3. Run simulation smoke-test via TraCI
# ---------------------------------------------------------------------------
def run_simulation_test(sumo_bin: str):
    """
    Start SUMO headless, run NUM_STEPS steps, read state, close cleanly.
    Returns a dict of sampled state values.
    """
    # Import here (after path setup in import_sumo_libs)
    import traci

    if not os.path.isfile(SUMOCFG):
        raise RuntimeError(
            f"Scenario config not found: {SUMOCFG}\n"
            "Run this script from the project root, or check the network/ directory."
        )

    sumo_cmd = [
        sumo_bin,
        "--configuration-file", SUMOCFG,
        "--no-step-log",        "true",
        "--no-warnings",        "false",
        "--quit-on-end",        "true",
    ]

    print(f"\n[INFO] Starting SUMO headless simulation...")
    print(f"       Config : {SUMOCFG}")
    print(f"       Command: {' '.join(sumo_cmd)}\n")

    port = 8813  # default TraCI port
    results = {}

    traci.start(sumo_cmd, port=port)
    try:
        print(f"[OK] TraCI connection established on port {port}")

        # ----------------------------------------------------------------
        # Collect lane IDs visible to TraCI
        # ----------------------------------------------------------------
        all_lane_ids = traci.lane.getIDList()
        # Filter to just the 8 approach lanes (not internal :center_* lanes)
        approach_lanes = sorted(
            [lid for lid in all_lane_ids if not lid.startswith(":")]
        )
        print(f"\n[INFO] Approach lane IDs ({len(approach_lanes)} lanes):")
        for lid in approach_lanes:
            print(f"       {lid}")
        results["approach_lanes"] = approach_lanes

        # ----------------------------------------------------------------
        # Run NUM_STEPS simulation steps
        # ----------------------------------------------------------------
        print(f"\n[INFO] Running {NUM_STEPS} simulation steps...")
        for step in range(NUM_STEPS):
            traci.simulationStep()

        sim_time = traci.simulation.getTime()
        print(f"[OK] Completed {NUM_STEPS} steps. Simulation time: {sim_time:.1f} s")
        results["sim_time_after_100_steps"] = sim_time

        # ----------------------------------------------------------------
        # Read waiting time for each approach lane
        # ----------------------------------------------------------------
        print(f"\n[INFO] Waiting times per approach lane at t={sim_time:.0f}s:")
        waiting_times = {}
        for lid in approach_lanes:
            wt = traci.lane.getWaitingTime(lid)
            waiting_times[lid] = wt
            print(f"       {lid:20s}: {wt:.2f} s")
        results["waiting_times"] = waiting_times

        # ----------------------------------------------------------------
        # Read current TLS phase
        # ----------------------------------------------------------------
        tls_ids = traci.trafficlight.getIDList()
        if TLS_ID in tls_ids:
            phase_index  = traci.trafficlight.getPhase(TLS_ID)
            phase_state  = traci.trafficlight.getRedYellowGreenState(TLS_ID)
            program_id   = traci.trafficlight.getProgram(TLS_ID)
            next_switch  = traci.trafficlight.getNextSwitch(TLS_ID)
            print(f"\n[INFO] Traffic light '{TLS_ID}':")
            print(f"       Active program : {program_id}")
            print(f"       Current phase  : {phase_index}")
            print(f"       Phase state    : {phase_state}")
            print(f"       Next switch at : {next_switch:.1f} s")
            results["tls_phase_index"] = phase_index
            results["tls_phase_state"] = phase_state
            results["tls_program"]     = program_id
        else:
            print(f"[WARN] TLS ID '{TLS_ID}' not found. Available IDs: {tls_ids}")

        # ----------------------------------------------------------------
        # Read vehicle count
        # ----------------------------------------------------------------
        n_vehicles = traci.vehicle.getIDCount()
        print(f"\n[INFO] Vehicles currently in simulation: {n_vehicles}")
        results["vehicle_count"] = n_vehicles

    finally:
        traci.close()
        print("\n[OK] TraCI connection closed cleanly.")

    return results


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    print("=" * 60)
    print("  SUMO Environment Smoke Test")
    print("=" * 60)

    try:
        # Step 1: SUMO_HOME
        sumo_bin = check_sumo_home()

        # Step 2: imports
        import_sumo_libs()

        # Step 3: simulation
        results = run_simulation_test(sumo_bin)

        print("\n" + "=" * 60)
        print("  ALL CHECKS PASSED")
        print("=" * 60)
        print(f"\nSummary:")
        print(f"  Approach lanes   : {len(results.get('approach_lanes', []))}")
        print(f"  Sim time reached : {results.get('sim_time_after_100_steps', 'N/A')} s")
        print(f"  TLS program      : {results.get('tls_program', 'N/A')}")
        print(f"  TLS phase index  : {results.get('tls_phase_index', 'N/A')}")
        print(f"  Vehicles in sim  : {results.get('vehicle_count', 'N/A')}")
        return 0

    except Exception:  # pylint: disable=broad-except
        print("\n" + "=" * 60)
        print("  SMOKE TEST FAILED")
        print("=" * 60)
        traceback.print_exc()
        print("\nRuntime requirements for this script:")
        print("  1. SUMO installed (https://sumo.dlr.de/docs/Installing/index.html)")
        print("  2. SUMO_HOME env var set to the SUMO installation directory")
        print("  3. $SUMO_HOME/tools on PYTHONPATH  (or traci installed via pip)")
        print("  4. Run from the project root directory")
        print("  5. Python 3.8+")
        return 1


if __name__ == "__main__":
    sys.exit(main())
