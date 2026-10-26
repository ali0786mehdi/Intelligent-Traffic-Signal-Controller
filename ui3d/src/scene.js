// Stylized daytime New York intersection.
// Roads and markings follow the SUMO geometry. Buildings, park, props, sky and
// clouds are procedural; cars are Kenney Car Kit (CC0) under toon shading.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LANE_W, STOP, LANE_LEN, IN_LANES } from './sim.js';
import { mulberry, arcPoints, flatPolygon, extrudedPolygon, atlasCells, dominantCell } from './scene-util.js';
import {
  toon, asphaltTex, slabTex, plazaTex, wornAlpha, patchPaint, canopyGeometry, grassGeometry, grassMaterial, cloudGeometry,
} from './stylize.js';
import { NYCBuilder } from './nyc.js';
import carsUrl from './assets/cars.glb?url';

const U = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const right = (v) => [-v[1], v[0]];
const HALF = 2 * LANE_W;
const W = HALF + 0.4;           // curb line
const R = 5;                    // curb corner radius
const SW = 4.6;                 // sidewalk width
const L = 420;
const FRONT = W + SW;           // building line

const C = {
  white: '#fbfaf4', yellow: '#f2bf3c', housing: '#202326', pole: '#6a7076',
  grass: '#79ad4c', ground: '#86b552', water: '#4fb3c4',
};
const PAINT = ['#f4f4f0', '#f4f4f0', '#1d1f22', '#1d1f22', '#bfc4c9', '#8b9197', '#22324f', '#8e2a26', '#2f5f86', '#5b6a52', '#d9d3c4'];
const CAR_MODELS = ['sedan', 'sedan-sports', 'hatchback-sports', 'suv', 'suv-luxury', 'taxi', 'van'];
const CAR_WEIGHTS = [5, 2, 3, 3, 2, 6, 1];       // yellow cabs everywhere
const LEAF = ['#4f9b3e', '#5daa43', '#468d3a', '#6db64a', '#3f8436', '#78b94d'];

function plain(geo) {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = geo.attributes[name];
    if (!a) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  g.setIndex(geo.index ? Array.from(geo.index.array) : [...Array(geo.attributes.position.count).keys()]);
  return g;
}

export class IntersectionScene {
  constructor(canvas, { quality = 'auto' } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.dpr = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.5, 4000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 560;
    this.controls.autoRotateSpeed = 0.45;
    this.controls.addEventListener('start', () => { this.tween = null; this.controls.autoRotate = false; this.onUserCamera?.(); });

    this.time = { value: 0 };
    this.vis = new Map();
    this.rnd = mulberry(42);
    this.views = {
      overview: { pos: [104, 86, 122], target: [-4, 4, -4] },
      street: { pos: [-0.3, 4.4, 38], target: [0.5, 3.6, -12] },
      plan: { pos: [0, 330, 0.01], target: [0, 0, 0] },
      tour: { pos: [64, 16, 54], target: [0, 8, 0] },
      agent: { pos: [0, 205, 118], target: [0, 0, 6] },
    };
    this.camera.position.set(230, 210, 270);
    this.controls.update();
    this.ready = this.load();
  }

  async load() {
    const cars = await new GLTFLoader().loadAsync(carsUrl);
    this.buildSky();
    this.buildLights();
    this.buildGround();
    this.buildRoad();
    this.buildMarkings();
    this.buildCity();
    this.buildPark();
    this.buildStreetFurniture();
    this.buildSignals();
    this.buildVehicles(cars);
    this.buildOverlay();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.compile(this.scene, this.camera);
    return this;
  }

  // ---------------------------------------------------------------- world
  buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color('#2f7fd6') }, mid: { value: new THREE.Color('#79b9ec') },
        horizon: { value: new THREE.Color('#e6eef0') }, sun: { value: new THREE.Vector3(0.55, 0.62, -0.56).normalize() },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sun; varying vec3 vDir;
        void main(){ float h = max(vDir.y, 0.0);
          vec3 c = mix(horizon, mid, smoothstep(0.0, 0.22, h)); c = mix(c, top, smoothstep(0.22, 0.85, h));
          float s = max(dot(normalize(vDir), sun), 0.0);
          c = mix(c, vec3(1.0, 0.97, 0.9), pow(s, 220.0)) + vec3(1.0, 0.9, 0.7) * pow(s, 8.0) * 0.12;
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(2600, 32, 16), mat));
    this.scene.fog = new THREE.Fog('#dfe8ea', 320, 1300);

    // puffy clouds drifting west to east
    const cloudMat = toon('#ffffff', { fog: false });
    this.clouds = [];
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(cloudGeometry(i * 7.3 + 1), cloudMat);
      const a = this.rnd() * Math.PI * 2, r = 380 + this.rnd() * 900;
      m.position.set(Math.cos(a) * r, 150 + this.rnd() * 160, Math.sin(a) * r);
      m.scale.setScalar(1.4 + this.rnd() * 1.6);
      m.scale.y *= 0.7;
      m.rotation.y = this.rnd() * Math.PI;
      this.scene.add(m);
      this.clouds.push(m);
    }
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight('#cfe4f4', '#e7d6b3', 1.55));
    const sun = new THREE.DirectionalLight('#fff4e2', 1.75);
    this.sunDir = new THREE.Vector3(0.55, 0.62, -0.56).normalize();
    sun.position.copy(this.sunDir).multiplyScalar(300);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const s = sun.shadow.camera;
    s.left = -170; s.right = 170; s.top = 170; s.bottom = -170; s.near = 50; s.far = 700;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 4;
    if ('intensity' in sun.shadow) sun.shadow.intensity = 0.82;
    this.scene.add(sun, sun.target);
  }

  buildGround() {
    const mat = toon(C.ground);
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'varying vec3 vWP;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float p = sin(vWP.x * 0.021) * sin(vWP.z * 0.018 + 1.7) + sin((vWP.x + vWP.z) * 0.047) * 0.4;
        diffuseColor.rgb *= 0.94 + p * 0.06;`);
    };
    const g = new THREE.Mesh(new THREE.PlaneGeometry(5000, 5000), mat);
    g.rotation.x = -Math.PI / 2;
    g.position.y = -0.03;
    g.receiveShadow = true;
    this.scene.add(g);
  }

  roadOutline() {
    const corner = (sx, sz) => {
      const cx = sx * (W + R), cz = sz * (W + R);
      const a1 = Math.atan2(0, -sx), a2 = Math.atan2(-sz, 0);
      let delta = a2 - a1;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta <= -Math.PI) delta += 2 * Math.PI;
      return arcPoints(cx, cz, R, a1, a1 + delta);
    };
    const arcOrdered = (sx, sz, from) => {
      const a = corner(sx, sz);
      const d0 = Math.hypot(a[0][0] - from[0], a[0][1] - from[1]);
      const d1 = Math.hypot(a[a.length - 1][0] - from[0], a[a.length - 1][1] - from[1]);
      return d0 <= d1 ? a : a.reverse();
    };
    this.arcOrdered = arcOrdered;
    return [[W, -L], ...arcOrdered(1, -1, [W, -(W + R)]), [L, -W], [L, W], ...arcOrdered(1, 1, [W + R, W]),
      [W, L], [-W, L], ...arcOrdered(-1, 1, [-W, W + R]), [-L, W], [-L, -W], ...arcOrdered(-1, -1, [-(W + R), -W]), [-W, -L]];
  }

  buildRoad() {
    const tex = asphaltTex(this.rnd);
    tex.repeat.set(1 / 9, 1 / 9);
    const roadMat = toon('#ffffff', { map: tex });
    roadMat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'varying vec3 vWP;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        float big = sin(vWP.x * 0.035 + 1.3) * sin(vWP.z * 0.029 + 0.4);
        diffuseColor.rgb *= 0.95 + big * 0.05;
        float near = smoothstep(90.0, 14.0, max(abs(vWP.x), abs(vWP.z)));
        float lane = abs(fract((abs(vWP.x) < 7.0 ? vWP.x : vWP.z) / 3.2) - 0.5);
        diffuseColor.rgb *= 1.0 - near * smoothstep(0.16, 0.02, lane) * 0.1;`);
    };
    const road = new THREE.Mesh(flatPolygon(this.roadOutline(), 0), roadMat);
    road.receiveShadow = true;
    this.scene.add(road);

    const slab = slabTex(this.rnd);
    slab.repeat.set(1 / 4.5, 1 / 4.5);
    const swMat = toon('#ffffff', { map: slab });
    const curbMat = toon('#b9b8b3');
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const arc = this.arcOrdered(sx, sz, [sx * W, sz * (W + R)]);
      const poly = [[sx * W, sz * L], ...arc, [sx * L, sz * W], [sx * L, sz * FRONT], [sx * FRONT, sz * FRONT], [sx * FRONT, sz * L]];
      const m = new THREE.Mesh(extrudedPolygon(poly, 0.18), [swMat, curbMat]);
      m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  buildMarkings() {
    const wear = wornAlpha(this.rnd);
    wear.repeat.set(0.3, 0.3);
    const paint = (c) => new THREE.MeshBasicMaterial({ color: c, alphaMap: wear, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    // markings are unlit paint, slightly dimmed so they sit in the scene
    const white = paint('#e9e8e2'), yellow = paint('#e3b43a');
    const y = 0.015;
    const geos = { white: [], yellow: [] };
    const strip = (dir, a0, a1, c0, c1, color) => {
      const u = U[dir], d = [-u[0], -u[1]], r = right(d);
      const P = (a, c) => [u[0] * a + r[0] * c, u[1] * a + r[1] * c];
      geos[color].push(flatPolygon([P(a0, c0), P(a1, c0), P(a1, c1), P(a0, c1)], y));
    };
    for (const dir of ['N', 'E', 'S', 'W']) {
      strip(dir, STOP, L, -0.28, -0.1, 'yellow');
      strip(dir, STOP, L, 0.1, 0.28, 'yellow');
      strip(dir, STOP + 1.5, L, HALF - 0.32, HALF - 0.17, 'white');
      strip(dir, STOP + 1.5, L, -(HALF - 0.17), -(HALF - 0.32), 'white');
      for (const side of [1, -1]) {
        const c = side * LANE_W;
        strip(dir, STOP, STOP + 30, c - 0.07, c + 0.07, 'white');
        for (let a = STOP + 36; a < L; a += 9) strip(dir, a, a + 3, c - 0.07, c + 0.07, 'white');
      }
      strip(dir, STOP + 0.05, STOP + 0.6, 0.1, HALF, 'white');
      // NYC "high-visibility" ladder crosswalk
      strip(dir, W + 0.3, STOP - 0.5, -HALF + 0.1, -HALF + 0.35, 'white');
      strip(dir, W + 0.3, STOP - 0.5, HALF - 0.35, HALF - 0.1, 'white');
      for (let c = -HALF + 0.75; c < HALF - 0.6; c += 1.1) strip(dir, W + 0.6, STOP - 0.8, c, c + 0.6, 'white');
    }
    for (const k of ['white', 'yellow']) {
      const m = new THREE.Mesh(mergeGeometries(geos[k]), k === 'white' ? white : yellow);
      m.renderOrder = 1;
      this.scene.add(m);
    }
    const arrow = (turn) => {
      const k = turn === 'R' ? 1 : -1;
      const s = new THREE.Shape();
      const P = [[-0.16, 0], [0.16, 0], [0.16, 2.6], [0.6, 2.6], [0, 4.2], [-0.6, 2.6], [-0.16, 2.6]];
      s.moveTo(P[0][0], P[0][1]); for (const p of P.slice(1)) s.lineTo(p[0], p[1]);
      const b = new THREE.Shape();
      const B = [[0, 1.0], [0.85, 1.6], [0.85, 1.2], [1.6, 1.95], [0.85, 2.7], [0.85, 2.25], [0, 1.65]].map(([x, yy]) => [x * k, yy]);
      b.moveTo(B[0][0], B[0][1]); for (const p of B.slice(1)) b.lineTo(p[0], p[1]);
      const g = mergeGeometries([new THREE.ShapeGeometry(s), new THREE.ShapeGeometry(b)]);
      g.scale(1, 1.6, 1);
      g.rotateX(-Math.PI / 2);
      return g;
    };
    const arrows = { R: arrow('R'), L: arrow('L') };
    const ag = [];
    for (const [d, i] of IN_LANES) {
      const dir = [-U[d][0], -U[d][1]], r = right(dir), off = LANE_W / 2 + LANE_W * (1 - i);
      for (const dist of [16, 46]) {
        const g = arrows[i === 0 ? 'R' : 'L'].clone();
        g.rotateY(Math.atan2(-dir[0], -dir[1]));
        g.translate(U[d][0] * (STOP + dist) + r[0] * off, y, U[d][1] * (STOP + dist) + r[1] * off);
        ag.push(g);
      }
    }
    const am = new THREE.Mesh(mergeGeometries(ag), white);
    am.renderOrder = 1;
    this.scene.add(am);
  }

  // ------------------------------------------------------------------ city
  buildCity() {
    const B = new NYCBuilder(this.scene, this.rnd);
    const rnd = this.rnd;
    const placed = [];
    const free = (x0, z0, x1, z1) => !placed.some((p) => x0 < p[2] && x1 > p[0] && z0 < p[3] && z1 > p[1]);
    const plaza = plazaTex(rnd); plaza.repeat.set(1 / 6, 1 / 6);
    const lotMat = toon('#ffffff', { map: plaza });
    const styles = ['redBrick', 'redBrick', 'darkBrick', 'tanBrick', 'creamBrick', 'limestone', 'brownstone'];
    for (const [sx, sz] of [[1, -1], [-1, 1], [-1, -1]]) {
      const lot = new THREE.Mesh(flatPolygon([[sx * FRONT, sz * FRONT], [sx * 320, sz * FRONT], [sx * 320, sz * 320], [sx * FRONT, sz * 320]], 0.04), lotMat);
      lot.receiveShadow = true; this.scene.add(lot);
      for (const row of [0, 1]) for (const axis of ['x', 'z']) {
        let t = FRONT + 0.3 + (axis === 'z' ? 22 : 0) + (row ? 4 : 0);
        while (t < 250) {
          const bays = 3 + Math.floor(rnd() * 5);
          const w = bays * 3.2, depth = 17 + rnd() * 6;
          const near = t < 60 && row === 0;
          const storeys = row ? 8 + Math.floor(rnd() * 10) : near ? 6 + Math.floor(rnd() * 5) : 4 + Math.floor(rnd() * 5);
          const along = t + w / 2;
          const dist = FRONT + 0.3 + depth / 2 + (row ? 24 : 0);
          let x, z, rot;
          if (axis === 'x') { x = sx * along; z = sz * dist; rot = sz > 0 ? Math.PI : 0; }
          else { x = sx * dist; z = sz * along; rot = -sx * Math.PI / 2; }
          const [hw, hd] = axis === 'x' ? [w / 2, depth / 2] : [depth / 2, w / 2];
          if (free(x - hw, z - hd, x + hw, z + hd)) {
            const style = styles[Math.floor(rnd() * styles.length)];
            B.building({ x, z, rotY: rot, bays, depth, storeys, style, frontage: row === 0 });
            placed.push([x - hw, z - hd, x + hw, z + hd]);
          }
          t += w + (rnd() < 0.12 ? 3.5 : 0.05);
        }
      }
      // a couple of art-deco towers behind the walk-ups
      for (let i = 0; i < 3; i++) {
        const base = 22 + rnd() * 10;
        const x = sx * (75 + rnd() * 120), z = sz * (75 + rnd() * 120);
        if (!free(x - base / 2, z - base / 2, x + base / 2, z + base / 2)) continue;
        B.tower({ x, z, rotY: 0, base, storeys: 24 + Math.floor(rnd() * 22), style: rnd() < 0.5 ? 'limestone' : 'creamBrick', spire: rnd() < 0.6 });
        placed.push([x - base / 2, z - base / 2, x + base / 2, z + base / 2]);
      }
      // infill blocks further out
      for (let i = 0; i < 40; i++) {
        const w = 18 + rnd() * 18, d = 18 + rnd() * 18;
        const x = sx * (50 + rnd() * 250), z = sz * (50 + rnd() * 250);
        if (!free(x - w / 2, z - d / 2, x + w / 2, z + d / 2)) continue;
        B.building({ x, z, rotY: [0, Math.PI / 2, Math.PI, -Math.PI / 2][Math.floor(rnd() * 4)], bays: Math.round(w / 3.2), depth: d, storeys: 5 + Math.floor(rnd() * 12), style: styles[Math.floor(rnd() * styles.length)], frontage: false });
        placed.push([x - w / 2, z - d / 2, x + w / 2, z + d / 2]);
      }
    }
    // park side: a row across the park so the skyline frames it
    B.skyline(rnd);
    B.flush();
  }

  buildPark() {
    const rnd = this.rnd;
    const x0 = FRONT + 0.5, x1 = 175;
    const path = [];
    for (let i = 0; i <= 80; i++) {
      const t = i / 80;
      path.push([FRONT + 3 + t * 150, FRONT + 6 + Math.sin(t * 3.4) * 15 + t * 80]);
    }
    const fountain = [62, 52];
    const nearPath = (x, z, r) => {
      for (let i = 0; i < path.length - 1; i += 1) {
        const [ax, az] = path[i], [bx, bz] = path[i + 1];
        const vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
        if (Math.hypot(x - (ax + vx * t), z - (az + vz * t)) < r) return true;
      }
      return false;
    };
    // lawn base
    const lawn = new THREE.Mesh(flatPolygon([[x0, x0], [x1, x0], [x1, x1], [x0, x1]], 0.05), toon(C.grass));
    lawn.receiveShadow = true; this.scene.add(lawn);
    // path + fountain plaza
    const pathMat = toon('#e7dcc6');
    const pg = [];
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, az] = path[i], [bx, bz] = path[i + 1];
      const g = new THREE.PlaneGeometry(3.4, Math.hypot(bx - ax, bz - az) + 0.6);
      g.rotateX(-Math.PI / 2); g.rotateY(Math.atan2(bx - ax, bz - az)); g.translate((ax + bx) / 2, 0.08, (az + bz) / 2);
      pg.push(g);
    }
    const plazaG = new THREE.CircleGeometry(15, 48); plazaG.rotateX(-Math.PI / 2); plazaG.translate(fountain[0], 0.085, fountain[1]);
    pg.push(plazaG);
    const pm = new THREE.Mesh(mergeGeometries(pg.map((g) => g.toNonIndexed())), pathMat); pm.receiveShadow = true; this.scene.add(pm);
    // fountain
    const stone = toon('#d9cdb5');
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(8, 8.3, 0.8, 48, 1, true), stone); basin.position.set(fountain[0], 0.4, fountain[1]);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(8.1, 0.35, 8, 48), stone); rim.rotation.x = Math.PI / 2; rim.position.set(fountain[0], 0.8, fountain[1]);
    this.water = new THREE.Mesh(new THREE.CircleGeometry(7.9, 48), toon(C.water));
    this.water.rotation.x = -Math.PI / 2; this.water.position.set(fountain[0], 0.55, fountain[1]);
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 2.2, 24), stone); ped.position.set(fountain[0], 1.1, fountain[1]);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 1.2, 0.6, 24), stone); bowl.position.set(fountain[0], 2.4, fountain[1]);
    for (const m of [basin, rim, ped, bowl]) { m.castShadow = true; m.receiveShadow = true; this.scene.add(m); }
    this.scene.add(this.water);
    // jets: a ring of thin animated spouts
    const jetMat = new THREE.MeshBasicMaterial({ color: '#dff3f7', transparent: true, opacity: 0.85 });
    this.jets = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const j = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 1, 6).translate(0, 0.5, 0), jetMat);
      j.position.set(fountain[0] + Math.cos(a) * 5.2, 0.55, fountain[1] + Math.sin(a) * 5.2);
      j.userData.phase = i * 0.7;
      this.scene.add(j); this.jets.push(j);
    }
    const centre = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.25, 1, 8).translate(0, 0.5, 0), jetMat);
    centre.position.set(fountain[0], 2.7, fountain[1]); centre.userData.phase = 0; centre.userData.centre = true;
    this.scene.add(centre); this.jets.push(centre);

    // low black iron fence along both street edges, gap at the path entrance
    const fence = [];
    for (let t = x0 + 1; t < x1; t += 2.4) {
      for (const [fx, fz] of [[t, x0 + 0.4], [x0 + 0.4, t]]) {
        if (Math.hypot(fx - path[0][0], fz - path[0][1]) < 4) continue;
        fence.push(new THREE.BoxGeometry(fz === x0 + 0.4 ? 2.4 : 0.05, 0.05, fz === x0 + 0.4 ? 0.05 : 2.4).translate(fx, 0.95, fz));
        fence.push(new THREE.BoxGeometry(0.06, 1.0, 0.06).translate(fx, 0.5, fz));
      }
    }
    const fm = new THREE.Mesh(mergeGeometries(fence.map((g) => g.toNonIndexed())), toon('#24272a')); fm.castShadow = true; this.scene.add(fm);

    // benches along the path
    const benchG = mergeGeometries([new THREE.BoxGeometry(2, 0.08, 0.5).translate(0, 0.45, 0), new THREE.BoxGeometry(2, 0.5, 0.06).translate(0, 0.75, -0.25), new THREE.BoxGeometry(0.08, 0.45, 0.45).translate(-0.9, 0.22, 0), new THREE.BoxGeometry(0.08, 0.45, 0.45).translate(0.9, 0.22, 0)].map((g) => g.toNonIndexed()));
    const benches = [];
    for (let i = 6; i < path.length - 4; i += 9) {
      const [ax, az] = path[i], [bx, bz] = path[i + 1];
      const a = Math.atan2(bx - ax, bz - az);
      benches.push(new THREE.Matrix4().makeRotationY(a + Math.PI / 2).setPosition(ax + Math.cos(a) * 2.6, 0.06, az - Math.sin(a) * 2.6));
    }
    const bm = new THREE.InstancedMesh(benchG, toon('#4f6a3d'), benches.length);
    benches.forEach((m, i) => bm.setMatrixAt(i, m)); bm.castShadow = true; this.scene.add(bm);

    // grass blades: dense near the junction, lighter further away
    const pts = [];
    for (let x = x0 + 0.6; x < x1; x += 0.24) {
      for (let z = x0 + 0.6; z < x1; z += 0.24) {
        const dist = Math.hypot(x, z);
        const keep = dist < 90 ? 1 : dist < 140 ? 0.45 : 0.18;
        if (rnd() > keep) continue;
        const jx = x + (rnd() - 0.5) * 0.24, jz = z + (rnd() - 0.5) * 0.24;
        if (Math.hypot(jx - fountain[0], jz - fountain[1]) < 15.5) continue;
        if (nearPath(jx, jz, 2.0)) continue;
        pts.push([jx, jz, dist < 90 ? 1 : 1.25]);
      }
    }
    const grass = new THREE.Mesh(grassGeometry(pts, rnd), grassMaterial(this.time));
    grass.receiveShadow = true;
    grass.frustumCulled = false;
    this.scene.add(grass);
    this.grassCount = pts.length;

    // trees: London planes in the park and in sidewalk tree pits
    const trees = [];
    for (let i = 0; i < 70; i++) {
      const x = x0 + 6 + rnd() * (x1 - x0 - 10), z = x0 + 6 + rnd() * (x1 - x0 - 10);
      if (Math.hypot(x - fountain[0], z - fountain[1]) < 19 || nearPath(x, z, 4.5)) continue;
      trees.push([x, z, 1.0 + rnd() * 0.55]);
    }
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      for (let t = 28; t < 240; t += 13) {
        trees.push([sx * t + (rnd() - 0.5), sz * (FRONT - 1.3), 0.78 + rnd() * 0.2]);
        trees.push([sx * (FRONT - 1.3), sz * t + (rnd() - 0.5), 0.78 + rnd() * 0.2]);
      }
    }
    this.buildTrees(trees);
  }

  buildTrees(list) {
    const rnd = this.rnd;
    const kinds = [canopyGeometry(1.3, 4), canopyGeometry(4.7, 5), canopyGeometry(8.1, 3)];
    const trunkG = new THREE.CylinderGeometry(0.22, 0.38, 4.2, 8).translate(0, 2.1, 0);
    const leaf = toon('#ffffff');
    leaf.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.time;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 ip = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
          float w = sin(uTime * 1.1 + ip.x * 0.13 + ip.y * 0.09) * 0.6 + sin(uTime * 2.3 + ip.x * 0.31) * 0.2;
          transformed.x += w * max(position.y + 0.6, 0.0) * 0.05;
          transformed.z += w * max(position.y + 0.6, 0.0) * 0.035;
        #endif`);
    };
    leaf.customProgramCacheKey = () => 'leaf';
    const bark = toon('#7a5b45');
    const per = kinds.map(() => []);
    list.forEach((t) => per[Math.floor(rnd() * kinds.length)].push(t));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    per.forEach((items, k) => {
      if (!items.length) return;
      const canopy = new THREE.InstancedMesh(kinds[k], leaf, items.length);
      const trunk = new THREE.InstancedMesh(trunkG, bark, items.length);
      items.forEach(([x, z, s], i) => {
        q.setFromAxisAngle(up, rnd() * 6.28);
        m4.compose(new THREE.Vector3(x, 0.15, z), q, new THREE.Vector3(s, s, s));
        trunk.setMatrixAt(i, m4);
        const cs = 3.1 * s;
        m4.compose(new THREE.Vector3(x, 0.15 + 5.6 * s, z), q, new THREE.Vector3(cs, cs * 0.92, cs));
        canopy.setMatrixAt(i, m4);
        canopy.setColorAt(i, col.set(LEAF[Math.floor(rnd() * LEAF.length)]));
      });
      for (const im of [canopy, trunk]) { im.castShadow = true; im.receiveShadow = true; this.scene.add(im); }
    });
  }

  buildStreetFurniture() {
    const rnd = this.rnd;
    const quads = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    // cobra-head street lights
    const lampGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.09, 0.14, 8.5, 10).translate(0, 4.25, 0),
      new THREE.CylinderGeometry(0.24, 0.3, 0.6, 10).translate(0, 0.3, 0),
      new THREE.CylinderGeometry(0.07, 0.07, 2.4, 6).rotateX(Math.PI / 2).translate(0, 8.4, -1.1),
      new RoundedBoxGeometry(0.5, 0.2, 1.1, 2, 0.08).translate(0, 8.3, -2.3),
    ].map(plain));
    const lamps = [];
    for (const [sx, sz] of quads) for (let t = 34; t < 240; t += 27) {
      lamps.push([sx * t, sz * (W + 0.6), Math.atan2(0, sz)]);
      lamps.push([sx * (W + 0.6), sz * t, Math.atan2(sx, 0)]);
    }
    const lm = new THREE.InstancedMesh(lampGeo, toon('#7b8187'), lamps.length);
    lamps.forEach(([x, z, a], i) => { q.setFromEuler(e.set(0, a, 0)); m4.compose(new THREE.Vector3(x, 0.15, z), q, new THREE.Vector3(1, 1, 1)); lm.setMatrixAt(i, m4); });
    lm.castShadow = true; this.scene.add(lm);

    // fire hydrants
    const hyd = mergeGeometries([
      new THREE.CylinderGeometry(0.2, 0.24, 0.65, 12).translate(0, 0.33, 0),
      new THREE.SphereGeometry(0.21, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.65, 0),
      new THREE.CylinderGeometry(0.08, 0.08, 0.55, 8).rotateZ(Math.PI / 2).translate(0, 0.45, 0),
    ].map((g) => g.toNonIndexed()));
    const hm = new THREE.InstancedMesh(hyd, toon('#d23a2c'), 12);
    let k = 0;
    for (const [sx, sz] of quads) for (const t of [22, 95]) { m4.makeTranslation(sx * t, 0.18, sz * (W + 1.2)); hm.setMatrixAt(k++, m4); }
    for (const [sx, sz] of quads.slice(0, 2)) { m4.makeTranslation(sx * (W + 1.2), 0.18, sz * 60); hm.setMatrixAt(k++, m4); }
    hm.count = k; hm.castShadow = true; this.scene.add(hm);

    // trash cans and newspaper boxes near the corners
    const can = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.32, 0.28, 0.9, 12).translate(0, 0.45, 0), toon('#3b5e3f'), 8);
    const box = new THREE.InstancedMesh(new RoundedBoxGeometry(0.55, 1.05, 0.5, 2, 0.05).translate(0, 0.52, 0), toon('#2c6fb3'), 8);
    let c1 = 0, c2 = 0;
    for (const [sx, sz] of quads) {
      m4.makeTranslation(sx * (FRONT - 3.2), 0.18, sz * (W + 1.0)); can.setMatrixAt(c1++, m4);
      m4.makeTranslation(sx * (W + 1.0), 0.18, sz * (FRONT + 1.5)); box.setMatrixAt(c2++, m4);
      m4.makeTranslation(sx * (W + 1.0), 0.18, sz * (FRONT + 2.3)); box.setMatrixAt(c2++, m4);
    }
    can.count = c1; box.count = c2;
    for (const im of [can, box]) { im.castShadow = true; this.scene.add(im); }

    // subway entrance on the north-west corner: green globes, railings, stairs down
    const sub = new THREE.Group();
    const rail = toon('#1f4a35');
    const sw = 2.4, sl = 5.5;
    for (const sx of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, sl), rail); r.position.set(sx * sw / 2, 0.5, 0); sub.add(r);
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, sl), rail); top.position.set(sx * sw / 2, 1.02, 0); sub.add(top);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.6, 8), rail); post.position.set(sx * sw / 2, 1.3, sl / 2); sub.add(post);
      const globe = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), new THREE.MeshBasicMaterial({ color: '#7fe0a0' })); globe.position.set(sx * sw / 2, 2.75, sl / 2); sub.add(globe);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(sw, 1.0, 0.08), rail); back.position.set(0, 0.5, -sl / 2); sub.add(back);
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(sw - 0.1, sl - 0.1), new THREE.MeshBasicMaterial({ color: '#2a2b2e' })); hole.rotation.x = -Math.PI / 2; hole.position.y = 0.01; sub.add(hole);
    for (let s = 0; s < 7; s++) { const st = new THREE.Mesh(new THREE.BoxGeometry(sw - 0.2, 0.06, 0.55), toon('#8c8b86')); st.position.set(0, 0.02, -sl / 2 + 0.6 + s * 0.72); sub.add(st); }
    sub.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    sub.position.set(-(FRONT - 1.9), 0.19, -(FRONT + 23.5));
    this.scene.add(sub);

    // steam stack in the south-west roadway, with rising puffs
    const stack = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.42 - i * 0.04, 0.46 - i * 0.04, 0.5, 16), toon(i % 2 ? '#f4f1ea' : '#f07a2a'));
      band.position.y = 0.25 + i * 0.5; stack.add(band);
    }
    stack.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    stack.position.set(-26, 0, 0.05);
    this.scene.add(stack);
    const puffMat = toon('#f3f5f6', { transparent: true, opacity: 0.85, depthWrite: false });
    const puffGeo = new THREE.IcosahedronGeometry(1, 2);
    this.steam = [];
    for (let i = 0; i < 18; i++) {
      const p = new THREE.Mesh(puffGeo, puffMat.clone());
      p.userData = { t: i / 18, x: -26, z: 0.05 };
      this.scene.add(p); this.steam.push(p);
    }
  }

  // -------------------------------------------------------------- signals
  buildSignals() {
    const poleMat = toon('#3f4448');
    const housingMat = toon(C.housing);
    const plateMat = toon('#151719');
    const edgeMat = toon('#f2c230');
    this.lensOn = { R: new THREE.Color('#ff3b2b'), Y: new THREE.Color('#ffb21a'), G: new THREE.Color('#25e287') };
    this.lensOff = { R: new THREE.Color('#3a1612'), Y: new THREE.Color('#3a2a0c'), G: new THREE.Color('#0f2c1d') };
    this.lensMats = {}; this.lampLevel = {};
    for (const d of ['N', 'E', 'S', 'W']) {
      this.lensMats[d] = {}; this.lampLevel[d] = {};
      for (const k of ['R', 'Y', 'G']) { this.lensMats[d][k] = new THREE.MeshBasicMaterial({ color: this.lensOff[k].clone() }); this.lampLevel[d][k] = 0; }
    }
    this.countdowns = {};
    const head = (d, withTimer) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new RoundedBoxGeometry(0.46, 1.25, 0.34, 2, 0.06), housingMat));
      const plate = new THREE.Mesh(new RoundedBoxGeometry(0.86, 1.62, 0.04, 2, 0.015), plateMat); plate.position.z = 0.19; g.add(plate);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.66, 0.02), edgeMat); rim.position.z = 0.215; g.add(rim);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.66, 0.02), plateMat); back.position.z = 0.24; g.add(back);
      ['R', 'Y', 'G'].forEach((k, i) => {
        const lens = new THREE.Mesh(new THREE.CircleGeometry(0.15, 24), this.lensMats[d][k]);
        lens.position.set(0, 0.4 - i * 0.4, -0.172); lens.rotation.y = Math.PI;
        const visor = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.035, 0.24), housingMat);
        visor.position.set(0, 0.4 - i * 0.4 + 0.18, -0.29);
        g.add(lens, visor);
      });
      if (withTimer) {
        const box = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.42, 0.22, 2, 0.04), housingMat);
        box.position.set(0, -1.02, 0);
        const cv = document.createElement('canvas'); cv.width = 128; cv.height = 80;
        const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
        const face = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.34), new THREE.MeshBasicMaterial({ map: tex }));
        face.position.set(0, -1.02, -0.115); face.rotation.y = Math.PI;
        g.add(box, face);
        this.countdowns[d] = { cv, tex, last: '' };
      }
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      return g;
    };
    for (const d of ['N', 'E', 'S', 'W']) {
      const u = U[d], dir = [-u[0], -u[1]], r = right(dir);
      const base = [-u[0] * (STOP + 1.4) + r[0] * (W + 1.3), -u[1] * (STOP + 1.4) + r[1] * (W + 1.3)];
      const grp = new THREE.Group();
      grp.position.set(base[0], 0.15, base[1]);
      grp.rotation.y = Math.atan2(dir[0], dir[1]);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 6.6, 16), poleMat); pole.position.y = 3.3;
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.35, 16), poleMat); foot.position.y = 0.17;
      const armLen = W + 1.3 - LANE_W * 0.9;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, armLen, 12), poleMat);
      arm.rotation.z = Math.PI / 2; arm.position.set(armLen / 2, 6.2, 0);
      const h1 = head(d, false); h1.position.set(armLen - 0.1, 5.35, 0);
      const h2 = head(d, true); h2.position.set(0, 3.3, -0.36);
      // street name sign on the mast arm, NYC green
      const sign = new THREE.Mesh(new RoundedBoxGeometry(2.2, 0.42, 0.05, 2, 0.04), toon('#1f6b45'));
      sign.position.set(armLen * 0.45, 6.75, 0);
      grp.add(pole, foot, arm, h1, h2, sign);
      grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.scene.add(grp);
    }
  }

  setSignals(states) { this.signalStates = states; }

  setCountdowns(remaining) {
    for (const d of ['N', 'E', 'S', 'W']) {
      const c = this.countdowns[d];
      if (!c) continue;
      const s = this.signalStates?.[d] || 'R';
      const n = remaining?.[d];
      const txt = n == null ? '' : String(Math.max(0, Math.ceil(n))).padStart(2, '0');
      const key = txt + s;
      if (key === c.last) continue;
      c.last = key;
      const g = c.cv.getContext('2d');
      g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, 128, 80);
      g.fillStyle = txt ? (s === 'G' ? '#3dff9a' : s === 'Y' ? '#ffb21a' : '#ff8a2a') : '#2a2a2a';
      g.font = '700 62px "Geist Mono", ui-monospace, monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(txt || '--', 64, 44);
      c.tex.needsUpdate = true;
    }
  }

  animateSignals(dt) {
    if (!this.signalStates) return;
    const k = 1 - Math.exp(-dt * 16);
    for (const d of ['N', 'E', 'S', 'W']) for (const key of ['R', 'Y', 'G']) {
      const target = this.signalStates[d] === key ? 1 : 0;
      const lv = (this.lampLevel[d][key] += (target - this.lampLevel[d][key]) * k);
      this.lensMats[d][key].color.copy(this.lensOff[key]).lerp(this.lensOn[key], lv);
    }
  }

  // ------------------------------------------------------------- vehicles
  buildVehicles(gltf) {
    const atlas = gltf.scenes[0].getObjectByProperty('isMesh', true).material.map;
    const cells = atlasCells(atlas);
    const tail = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    this.cars = [];
    for (const name of CAR_MODELS) {
      const sc = gltf.scenes.find((s) => s.name === name);
      sc.updateMatrixWorld(true);
      let body = null;
      const wheels = [];
      sc.traverse((o) => {
        if (!o.isMesh) return;
        if (/^wheel-(front|back)-(left|right)$/.test(o.name)) wheels.push({ geo: o.geometry, matrix: o.matrixWorld.clone(), sign: o.matrixWorld.elements[0] >= 0 ? 1 : -1 });
        else { const g = plain(o.geometry).applyMatrix4(o.matrixWorld); body = body ? mergeGeometries([body, g]) : g; }
      });
      body.computeBoundingBox();
      const b = body.boundingBox;
      const len = b.max.z - b.min.z, wid = b.max.x - b.min.x;
      const scale = new THREE.Vector3(1.8 / wid, 1.22, 4.3 / len);
      const paintCell = name === 'taxi' ? null : dominantCell(body, cells);
      const mat = patchPaint(toon('#ffffff', { map: atlas }), paintCell, 'instanced');
      const max = 160;
      body.setAttribute('aPaint', new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(-1), 3));
      const bodyIM = new THREE.InstancedMesh(body, mat, max);
      const wheelMat = toon('#ffffff', { map: atlas });
      const wheelIMs = wheels.map((w) => new THREE.InstancedMesh(w.geo, wheelMat, max));
      const lights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.12, 0.05), tail, max * 4);
      for (const im of [bodyIM, ...wheelIMs, lights]) { im.count = 0; im.frustumCulled = false; im.castShadow = im !== lights; im.receiveShadow = true; this.scene.add(im); }
      lights.setColorAt(0, new THREE.Color(0, 0, 0));
      this.cars.push({
        name, bodyIM, wheelIMs, wheels, lights, scale, max, paint: !!paintCell, wheelR: 0.3 * scale.y,
        rearZ: b.min.z * scale.z - 0.01, frontZ: b.max.z * scale.z + 0.01, lightY: (b.min.y + (b.max.y - b.min.y) * 0.42) * scale.y, halfW: (wid / 2) * scale.x - 0.22,
      });
    }
    this.buildOtherVehicles();
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color(); this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._w = new THREE.Matrix4(); this._r = new THREE.Matrix4(); this._sm = new THREE.Matrix4(); this._v = new THREE.Vector3();
  }

  buildOtherVehicles() {
    const rb = (w, h, d, r = 0.18, s = 3) => new RoundedBoxGeometry(w, h, d, s, r);
    const glass = toon('#2b3c4a');
    const tyre = toon('#1c1d1f');
    const rimM = toon('#c4c8cc');
    const tail = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const wheel = (r, w) => new THREE.CylinderGeometry(r, r, w, 18).rotateZ(Math.PI / 2);
    const four = (W2, L2, r, w, inset) => mergeGeometries([-1, 1].flatMap((sx) => [-1, 1].map((sz) => wheel(r, w).translate(sx * (W2 / 2 - w / 2 + 0.02), r, sz * (L2 / 2 - inset)))));
    const hubs = (W2, L2, r, w, inset) => mergeGeometries([-1, 1].flatMap((sx) => [-1, 1].map((sz) => wheel(r * 0.55, w + 0.02).translate(sx * (W2 / 2 - w / 2 + 0.02), r, sz * (L2 / 2 - inset)))));
    const tails = (W2, L2, y) => mergeGeometries([-1, 1].map((sx) => new THREE.BoxGeometry(0.34, 0.16, 0.06).translate(sx * (W2 / 2 - 0.3), y, -L2 / 2 - 0.01)));
    this.others = {
      bus: { max: 60, parts: [   // MTA: white body, blue stripe
        { g: rb(2.55, 2.9, 11.9, 0.25).translate(0, 1.85, 0), m: toon('#f2f3f1') },
        { g: new THREE.BoxGeometry(2.58, 0.32, 11.0).translate(0, 1.15, 0), m: toon('#1f4f9c') },
        { g: new THREE.BoxGeometry(2.6, 0.95, 10.2).translate(0, 2.35, 0.3), m: glass },
        { g: new THREE.BoxGeometry(2.3, 1.1, 0.06).translate(0, 2.2, 5.96), m: glass },
        { g: rb(1.6, 0.3, 3.2, 0.1).translate(0, 3.4, -2), m: toon('#d9dcdf') },
        { g: four(2.55, 11.9, 0.52, 0.34, 2.4), m: tyre },
        { g: hubs(2.55, 11.9, 0.52, 0.34, 2.4), m: rimM },
        { g: tails(2.55, 11.9, 0.95), m: tail, brake: true },
      ] },
      motorcycle: { max: 260, parts: [
        { g: rb(0.34, 0.42, 1.6, 0.12).translate(0, 0.62, 0.05), m: toon('#ffffff'), tint: true },
        { g: rb(0.36, 0.18, 0.7, 0.08).translate(0, 0.9, -0.35), m: toon('#1c1d20') },
        { g: rb(0.46, 0.6, 0.34, 0.15).translate(0, 1.28, -0.22), m: toon('#ffffff'), rider: true },
        { g: new THREE.SphereGeometry(0.17, 16, 12).translate(0, 1.76, -0.12), m: toon('#ffffff'), helmet: true },
        { g: mergeGeometries([wheel(0.3, 0.12).translate(0, 0.3, 0.72), wheel(0.3, 0.12).translate(0, 0.3, -0.72)]), m: tyre },
        { g: new THREE.BoxGeometry(0.18, 0.08, 0.05).translate(0, 0.78, -0.86), m: tail, brake: true },
      ] },
      auto: { max: 160, parts: [
        { g: rb(1.36, 0.7, 2.7, 0.18).translate(0, 0.62, 0), m: toon('#22764a') },
        { g: rb(1.32, 0.9, 1.95, 0.26).translate(0, 1.5, -0.25), m: toon('#f2c230') },
        { g: new THREE.BoxGeometry(1.2, 0.5, 0.06).translate(0, 1.34, 0.74), m: glass },
        { g: rb(1.0, 0.5, 0.3, 0.08).translate(0, 0.98, -0.95), m: toon('#1c1d20') },
        { g: mergeGeometries([wheel(0.24, 0.16).translate(0, 0.24, 1.0), wheel(0.24, 0.16).translate(-0.58, 0.24, -0.9), wheel(0.24, 0.16).translate(0.58, 0.24, -0.9)]), m: tyre },
        { g: tails(1.36, 2.7, 0.72), m: tail, brake: true },
      ] },
    };
    this.motoColors = ['#c0392b', '#22344d', '#e0662a', '#13806f', '#7b8288', '#f2c230', '#202226'];
    this.riderColors = ['#3b4a63', '#6b4e3a', '#e8e3d8', '#5a6b4f', '#2d2f33'];
    for (const t of Object.values(this.others)) {
      t.meshes = t.parts.map((p) => {
        const im = new THREE.InstancedMesh(p.g, p.m, t.max);
        im.castShadow = !p.brake; im.receiveShadow = true; im.count = 0; im.frustumCulled = false;
        if (p.tint || p.brake || p.rider || p.helmet) im.setColorAt(0, new THREE.Color('#ffffff'));
        this.scene.add(im);
        return im;
      });
    }
  }

  updateVehicles(sim, dt) {
    const blink = (performance.now() % 760) < 400;
    const seen = new Set();
    const counts = new Map(), lightCounts = new Map();
    for (const c of this.cars) { counts.set(c, 0); lightCounts.set(c, 0); }
    const oc = { bus: 0, motorcycle: 0, auto: 0 };
    const m = this._m, q = this._q, p = this._p;
    const BRAKE_ON = [1, 0.16, 0.1], BRAKE_OFF = [0.42, 0.05, 0.04], IND = [1, 0.62, 0.08];
    for (const v of sim.vehicles) {
      seen.add(v.id);
      const [x, z, h] = sim.pose(v);
      let st = this.vis.get(v.id);
      if (!st) { st = { pitch: 0, roll: 0, spin: 0, yaw: h, model: this.pickModel(v) }; this.vis.set(v.id, st); }
      let dy = h - st.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      const yawRate = dt > 0 ? dy / dt : 0;
      st.yaw = h;
      const kk = 1 - Math.exp(-dt * 6);
      st.pitch += (Math.max(-0.03, Math.min(0.04, -v.acc * 0.011)) - st.pitch) * kk;
      st.roll += (Math.max(-0.035, Math.min(0.035, yawRate * v.v * 0.006)) - st.roll) * kk;
      const braking = v.acc < -0.6 || v.v < 0.1;
      const turning = v.move !== 'T' && (v.seg === 1 || (v.seg === 0 && LANE_LEN - v.s < 70));
      p.set(x, 0, z);
      this._e.set(st.pitch, h, st.roll, 'YXZ'); q.setFromEuler(this._e);
      const bc = braking ? BRAKE_ON : BRAKE_OFF;

      if (v.type === 'passenger' || v.type === 'car') {
        const car = st.model;
        const i = counts.get(car);
        if (i >= car.max) continue;
        counts.set(car, i + 1);
        st.spin += (v.v * dt) / car.wheelR;
        m.compose(p, q, car.scale);
        car.bodyIM.setMatrixAt(i, m);
        if (car.paint) { const col = this._c.set(PAINT[v.color % PAINT.length]); car.bodyIM.geometry.attributes.aPaint.setXYZ(i, col.r, col.g, col.b); }
        this._e.set(0, h, 0, 'YXZ'); const qf = new THREE.Quaternion().setFromEuler(this._e);
        this._w.compose(p, qf, this._s);
        car.wheels.forEach((w, k) => {
          const wm = this._sm.copy(w.matrix);
          wm.setPosition(this._v.setFromMatrixPosition(w.matrix).multiply(car.scale));
          wm.multiply(this._r.makeScale(car.scale.y, car.scale.y, car.scale.y)).multiply(this._r.makeRotationX(st.spin * w.sign));
          car.wheelIMs[k].setMatrixAt(i, this._r.multiplyMatrices(this._w, wm));
        });
        let li = lightCounts.get(car);
        for (const sx of [-1, 1]) {
          const lp = this._v.set(sx * car.halfW, car.lightY, car.rearZ).applyQuaternion(q).add(p);
          m.compose(lp, q, this._s); car.lights.setMatrixAt(li, m); car.lights.setColorAt(li, this._c.setRGB(...bc)); li++;
        }
        const side = v.move === 'R' ? -1 : 1, on = turning && blink;
        for (const z0 of [car.rearZ - 0.005, car.frontZ]) {
          if (on) { const lp = this._v.set(side * (car.halfW + 0.12), car.lightY + 0.02, z0).applyQuaternion(q).add(p); m.compose(lp, q, this._s); } else m.makeScale(0, 0, 0);
          car.lights.setMatrixAt(li, m); car.lights.setColorAt(li, this._c.setRGB(...IND)); li++;
        }
        lightCounts.set(car, li);
      } else {
        const t = this.others[v.type];
        const i = oc[v.type];
        if (i >= t.max) continue;
        oc[v.type]++;
        m.compose(p, q, this._s);
        t.parts.forEach((part, k) => {
          const im = t.meshes[k];
          im.setMatrixAt(i, m);
          if (part.tint) im.setColorAt(i, this._c.set(this.motoColors[v.color % this.motoColors.length]));
          if (part.rider) im.setColorAt(i, this._c.set(this.riderColors[(v.color >> 3) % this.riderColors.length]));
          if (part.helmet) im.setColorAt(i, this._c.set(this.motoColors[(v.color >> 2) % this.motoColors.length]));
          if (part.brake) im.setColorAt(i, this._c.setRGB(...bc));
        });
      }
    }
    for (const car of this.cars) {
      const n = counts.get(car);
      for (const im of [car.bodyIM, ...car.wheelIMs]) { im.count = n; im.instanceMatrix.needsUpdate = true; }
      car.bodyIM.geometry.attributes.aPaint.needsUpdate = true;
      car.lights.count = lightCounts.get(car);
      car.lights.instanceMatrix.needsUpdate = true;
      if (car.lights.instanceColor) car.lights.instanceColor.needsUpdate = true;
    }
    for (const [type, t] of Object.entries(this.others)) for (const im of t.meshes) {
      im.count = oc[type]; im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    if (this.vis.size > seen.size + 200) for (const id of this.vis.keys()) if (!seen.has(id)) this.vis.delete(id);
  }

  pickModel(v) {
    const total = CAR_WEIGHTS.reduce((a, b) => a + b, 0);
    let r = (((v.color * 7919) % 1000) / 1000) * total;
    for (let i = 0; i < this.cars.length; i++) { r -= CAR_WEIGHTS[i]; if (r <= 0) return this.cars[i]; }
    return this.cars[0];
  }

  // ------------------------------------------------------- agent overlay
  buildOverlay() {
    this.overlay = new THREE.Group();
    this.overlay.visible = false;
    this.overlayFade = 0;
    this.cells = []; this.pillars = [];
    const CELL = 200 / 3;
    this.overlayLine = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false });
    IN_LANES.forEach(([d, i], li) => {
      const u = U[d], dir = [-u[0], -u[1]], r = right(dir);
      const off = LANE_W / 2 + LANE_W * (1 - i);
      for (let c = 0; c < 3; c++) {
        const a0 = Math.max(0, c * CELL - 10.4) + 0.6, a1 = Math.min(LANE_LEN, (c + 1) * CELL - 10.4) - 0.6;
        const len = a1 - a0, mid = STOP + (a0 + a1) / 2;
        const geo = new THREE.PlaneGeometry(LANE_W - 0.5, len); geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#5ce1cf', transparent: true, opacity: 0, depthWrite: false, fog: false }));
        mesh.rotation.y = Math.atan2(dir[0], dir[1]);
        mesh.position.set(u[0] * mid + r[0] * off, 0.06, u[1] * mid + r[1] * off);
        mesh.renderOrder = 2;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.overlayLine);
        edges.rotation.copy(mesh.rotation); edges.position.copy(mesh.position); edges.position.y = 0.07;
        this.overlay.add(mesh, edges);
        this.cells[li * 3 + c] = mesh;
      }
      const pillar = new THREE.Mesh(new RoundedBoxGeometry(LANE_W - 0.8, 1, 1.6, 2, 0.12).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: '#f4c15d', transparent: true, opacity: 0.92 }));
      pillar.position.set(u[0] * (STOP + 2.2) + r[0] * off, 0.05, u[1] * (STOP + 2.2) + r[1] * off);
      pillar.rotation.y = Math.atan2(dir[0], dir[1]);
      pillar.scale.y = 0.01;
      this.overlay.add(pillar);
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
      sprite.scale.set(6, 3, 1); sprite.renderOrder = 5;
      this.overlay.add(sprite);
      this.pillars[li] = { pillar, sprite, cv, tex, last: -1, base: pillar.position.clone() };
    });
    this.scene.add(this.overlay);
    this.slow = new THREE.Color('#ff7a52'); this.fast = new THREE.Color('#5ce1cf');
  }

  setOverlay(on) { this.overlayOn = on; if (on) this.overlay.visible = true; }

  updateOverlay(state, dt) {
    this.overlayFade += ((this.overlayOn ? 1 : 0) - this.overlayFade) * (1 - Math.exp(-dt * 7));
    if (!this.overlayOn && this.overlayFade < 0.01) { this.overlay.visible = false; return; }
    if (!state) return;
    const f = this.overlayFade;
    this.overlayLine.opacity = 0.55 * f;
    for (let li = 0; li < 8; li++) {
      for (let c = 0; c < 3; c++) {
        const m = this.cells[li * 3 + c];
        const dens = state[li * 3 + c], sp = state[24 + li * 3 + c];
        m.material.opacity += ((dens > 0 ? 0.25 + 0.6 * dens : 0.06) * f - m.material.opacity) * 0.2;
        m.material.color.copy(this.slow).lerp(this.fast, dens > 0 ? sp : 1);
      }
      const q = Math.round(state[48 + li] * 20);
      const P = this.pillars[li];
      P.pillar.scale.y += (Math.max(0.01, q * 0.9 * f) - P.pillar.scale.y) * 0.2;
      P.pillar.material.opacity = 0.92 * f;
      P.sprite.position.set(P.base.x, P.pillar.scale.y + 2.2, P.base.z);
      P.sprite.visible = q > 0;
      P.sprite.material.opacity = f;
      if (q !== P.last) {
        P.last = q;
        const g = P.cv.getContext('2d');
        g.clearRect(0, 0, 128, 64);
        g.fillStyle = 'rgba(14,15,17,0.92)'; g.beginPath(); g.roundRect(18, 8, 92, 48, 10); g.fill();
        g.fillStyle = '#f4f4f2'; g.font = '600 32px "Geist Mono", monospace';
        g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(q), 64, 33);
        P.tex.needsUpdate = true;
      }
    }
  }

  // ----------------------------------------------------------- ambience
  animateAmbience(dt) {
    const t = this.time.value;
    for (const c of this.clouds) { c.position.x += dt * 2.2; if (c.position.x > 1400) c.position.x = -1400; }
    for (const p of this.steam) {
      const u = p.userData;
      u.t = (u.t + dt * 0.16) % 1;
      const k = u.t;
      p.position.set(u.x + Math.sin(k * 5 + u.x) * 0.6 + k * 3, 2.6 + k * 9, u.z + k * 1.5);
      const s = 0.45 + k * 2.1;
      p.scale.set(s, s * 0.85, s);
      p.material.opacity = 0.85 * (1 - k) * Math.min(1, k * 8);
    }
    for (const j of this.jets) {
      const h = j.userData.centre ? 2.6 + Math.sin(t * 3) * 0.3 : 1.4 + Math.sin(t * 2.4 + j.userData.phase) * 0.5;
      j.scale.y = h;
    }
  }

  // drop resolution if the GPU cannot keep up
  adaptQuality(dt) {
    if (this.quality !== 'auto' || this.adapted || this.tween) return;
    (this.frameTimes ||= []).push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg > 0.03 && this.dpr > 1) { this.dpr = 1; this.renderer.setPixelRatio(1); this.resize(); return; }
    this.adapted = true;
  }

  // --------------------------------------------------------------- camera
  setView(name, opts = {}) {
    const v = this.views[name];
    if (!v) return;
    this.view = name;
    this.controls.autoRotate = name === 'tour';
    const to = { pos: new THREE.Vector3(...v.pos), target: new THREE.Vector3(...v.target) };
    if (opts.instant) { this.camera.position.copy(to.pos); this.controls.target.copy(to.target); this.controls.update(); this.tween = null; return; }
    this.tween = { from: { pos: this.camera.position.clone(), target: this.controls.target.clone() }, to, t: 0, dur: opts.dur || 1.5, arc: opts.arc ?? 0.12 };
  }

  heading() {
    const d = new THREE.Vector3().subVectors(this.controls.target, this.camera.position);
    return Math.atan2(d.x, -d.z);
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.9 ? 48 : 34;
    this.camera.updateProjectionMatrix();
  }

  render(dt) {
    this.time.value += dt;
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const k = tw.t < 1 ? 1 - Math.pow(1 - tw.t, 4) : 1;
      this.camera.position.lerpVectors(tw.from.pos, tw.to.pos, k);
      this.camera.position.y += Math.sin(k * Math.PI) * tw.from.pos.distanceTo(tw.to.pos) * tw.arc;
      this.controls.target.lerpVectors(tw.from.target, tw.to.target, k);
      if (tw.t >= 1) this.tween = null;
    }
    this.controls.update();
    this.animateSignals(dt);
    this.animateAmbience(dt);
    this.adaptQuality(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
