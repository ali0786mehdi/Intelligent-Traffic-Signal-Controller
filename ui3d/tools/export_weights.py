"""
Export a trained D3QN checkpoint (agent/models/dqn_<scenario>.pt) to JSON
so the 3D UI can run the SUMO-trained policy in the browser.

    python ui3d/tools/export_weights.py agent/models/dqn_asymmetric.pt dqn_asymmetric.json

Then open the UI, watch the D3QN, and use "Load a SUMO checkpoint".
The JSON keeps the PyTorch state_dict names (trunk.0.weight, value_head.2.bias, ...).
"""
import json
import sys

import torch


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    src, dst = sys.argv[1], sys.argv[2]
    ckpt = torch.load(src, map_location="cpu")
    state = ckpt["online"] if isinstance(ckpt, dict) and "online" in ckpt else ckpt
    weights = {k: v.detach().cpu().numpy().round(6).tolist() for k, v in state.items()}
    in_dim = len(weights["trunk.0.weight"][0])
    if in_dim != 71:
        print(f"warning: network expects {in_dim} inputs; the UI state vector has 71")
    with open(dst, "w", encoding="utf-8") as fh:
        json.dump({"format": "d3qn-torch-v1", "source": src, "weights": weights}, fh)
    print(f"wrote {dst} ({len(weights)} tensors)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
