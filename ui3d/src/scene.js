// Daytime 3D intersection: roads and markings to the SUMO geometry, a small
// city around it, signal heads driven by the live phase, instanced vehicles,
// and the "agent view" overlay that paints the 71-value state onto the road.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LANE_W, STOP, LANE_LEN, IN_LANES } from './sim.js';

const U = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const right = (v) => [-v[1], v[0]];
const HALF = 2 * LANE_W;        // 6.4 m: half road width (2 lanes each way)
const W = HALF + 0.4;           // curb line
const R = 5;                    // curb corner radius
const SW = 4.6;                 // sidewalk width
const L = 420;                  // drawn arm length

const C = {
  asphalt: '#55595d', asphaltDark: '#4a4e52', concrete: '#dcd6c9', curb: '#c7c0b1', grass: '#a9bb8c', lot: '#e4dccb',
  white: '#f5f3ec', yellow: '#efbf32', pole: '#737a80', housing: '#2a2e31',
  plaster: ['#efe7da', '#e7d5bf', '#dcc6a9', '#cdd6d0', '#ece4d2', '#d8bba4', '#c3cdbf', '#f3eee6', '#e2cdb8'],
  canopy: ['#6f9b53', '#5f8c4a', '#86a95f', '#557f46', '#7aa25a'],
  cars: ['#f4f4f1', '#f4f4f1', '#d6d9dc', '#d6d9dc', '#9da4ab', '#3c4249', '#22304d', '#b5392f', '#2f6e90', '#c8b48c', '#5c806b', '#e9e2d0', '#7a2f3a'],
};

function noiseTexture(size, base, spread, grain = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * spread * (Math.random() < 0.08 * grain ? 2.2 : 1);
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function windowTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#e9e9e9'; g.fillRect(0, 118, 128, 10);           // floor slab line
  g.fillStyle = '#7f95a3'; g.fillRect(26, 30, 76, 66);             // glass
  g.fillStyle = '#a9bcc7'; g.fillRect(26, 30, 76, 12);             // sky reflection
  g.fillStyle = '#f7f7f7'; g.fillRect(62, 30, 4, 66);              // mullion
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function arcPoints(cx, cz, r, a0, a1, n = 14) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); }
  return pts;
}

// Flat polygon in the XZ plane (points given as [x, z]), facing up.
function flatPolygon(points, y = 0) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ShapeGeometry(shape, 4);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  // ensure normals face up regardless of winding
  const n = geo.attributes.normal;
  if (n.getY(0) < 0) {
    const idx = geo.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t; }
    for (let i = 0; i < n.count; i++) n.setY(i, 1);
  }
  return geo;
}

function extrudedPolygon(points, height) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 4 });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function boxUV(geo, w, h, d, su = 4.2, sv = 3.6) {
  // world-scale UVs per face so a repeating window texture lands at storey scale
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [fu, fv] = dims[f];
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(fu / su)), uv.getY(i) * Math.max(1, Math.round(fv / sv)));
    }
  }
  return geo;
}

export class IntersectionScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.5, 2000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.06;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 520;
    this.controls.target.set(0, 0, 0);
    this.controls.addEventListener('start', () => { this.tween = null; this.userMoved = true; });

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    this.buildSky();
    this.buildLights();
    this.buildGround();
    this.buildRoad();
    this.buildMarkings();
    this.buildCity();
    this.buildSignals();
    this.buildVehicles();
    this.buildOverlay();

    this.views = {
      overview: { pos: [62, 58, 74], target: [-2, 0, -2] },
      street: { pos: [-8.6, 3.3, 23.5], target: [-0.5, 2.6, -8] },
      plan: { pos: [0.01, 330, 0.01], target: [0, 0, 0] },
      agent: { pos: [0, 205, 118], target: [0, 0, 6] },
    };
    this.setView('overview', true);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // ---------------------------------------------------------------- world
  buildSky() {
    const geo = new THREE.SphereGeometry(1400, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color('#5d9fe0') }, mid: { value: new THREE.Color('#a9cdef') }, horizon: { value: new THREE.Color('#e6eff3') }, sunDir: { value: new THREE.Vector3(0.5, 0.62, 0.6).normalize() } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunDir; varying vec3 vDir;
        void main(){ float h = max(vDir.y, 0.0);
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.18, h)); c = mix(c, top, smoothstep(0.18, 0.75, h));
          float s = max(dot(normalize(vDir), sunDir), 0.0); c += vec3(1.0,0.93,0.8) * pow(s, 64.0) * 0.55 + vec3(1.0,0.95,0.85) * pow(s, 6.0) * 0.12;
          gl_FragColor = vec4(c, 1.0); }`,
    });
    this.scene.add(new THREE.Mesh(geo, mat));
    this.scene.fog = new THREE.Fog('#dfe9ee', 230, 760);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight('#d7e9ff', '#b5a98d', 1.15));
    const sun = new THREE.DirectionalLight('#fff3e0', 2.6);
    sun.position.set(110, 140, 120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const s = sun.shadow.camera;
    s.left = -130; s.right = 130; s.top = 130; s.bottom = -130; s.near = 20; s.far = 450;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    this.sun = sun;
  }

  buildGround() {
    const grassTex = noiseTexture(256, C.grass, 18);
    grassTex.repeat.set(160, 160);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshStandardMaterial({ color: '#ffffff', map: grassTex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  buildRoad() {
    const pts = [];
    const corner = (sx, sz) => {
      // quarter arc between the two curb lines of quadrant (sx, sz), bulging toward the centre
      const cx = sx * (W + R), cz = sz * (W + R);
      const a1 = Math.atan2(0, -sx);         // point (sx·W, sz·(W+R))
      const a2 = Math.atan2(-sz, 0);         // point (sx·(W+R), sz·W)
      let delta = a2 - a1;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta <= -Math.PI) delta += 2 * Math.PI;
      return arcPoints(cx, cz, R, a1, a1 + delta);
    };
    this.cornerArc = corner;
    // plus-shaped road outline, counter-clockwise from the north arm's east edge
    const arcOrdered = (sx, sz, from) => {
      const a = corner(sx, sz);
      const d0 = Math.hypot(a[0][0] - from[0], a[0][1] - from[1]);
      const d1 = Math.hypot(a[a.length - 1][0] - from[0], a[a.length - 1][1] - from[1]);
      return d0 <= d1 ? a : a.reverse();
    };
    pts.push([W, -L]);
    pts.push(...arcOrdered(1, -1, [W, -(W + R)]));
    pts.push([L, -W], [L, W]);
    pts.push(...arcOrdered(1, 1, [W + R, W]));
    pts.push([W, L], [-W, L]);
    pts.push(...arcOrdered(-1, 1, [-W, W + R]));
    pts.push([-L, W], [-L, -W]);
    pts.push(...arcOrdered(-1, -1, [-(W + R), -W]));
    pts.push([-W, -L]);

    const tex = noiseTexture(512, C.asphalt, 26, 2);
    tex.repeat.set(L / 9, L / 9);
    const roadMat = new THREE.MeshStandardMaterial({ color: '#ffffff', map: tex, roughness: 0.93, metalness: 0 });
    const geo = flatPolygon(pts, 0.0);
    const uv = geo.attributes.uv, pos = geo.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / (2 * L) + 0.5, pos.getZ(i) / (2 * L) + 0.5);
    const road = new THREE.Mesh(geo, roadMat);
    road.receiveShadow = true;
    this.scene.add(road);

    // darker wheel-path wear in each incoming lane near the stop line
    const wear = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.07, depthWrite: false });
    for (const [d, i] of IN_LANES) {
      const dir = [-U[d][0], -U[d][1]];
      const r = right(dir);
      const off = LANE_W / 2 + LANE_W * (1 - i);
      for (const side of [-0.75, 0.75]) {
        const g = new THREE.PlaneGeometry(0.7, 60);
        g.rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(g, wear);
        m.rotation.y = Math.atan2(dir[0], dir[1]);
        m.position.set(U[d][0] * (STOP + 30) + r[0] * (off + side), 0.012, U[d][1] * (STOP + 30) + r[1] * (off + side));
        this.scene.add(m);
      }
    }

    // sidewalks with curbs, one L-shaped slab per quadrant
    const swTex = noiseTexture(256, C.concrete, 10);
    swTex.repeat.set(0.25, 0.25);
    const swMat = new THREE.MeshStandardMaterial({ color: '#ffffff', map: swTex, roughness: 0.9 });
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const arc = arcOrdered(sx, sz, [sx * W, sz * (W + R)]);
      const poly = [[sx * W, sz * L], ...arc, [sx * L, sz * W], [sx * L, sz * (W + SW)], [sx * (W + SW), sz * (W + SW)], [sx * (W + SW), sz * L]];
      const g = extrudedPolygon(poly, 0.16);
      const uvs = g.attributes.uv, p = g.attributes.position;
      for (let i = 0; i < uvs.count; i++) uvs.setXY(i, p.getX(i) * 0.25, p.getZ(i) * 0.25);
      const m = new THREE.Mesh(g, swMat);
      m.receiveShadow = true; m.castShadow = false;
      this.scene.add(m);
      // joints in the paving every 2 m along each frontage
      const joints = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.06, depthWrite: false });
      for (let t = W + R + 1; t < 180; t += 2.2) {
        const a = new THREE.Mesh(new THREE.PlaneGeometry(0.06, SW), joints);
        a.rotation.x = -Math.PI / 2; a.position.set(sx * t, 0.165, sz * (W + SW / 2)); this.scene.add(a);
        const b = new THREE.Mesh(new THREE.PlaneGeometry(SW, 0.06), joints);
        b.rotation.x = -Math.PI / 2; b.position.set(sx * (W + SW / 2), 0.165, sz * t); this.scene.add(b);
      }
    }
  }

  buildMarkings() {
    const white = new THREE.MeshStandardMaterial({ color: C.white, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    const yellow = new THREE.MeshStandardMaterial({ color: C.yellow, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    const y = 0.02;
    const geos = { white: [], yellow: [] };
    // strip helper in arm-local frame: along = distance from centre, across = lateral offset (+ = right of incoming driver)
    const strip = (dir, a0, a1, c0, c1, color) => {
      const u = U[dir], d = [-u[0], -u[1]], r = right(d);
      const P = (a, c) => [u[0] * a + r[0] * c, u[1] * a + r[1] * c];
      const g = flatPolygon([P(a0, c0), P(a1, c0), P(a1, c1), P(a0, c1)], y);
      geos[color].push(g);
    };
    for (const dir of ['N', 'E', 'S', 'W']) {
      // centre double yellow
      strip(dir, STOP, L, -0.28, -0.1, 'yellow');
      strip(dir, STOP, L, 0.1, 0.28, 'yellow');
      // edge lines
      strip(dir, STOP + 1.5, L, HALF - 0.32, HALF - 0.17, 'white');
      strip(dir, STOP + 1.5, L, -(HALF - 0.17), -(HALF - 0.32), 'white');
      // lane dividers: solid for the last 30 m, dashed upstream (3 m dash / 6 m gap)
      for (const side of [1, -1]) {
        const c = side * LANE_W;
        strip(dir, STOP, STOP + 30, c - 0.07, c + 0.07, 'white');
        for (let a = STOP + 36; a < L; a += 9) strip(dir, a, a + 3, c - 0.07, c + 0.07, 'white');
      }
      // stop line across the incoming half
      strip(dir, STOP + 0.05, STOP + 0.55, 0.1, HALF, 'white');
      // zebra crossing between stop line and junction box
      for (let c = -HALF + 0.4; c < HALF - 0.3; c += 1.25) strip(dir, W + 0.4, STOP - 0.6, c, c + 0.65, 'white');
    }
    for (const k of ['white', 'yellow']) {
      const m = new THREE.Mesh(mergeGeometries(geos[k]), k === 'white' ? white : yellow);
      m.receiveShadow = true;
      this.scene.add(m);
    }

    // lane-use arrows 16 m and 46 m before each stop line: lane 0 straight+right, lane 1 straight+left
    const arrow = (turn) => {
      const s = new THREE.Shape();
      // built pointing +Y (shape space), turn branch to +X for right
      const k = turn === 'R' ? 1 : -1;
      const P = [[-0.16, 0], [0.16, 0], [0.16, 2.6], [0.6, 2.6], [0, 4.2], [-0.6, 2.6], [-0.16, 2.6]];
      s.moveTo(P[0][0], P[0][1]); for (const p of P.slice(1)) s.lineTo(p[0], p[1]);
      const b = new THREE.Shape();
      const B = [[0, 1.0], [0.85, 1.6], [0.85, 1.2], [1.6, 1.95], [0.85, 2.7], [0.85, 2.25], [0, 1.65]].map(([x, yy]) => [x * k, yy]);
      b.moveTo(B[0][0], B[0][1]); for (const p of B.slice(1)) b.lineTo(p[0], p[1]);
      const g = mergeGeometries([new THREE.ShapeGeometry(s), new THREE.ShapeGeometry(b)]);
      g.scale(1, 1.6, 1); // road arrows are elongated for drivers
      g.rotateX(-Math.PI / 2);
      return g;
    };
    const arrows = { R: arrow('R'), L: arrow('L') };
    const arrowGeos = [];
    for (const [d, i] of IN_LANES) {
      const dir = [-U[d][0], -U[d][1]];
      const r = right(dir);
      const off = LANE_W / 2 + LANE_W * (1 - i);
      for (const dist of [16, 46]) {
        const g = arrows[i === 0 ? 'R' : 'L'].clone();
        g.rotateY(Math.atan2(-dir[0], -dir[1]));
        g.translate(U[d][0] * (STOP + dist) + r[0] * off, y, U[d][1] * (STOP + dist) + r[1] * off);
        arrowGeos.push(g);
      }
    }
    const am = new THREE.Mesh(mergeGeometries(arrowGeos), white);
    am.receiveShadow = true;
    this.scene.add(am);
  }

  buildCity() {
    const winTex = windowTexture();
    const roofMat = new THREE.MeshStandardMaterial({ color: '#cfc9bd', roughness: 0.95 });
    const mats = C.plaster.map((c) => new THREE.MeshStandardMaterial({ color: c, map: winTex, roughness: 0.88 }));
    const groundMat = new THREE.MeshStandardMaterial({ color: C.lot, roughness: 1 });
    const rnd = mulberry(42);
    const trees = [];
    const add = (mesh) => { mesh.castShadow = true; mesh.receiveShadow = true; this.scene.add(mesh); return mesh; };

    const building = (x, z, w, d, h, mi) => {
      const g = boxUV(new THREE.BoxGeometry(w, h, d), w, h, d);
      const m = mats[mi % mats.length];
      const mesh = new THREE.Mesh(g, [m, m, roofMat, roofMat, m, m]);
      mesh.position.set(x, h / 2 + 0.16, z);
      add(mesh);
      // parapet + rooftop plant
      const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.5, d + 0.4), roofMat);
      cap.position.set(x, h + 0.41, z); add(cap);
      if (w > 9 && rnd() < 0.8) {
        const u = new THREE.Mesh(new THREE.BoxGeometry(2.4 + rnd() * 2, 1.4, 2 + rnd() * 2), new THREE.MeshStandardMaterial({ color: '#b9b6ae', roughness: 0.8 }));
        u.position.set(x + (rnd() - 0.5) * w * 0.5, h + 1.2, z + (rnd() - 0.5) * d * 0.5); add(u);
      }
      // ground-floor shopfront band
      const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 3.6, d + 0.06), new THREE.MeshStandardMaterial({ color: '#5f6f78', roughness: 0.35, metalness: 0.1 }));
      band.position.set(x, 1.95, z); add(band);
      const awn = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.14, d + 0.8), new THREE.MeshStandardMaterial({ color: C.plaster[(mi + 3) % C.plaster.length], roughness: 0.9 }));
      awn.position.set(x, 3.85, z); add(awn);
    };

    const quads = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    const front = W + SW; // building line
    quads.forEach(([sx, sz], qi) => {
      const lot = new THREE.Mesh(flatPolygon([[sx * front, sz * front], [sx * 260, sz * front], [sx * 260, sz * 260], [sx * front, sz * 260]], 0.04), groundMat);
      lot.receiveShadow = true; this.scene.add(lot);
      if (sx === 1 && sz === 1) { this.buildPark(sx, sz, front, trees, rnd); return; }
      // frontage along the east-west street and the north-south street
      for (const axis of ['x', 'z']) {
        let t = front + 2;
        let k = 0;
        while (t < 230) {
          const w = 11 + rnd() * 13, d = 13 + rnd() * 10;
          const nearCorner = t < 30;
          const h = nearCorner ? 12 + rnd() * 10 : 10 + rnd() * 22;
          const along = t + w / 2, depth = front + 1.5 + d / 2;
          const [x, z] = axis === 'x' ? [sx * along, sz * depth] : [sx * depth, sz * along];
          const [bw, bd] = axis === 'x' ? [w, d] : [d, w];
          if (!(axis === 'z' && t < front + 2 + 24)) building(x, z, bw, bd, h, qi * 5 + k);
          t += w + 1.5 + (rnd() < 0.25 ? 6 : 0);
          k++;
        }
      }
      // back blocks
      for (let i = 0; i < 9; i++) {
        const x = sx * (60 + rnd() * 170), z = sz * (60 + rnd() * 170);
        const w = 14 + rnd() * 16, d = 14 + rnd() * 16;
        building(x, z, w, d, 10 + rnd() * 30, i + qi);
      }
    });

    // street trees along every sidewalk, clear of the corners
    for (const [sx, sz] of quads) {
      for (let t = 26; t < 200; t += 13) {
        trees.push([sx * t + (rnd() - 0.5), sz * (W + SW - 1.1), 0.9 + rnd() * 0.35]);
        trees.push([sx * (W + SW - 1.1), sz * t + (rnd() - 0.5), 0.9 + rnd() * 0.35]);
      }
    }
    this.buildTrees(trees, rnd);

    // street lamps
    const lampMat = new THREE.MeshStandardMaterial({ color: C.pole, roughness: 0.5, metalness: 0.4 });
    const lampGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.08, 0.12, 8, 8).translate(0, 4, 0),
      new THREE.BoxGeometry(0.1, 0.1, 2.2).translate(0, 7.95, -1.0),
      new THREE.BoxGeometry(0.42, 0.14, 0.8).translate(0, 7.88, -2.0),
    ]);
    const lamps = [];
    for (const [sx, sz] of quads) for (let t = 33; t < 200; t += 26) {
      lamps.push([sx * t, sz * (W + 0.6), Math.atan2(0, sz)]);
      lamps.push([sx * (W + 0.6), sz * t, Math.atan2(sx, 0)]);
    }
    const lm = new THREE.InstancedMesh(lampGeo, lampMat, lamps.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    lamps.forEach(([x, z, a], i) => { q.setFromEuler(e.set(0, a, 0)); m4.compose(new THREE.Vector3(x, 0.16, z), q, new THREE.Vector3(1, 1, 1)); lm.setMatrixAt(i, m4); });
    lm.castShadow = true;
    this.scene.add(lm);
  }

  buildPark(sx, sz, front, trees, rnd) {
    const lawn = new THREE.Mesh(flatPolygon([[sx * (front + 1.5), sz * (front + 1.5)], [sx * 150, sz * (front + 1.5)], [sx * 150, sz * 150], [sx * (front + 1.5), sz * 150]], 0.07), new THREE.MeshStandardMaterial({ color: '#9fbd7e', roughness: 1 }));
    lawn.receiveShadow = true; this.scene.add(lawn);
    const pathMat = new THREE.MeshStandardMaterial({ color: '#e3d7bf', roughness: 1 });
    const path = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      path.push([sx * (front + 4 + t * 120), sz * (front + 6 + Math.sin(t * 3.2) * 14 + t * 60)]);
    }
    const geos = [];
    for (let i = 0; i < path.length - 1; i++) {
      const [x0, z0] = path[i], [x1, z1] = path[i + 1];
      const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
      const g = new THREE.PlaneGeometry(2.6, len + 0.4);
      g.rotateX(-Math.PI / 2); g.rotateY(Math.atan2(dx, dz)); g.translate((x0 + x1) / 2, 0.09, (z0 + z1) / 2);
      geos.push(g);
    }
    const pm = new THREE.Mesh(mergeGeometries(geos), pathMat); pm.receiveShadow = true; this.scene.add(pm);
    // pavilion
    const pav = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.4, 0.5, 24), new THREE.MeshStandardMaterial({ color: '#e9e2d4' }));
    pav.position.set(sx * 58, 0.3, sz * 66); pav.receiveShadow = true; this.scene.add(pav);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6, 2.4, 24), new THREE.MeshStandardMaterial({ color: '#c9714e', roughness: 0.8 }));
    roof.position.set(sx * 58, 4.6, sz * 66); roof.castShadow = true; this.scene.add(roof);
    for (let a = 0; a < 6; a++) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 3.2, 8), new THREE.MeshStandardMaterial({ color: '#f2eee6' }));
      col.position.set(sx * 58 + Math.cos(a) * 4.4, 2.0, sz * 66 + Math.sin(a) * 4.4); col.castShadow = true; this.scene.add(col);
    }
    for (let i = 0; i < 70; i++) {
      const x = sx * (front + 6 + rnd() * 135), z = sz * (front + 6 + rnd() * 135);
      if (Math.hypot(x - sx * 58, z - sz * 66) < 10) continue;
      trees.push([x, z, 0.9 + rnd() * 0.8]);
    }
  }

  buildTrees(list, rnd) {
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 3.2, 6).translate(0, 1.6, 0);
    const canopyGeo = new THREE.IcosahedronGeometry(2.5, 1).translate(0, 4.6, 0);
    const trunk = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#7a6250', roughness: 1 }), list.length);
    const canopy = new THREE.InstancedMesh(canopyGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }), list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    list.forEach(([x, z, s], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
      m4.compose(new THREE.Vector3(x, 0.1, z), q, new THREE.Vector3(s, s * (0.9 + rnd() * 0.3), s));
      trunk.setMatrixAt(i, m4); canopy.setMatrixAt(i, m4);
      canopy.setColorAt(i, col.set(C.canopy[Math.floor(rnd() * C.canopy.length)]));
    });
    trunk.castShadow = canopy.castShadow = true;
    canopy.receiveShadow = true;
    this.scene.add(trunk, canopy);
  }

  // -------------------------------------------------------------- signals
  buildSignals() {
    this.lamps = { N: {}, E: {}, S: {}, W: {} };
    const poleMat = new THREE.MeshStandardMaterial({ color: C.pole, roughness: 0.45, metalness: 0.5 });
    const housingMat = new THREE.MeshStandardMaterial({ color: C.housing, roughness: 0.6 });
    const plateMat = new THREE.MeshStandardMaterial({ color: '#1b1e20', roughness: 0.7 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.6 });
    const lensOn = { R: '#ff3b2f', Y: '#ffb300', G: '#22d67a' };
    const lensOff = { R: '#3a1715', Y: '#3a2a10', G: '#11301f' };
    this.lensMats = {};
    for (const d of ['N', 'E', 'S', 'W']) {
      this.lensMats[d] = {};
      for (const k of ['R', 'Y', 'G']) this.lensMats[d][k] = new THREE.MeshStandardMaterial({ color: lensOff[k], emissive: lensOn[k], emissiveIntensity: 0, roughness: 0.25 });
    }
    this.lensOn = lensOn;

    const head = (d) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 1.25, 0.34), housingMat);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.86, 1.62, 0.04), plateMat);
      plate.position.z = 0.19;
      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.66, 0.02), edgeMat);
      rim.position.z = 0.215;
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.66, 0.02), plateMat);
      back.position.z = 0.24;
      g.add(body, plate, rim, back);
      ['R', 'Y', 'G'].forEach((k, i) => {
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.15, 20), this.lensMats[d][k]);
        lens.position.set(0, 0.4 - i * 0.4, -0.172);
        lens.rotation.y = Math.PI;
        const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.035, 0.24), housingMat);
        visor.position.set(0, 0.4 - i * 0.4 + 0.18, -0.29);
        g.add(lens, visor);
      });
      g.traverse((o) => { o.castShadow = true; });
      return g;
    };

    for (const d of ['N', 'E', 'S', 'W']) {
      const u = U[d], dir = [-u[0], -u[1]], r = right(dir);
      // far-side mast arm on the driver's right-hand corner
      const base = [-u[0] * (STOP + 1.4) + r[0] * (W + 1.3), -u[1] * (STOP + 1.4) + r[1] * (W + 1.3)];
      const grp = new THREE.Group();
      grp.position.set(base[0], 0.16, base[1]);
      // local frame: +z = travel direction of the approaching driver, +x = their right
      grp.rotation.y = Math.atan2(dir[0], dir[1]);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 6.6, 12), poleMat);
      pole.position.y = 3.3;
      const armLen = W + 1.3 - LANE_W * 0.9;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, armLen, 10), poleMat);
      arm.rotation.z = Math.PI / 2;
      // grp local +x is the driver's left, so the arm reaches out over the lanes along +x
      arm.position.set(armLen / 2, 6.2, 0);
      const h1 = head(d); h1.position.set(armLen - 0.1, 5.35, 0);
      const h2 = head(d); h2.position.set(0, 3.0, -0.36);
      grp.add(pole, arm, h1, h2);
      grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.scene.add(grp);
    }
  }

  setSignals(states) {
    // states: {N:'G'|'Y'|'R', ...}
    for (const d of ['N', 'E', 'S', 'W']) for (const k of ['R', 'Y', 'G']) {
      const m = this.lensMats[d][k];
      const on = states[d] === k;
      m.emissiveIntensity = on ? 3.2 : 0;
      m.color.set(on ? this.lensOn[k] : { R: '#3a1715', Y: '#3a2a10', G: '#11301f' }[k]);
    }
  }

  // ------------------------------------------------------------- vehicles
  buildVehicles() {
    const rb = (w, h, d, r = 0.18) => new RoundedBoxGeometry(w, h, d, 2, r);
    const body = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.38, metalness: 0.25 });
    const glass = new THREE.MeshStandardMaterial({ color: '#27323b', roughness: 0.15, metalness: 0.6 });
    const tyre = new THREE.MeshStandardMaterial({ color: '#1d1f21', roughness: 0.9 });
    const tail = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const wheel = (r, w) => new THREE.CylinderGeometry(r, r, w, 14).rotateZ(Math.PI / 2);
    const wheels = (W2, L2, r, w, y = r) => {
      const gs = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) gs.push(wheel(r, w).translate(sx * (W2 / 2 - w / 2 + 0.02), y, sz * (L2 / 2 - r * 1.6)));
      return mergeGeometries(gs);
    };
    const tails = (W2, L2, y) => mergeGeometries([-1, 1].map((sx) => new THREE.BoxGeometry(0.34, 0.14, 0.06).translate(sx * (W2 / 2 - 0.3), y, -L2 / 2 - 0.01)));
    // forward is +z
    this.vtypes = {
      car: { max: 520, parts: [
        { g: rb(1.8, 0.66, 4.9, 0.2).translate(0, 0.62, 0), m: body('#ffffff'), tint: true },
        { g: rb(1.6, 0.5, 2.5, 0.16).translate(0, 1.16, -0.28), m: glass },
        { g: rb(1.5, 0.1, 2.1, 0.05).translate(0, 1.42, -0.32), m: body('#ffffff'), tint: true },
        { g: wheels(1.8, 4.9, 0.34, 0.24), m: tyre },
        { g: tails(1.8, 4.9, 0.78), m: tail, brake: true },
      ] },
      bus: { max: 90, parts: [
        { g: rb(2.5, 2.5, 11.9, 0.22).translate(0, 1.72, 0), m: body('#ffffff'), tint: true },
        { g: new THREE.BoxGeometry(2.54, 0.95, 11.0).translate(0, 2.25, 0.2), m: glass },
        { g: rb(2.2, 0.22, 10.8, 0.08).translate(0, 3.02, 0), m: body('#eceae4') },
        { g: wheels(2.5, 11.9, 0.5, 0.32), m: tyre },
        { g: tails(2.5, 11.9, 0.9), m: tail, brake: true },
      ] },
      motorcycle: { max: 340, parts: [
        { g: rb(0.42, 0.5, 2.0, 0.12).translate(0, 0.62, 0), m: body('#2b2e33') },
        { g: rb(0.5, 0.62, 0.42, 0.14).translate(0, 1.24, -0.2), m: body('#ffffff'), tint: true },
        { g: new THREE.SphereGeometry(0.17, 12, 10).translate(0, 1.72, -0.12), m: body('#f1efe9') },
        { g: mergeGeometries([wheel(0.3, 0.12).translate(0, 0.3, 0.68), wheel(0.3, 0.12).translate(0, 0.3, -0.68)]), m: tyre },
        { g: new THREE.BoxGeometry(0.2, 0.1, 0.05).translate(0, 0.78, -1.01), m: tail, brake: true },
      ] },
      auto: { max: 220, parts: [
        { g: rb(1.36, 0.72, 2.75, 0.16).translate(0, 0.66, 0), m: body('#2f7a4b') },
        { g: rb(1.3, 0.86, 1.95, 0.22).translate(0, 1.5, -0.25), m: body('#f2c230') },
        { g: new THREE.BoxGeometry(1.24, 0.5, 0.06).translate(0, 1.36, 0.74), m: glass },
        { g: mergeGeometries([wheel(0.24, 0.16).translate(0, 0.24, 1.0), wheel(0.24, 0.16).translate(-0.56, 0.24, -0.9), wheel(0.24, 0.16).translate(0.56, 0.24, -0.9)]), m: tyre },
        { g: tails(1.36, 2.75, 0.7), m: tail, brake: true },
      ] },
    };
    this.busColors = ['#d4553f', '#2f78a8', '#e3a33a'];
    this.motoColors = ['#c0392b', '#2c3e50', '#d35400', '#16a085', '#7f8c8d', '#f2c230'];
    for (const t of Object.values(this.vtypes)) {
      t.meshes = t.parts.map((p) => {
        const im = new THREE.InstancedMesh(p.g, p.m, t.max);
        im.castShadow = !p.brake;
        im.receiveShadow = true;
        im.count = 0;
        im.frustumCulled = false;
        if (p.tint || p.brake) im.setColorAt(0, new THREE.Color('#ffffff'));
        this.scene.add(im);
        return im;
      });
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color(); this._yAxis = new THREE.Vector3(0, 1, 0);
  }

  updateVehicles(sim) {
    const counts = { car: 0, bus: 0, motorcycle: 0, auto: 0 };
    for (const v of sim.vehicles) {
      const type = v.type === 'passenger' ? 'car' : v.type;
      const t = this.vtypes[type];
      const i = counts[type];
      if (i >= t.max) continue;
      counts[type]++;
      const [x, z, h] = sim.pose(v);
      this._p.set(x, 0.0, z);
      this._q.setFromAxisAngle(this._yAxis, h);
      this._m.compose(this._p, this._q, this._s);
      const palette = type === 'bus' ? this.busColors : type === 'motorcycle' ? this.motoColors : C.cars;
      t.parts.forEach((p, k) => {
        const im = t.meshes[k];
        im.setMatrixAt(i, this._m);
        if (p.tint) im.setColorAt(i, this._c.set(palette[v.color % palette.length]));
        if (p.brake) im.setColorAt(i, this._c.set(v.acc < -0.8 || v.v < 0.1 ? '#ff2a1f' : '#6b1c18'));
      });
    }
    for (const [type, t] of Object.entries(this.vtypes)) {
      for (const im of t.meshes) {
        im.count = counts[type];
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }
  }

  // ------------------------------------------------------- agent overlay
  buildOverlay() {
    this.overlay = new THREE.Group();
    this.overlay.visible = false;
    this.cells = [];
    this.pillars = [];
    const CELL = 200 / 3;
    const outline = new THREE.LineBasicMaterial({ color: '#f5f3ec', transparent: true, opacity: 0.85 });
    IN_LANES.forEach(([d, i], li) => {
      const u = U[d], dir = [-u[0], -u[1]], r = right(dir);
      const off = LANE_W / 2 + LANE_W * (1 - i);
      for (let c = 0; c < 3; c++) {
        // env cell c spans distance-from-stop-line [c·66.7 − 10.4, (c+1)·66.7 − 10.4] (LANE_LENGTH=200 vs 189.6 m lane)
        const a0 = Math.max(0, c * CELL - 10.4) + 0.6, a1 = Math.min(LANE_LEN, (c + 1) * CELL - 10.4) - 0.6;
        const len = a1 - a0, mid = STOP + (a0 + a1) / 2;
        const geo = new THREE.PlaneGeometry(LANE_W - 0.5, len);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({ color: '#36c2b4', transparent: true, opacity: 0.1, depthWrite: false, fog: false });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.y = Math.atan2(dir[0], dir[1]);
        mesh.position.set(u[0] * mid + r[0] * off, 0.06, u[1] * mid + r[1] * off);
        mesh.renderOrder = 2;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), outline);
        edges.rotation.copy(mesh.rotation); edges.position.copy(mesh.position); edges.position.y = 0.07;
        this.overlay.add(mesh, edges);
        this.cells[li * 3 + c] = mesh;
      }
      // queue pillar at the stop line
      const pg = new THREE.BoxGeometry(LANE_W - 0.8, 1, 1.6).translate(0, 0.5, 0);
      const pm = new THREE.MeshStandardMaterial({ color: '#efbf32', transparent: true, opacity: 0.85, roughness: 0.5, emissive: '#efbf32', emissiveIntensity: 0.25 });
      const pillar = new THREE.Mesh(pg, pm);
      pillar.position.set(u[0] * (STOP + 2.2) + r[0] * off, 0.05, u[1] * (STOP + 2.2) + r[1] * off);
      pillar.rotation.y = Math.atan2(dir[0], dir[1]);
      pillar.scale.y = 0.01;
      pillar.castShadow = false;
      this.overlay.add(pillar);
      // number label
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
      sprite.scale.set(6, 3, 1);
      sprite.renderOrder = 5;
      this.overlay.add(sprite);
      this.pillars[li] = { pillar, sprite, cv, tex, last: -1, base: pillar.position.clone() };
    });
    this.scene.add(this.overlay);
    this.slow = new THREE.Color('#ff6a3d');
    this.fast = new THREE.Color('#2fc6b0');
  }

  setOverlay(on) { this.overlay.visible = on; }

  updateOverlay(state) {
    if (!this.overlay.visible || !state) return;
    for (let li = 0; li < 8; li++) {
      for (let c = 0; c < 3; c++) {
        const m = this.cells[li * 3 + c];
        const dens = state[li * 3 + c], sp = state[24 + li * 3 + c];
        m.material.opacity = dens > 0 ? 0.22 + 0.62 * dens : 0.07;
        m.material.color.copy(this.slow).lerp(this.fast, dens > 0 ? sp : 1);
      }
      const q = Math.round(state[48 + li] * 20);
      const P = this.pillars[li];
      const h = Math.max(0.01, q * 0.9);
      P.pillar.scale.y += (h - P.pillar.scale.y) * 0.2;
      P.sprite.position.set(P.base.x, P.pillar.scale.y + 2.2, P.base.z);
      P.sprite.visible = q > 0;
      P.sprite.visible = q > 0;
      if (q !== P.last) {
        P.last = q;
        const g = P.cv.getContext('2d');
        g.clearRect(0, 0, 128, 64);
        g.fillStyle = 'rgba(38,40,42,0.92)';
        g.beginPath(); g.roundRect(14, 6, 100, 52, 8); g.fill();
        g.fillStyle = '#f5f3ec';
        g.font = '700 34px "Overpass Mono", monospace';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(q), 64, 34);
        P.tex.needsUpdate = true;
      }
    }
  }

  // --------------------------------------------------------------- camera
  setView(name, instant = false) {
    const v = this.views[name];
    if (!v) return;
    this.view = name;
    const to = { pos: new THREE.Vector3(...v.pos), target: new THREE.Vector3(...v.target) };
    if (instant) {
      this.camera.position.copy(to.pos); this.controls.target.copy(to.target); this.controls.update();
      this.tween = null; return;
    }
    this.tween = { from: { pos: this.camera.position.clone(), target: this.controls.target.clone() }, to, t: 0, dur: 1.3 };
  }

  heading() {
    // camera azimuth relative to north (−z), radians
    const d = new THREE.Vector3().subVectors(this.controls.target, this.camera.position);
    return Math.atan2(d.x, -d.z);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // keep the junction framed on narrow screens
    this.camera.fov = w / h < 0.9 ? 48 : 34;
    this.camera.updateProjectionMatrix();
  }

  render(dt) {
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const k = 1 - Math.pow(2, -10 * tw.t);
      this.camera.position.lerpVectors(tw.from.pos, tw.to.pos, k);
      this.controls.target.lerpVectors(tw.from.target, tw.to.target, k);
      if (tw.t >= 1) this.tween = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
