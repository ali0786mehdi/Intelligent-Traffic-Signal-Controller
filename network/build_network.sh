#!/bin/bash
# build_network.sh — Generate a valid SUMO network for the 4-way intersection
# using netconvert on plain node/edge/connection source files.
# IDs match the route files (N_in/S_in/E_in/W_in, N_out/..., junction 'center')
# and the 16-link TLS state layout in tls.add.xml.
#
# Run inside the container:  bash network/build_network.sh
set -e
cd "$(dirname "$0")"

# ---- Node file: 4 arm endpoints + center junction (traffic_light) ----
cat > _gen.nod.xml <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<nodes>
    <node id="center" x="0.0"   y="0.0"    type="traffic_light" tl="center"/>
    <node id="N"      x="0.0"   y="200.0"  type="priority"/>
    <node id="S"      x="0.0"   y="-200.0" type="priority"/>
    <node id="E"      x="200.0" y="0.0"    type="priority"/>
    <node id="W"      x="-200.0" y="0.0"   type="priority"/>
</nodes>
EOF

# ---- Edge file: 4 incoming + 4 outgoing, 2 lanes each, 13.89 m/s ----
cat > _gen.edg.xml <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<edges>
    <edge id="N_in"  from="N" to="center" priority="1" numLanes="2" speed="13.89"/>
    <edge id="S_in"  from="S" to="center" priority="1" numLanes="2" speed="13.89"/>
    <edge id="E_in"  from="E" to="center" priority="1" numLanes="2" speed="13.89"/>
    <edge id="W_in"  from="W" to="center" priority="1" numLanes="2" speed="13.89"/>
    <edge id="N_out" from="center" to="N" priority="1" numLanes="2" speed="13.89"/>
    <edge id="S_out" from="center" to="S" priority="1" numLanes="2" speed="13.89"/>
    <edge id="E_out" from="center" to="E" priority="1" numLanes="2" speed="13.89"/>
    <edge id="W_out" from="center" to="W" priority="1" numLanes="2" speed="13.89"/>
</edges>
EOF

# ---- Connection file: define the 16 links in the exact order tls.add.xml documents ----
# Link index order (from tls.add.xml):
#  0: N_in_0 -> S_out (through)      1: N_in_0 -> W_out (right)
#  2: N_in_1 -> S_out (through)      3: N_in_1 -> E_out (left)
#  4: S_in_0 -> N_out (through)      5: S_in_0 -> E_out (right)
#  6: S_in_1 -> N_out (through)      7: S_in_1 -> W_out (left)
#  8: E_in_0 -> W_out (through)      9: E_in_0 -> N_out (right)
# 10: E_in_1 -> W_out (through)     11: E_in_1 -> S_out (left)
# 12: W_in_0 -> E_out (through)     13: W_in_0 -> S_out (right)
# 14: W_in_1 -> E_out (through)     15: W_in_1 -> N_out (left)
cat > _gen.con.xml <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<connections>
    <connection from="N_in" to="S_out" fromLane="0" toLane="0" linkIndex="0"/>
    <connection from="N_in" to="W_out" fromLane="0" toLane="0" linkIndex="1"/>
    <connection from="N_in" to="S_out" fromLane="1" toLane="1" linkIndex="2"/>
    <connection from="N_in" to="E_out" fromLane="1" toLane="1" linkIndex="3"/>
    <connection from="S_in" to="N_out" fromLane="0" toLane="0" linkIndex="4"/>
    <connection from="S_in" to="E_out" fromLane="0" toLane="0" linkIndex="5"/>
    <connection from="S_in" to="N_out" fromLane="1" toLane="1" linkIndex="6"/>
    <connection from="S_in" to="W_out" fromLane="1" toLane="1" linkIndex="7"/>
    <connection from="E_in" to="W_out" fromLane="0" toLane="0" linkIndex="8"/>
    <connection from="E_in" to="N_out" fromLane="0" toLane="0" linkIndex="9"/>
    <connection from="E_in" to="W_out" fromLane="1" toLane="1" linkIndex="10"/>
    <connection from="E_in" to="S_out" fromLane="1" toLane="1" linkIndex="11"/>
    <connection from="W_in" to="E_out" fromLane="0" toLane="0" linkIndex="12"/>
    <connection from="W_in" to="S_out" fromLane="0" toLane="0" linkIndex="13"/>
    <connection from="W_in" to="E_out" fromLane="1" toLane="1" linkIndex="14"/>
    <connection from="W_in" to="N_out" fromLane="1" toLane="1" linkIndex="15"/>
</connections>
EOF

# ---- Compile with netconvert ----
# --tls.default-type static  gives the embedded TLS a program; tls.add.xml overrides at runtime.
# --no-internal-links false  keeps internal junction lanes so permissive-turn foes are modeled.
# --tls.ignore-internal-junction-jam  prevents spurious deadlock on permissive left turns.
netconvert \
    --node-files _gen.nod.xml \
    --edge-files _gen.edg.xml \
    --connection-files _gen.con.xml \
    --tls.default-type static \
    --output-file intersection.net.xml \
    --no-turnarounds true \
    --tls.ignore-internal-junction-jam true \
    --check-lane-foes.all true

echo "netconvert done -> intersection.net.xml"

# ---- Clean up temp source files ----
rm -f _gen.nod.xml _gen.edg.xml _gen.con.xml

echo "BUILD_NETWORK_OK"
