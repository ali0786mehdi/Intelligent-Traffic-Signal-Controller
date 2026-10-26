// Daytime 3D intersection: roads and markings to the SUMO geometry, a Kenney
// city around it (CC0), Poly Haven asphalt / paving / sky (CC0), signal heads
// driven by the live phase, instanced vehicles with wheel spin, body pitch,
// brake lights and indicators, and the "agent view" overlay that paints the
// 71-value state onto the road.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { LANE_W, STOP, LANE_LEN, IN_LANES } from './sim.js';
import {
  mulberry, noiseTexture, wearTexture, arcPoints, flatPolygon, extrudedPolygon,
  atlasCells, cellRMTexture, dominantCell, patchAtlasMaterial, patchWind, sampleHorizon, sunFromHDR,
} from './scene-util.js';

import carsUrl from './assets/cars.glb?url';
import buildingsUrl from './assets/buildings.glb?url';
import treesUrl from './assets/trees.glb?url';
import asphaltDiffUrl from './assets/asphalt_diff.jpg?url';
import asphaltNorUrl from './assets/asphalt_nor.jpg?url';
import asphaltRoughUrl from './assets/asphalt_rough.jpg?url';
import paveDiffUrl from './assets/pavement_diff.jpg?url';
import paveNorUrl from './assets/pavement_nor.jpg?url';
import skyHdrUrl from './assets/sky.hdr?url';
import skyBgUrl from './assets/sky_bg.jpg?url';

const U = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const right = (v) => [-v[1], v[0]];
const HALF = 2 * LANE_W;        // 6.4 m: half road width (2 lanes each way)
const W = HALF + 0.4;           // curb line
const R = 5;                    // curb corner radius
const SW = 4.6;                 // sidewalk width
const L = 420;                  // drawn arm length
const FRONT = W + SW;           // building line

const C = {
  white: '#f3f1ea', yellow: '#e9b62c', pole: '#5d6368', housing: '#1f2225',
  lot: '#d8d4cb', grass: '#86a366', lawn: '#6f9a4c',
};
// realistic paint for Indian city traffic, weighted towards white and silver
const PAINT = ['#f2f2ef', '#f2f2ef', '#f2f2ef', '#c9ccd0', '#c9ccd0', '#8d939a', '#2a2d31', '#1d2a44', '#9b2b25', '#2f5f86', '#b9a27a', '#5a6e5a', '#e6e1d3'];
const CAR_MODELS = ['sedan', 'sedan-sports', 'hatchback-sports', 'suv', 'suv-luxury', 'taxi', 'van'];
const CAR_WEIGHTS = [5, 2, 4, 3, 2, 3, 1];

// plain float, indexed copy so geometries from different sources can be merged
function plain(geo) {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = geo.attributes[name];
    if (!a) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  if (geo.index) g.setIndex(Array.from(geo.index.array));
  else g.setIndex([...Array(geo.attributes.position.count).keys()]);
  return g;
}

// pull a photographic texture toward neutral grey (Poly Haven paving is warm)
function desaturate(mat, keep) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      diffuseColor.rgb = mix(vec3(lum), diffuseColor.rgb, ${keep.toFixed(2)});`);
  };
  mat.customProgramCacheKey = () => `desat-${keep}`;
}

const loadTex = (loader, url, srgb, repeat) => {
  const t = loader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 12;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.repeat.set(repeat, repeat);
  return t;
};

export class IntersectionScene {
  constructor(canvas, { quality = 'auto' } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.dpr = Math.min(window.devicePixelRatio, 1.75);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.5, 3000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 520;
    this.controls.autoRotateSpeed = 0.45;
    this.controls.addEventListener('start', () => { this.tween = null; this.controls.autoRotate = false; this.onUserCamera?.(); });

    this.time = { value: 0 };
    this.vis = new Map();
    this.views = {
      overview: { pos: [64, 52, 76], target: [-2, 0, -2] },
      street: { pos: [-8.6, 3.3, 23.5], target: [-0.5, 2.6, -8] },
      plan: { pos: [0, 330, 0.01], target: [0, 0, 0] },
      tour: { pos: [62, 15, 52], target: [0, 5, 0] },
      agent: { pos: [0, 205, 118], target: [0, 0, 6] },
    };
    this.camera.position.set(210, 190, 250);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
    this.ready = this.load();
  }

  async load() {
    const tl = new THREE.TextureLoader();
    const gl = new GLTFLoader();
    const [hdr, bg, cars, buildings, trees] = await Promise.all([
      new HDRLoader().setDataType(THREE.FloatType).loadAsync(skyHdrUrl),
      tl.loadAsync(skyBgUrl),
      gl.loadAsync(carsUrl), gl.loadAsync(buildingsUrl), gl.loadAsync(treesUrl),
    ]);
    this.tex = {
      asphalt: loadTex(tl, asphaltDiffUrl, true), asphaltN: loadTex(tl, asphaltNorUrl, false), asphaltR: loadTex(tl, asphaltRoughUrl, false),
      pave: loadTex(tl, paveDiffUrl, true), paveN: loadTex(tl, paveNorUrl, false),
    };
    this.buildSky(hdr, bg);
    this.buildLights(hdr);
    this.buildGround();
    this.buildRoad();
    this.buildMarkings();
    this.buildCity(buildings);
    this.buildStreetFurniture();
    this.buildTrees(trees);
    this.buildSignals();
    this.buildVehicles(cars);
    this.buildOverlay();
    this.buildPost();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.compile(this.scene, this.camera);
    return this;
  }

  // ---------------------------------------------------------------- world
  buildSky(hdr, bg) {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromEquirectangular(hdr).texture;
    this.scene.environmentIntensity = 0.85;
    bg.mapping = THREE.EquirectangularReflectionMapping;
    bg.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = bg;
    this.scene.backgroundIntensity = 1.0;
    const rot = new THREE.Euler(0, this.skyRotation(hdr), 0);
    this.scene.backgroundRotation.copy(rot);
    this.scene.environmentRotation.copy(rot);
    this.envRot = rot;
    const horizon = sampleHorizon(bg.image);
    this.scene.fog = new THREE.Fog(horizon, 260, 900);
  }

  // Rotate the sky so the sun sits behind the default camera's right shoulder.
  skyRotation(hdr) {
    const s = sunFromHDR(hdr);
    this.sunRaw = s;
    const want = Math.atan2(-0.62, 0.78); // azimuth (atan2(z, x)) we want the sun at
    const have = Math.atan2(s.z, s.x);
    return have - want;
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight('#dfeeff', '#a39a86', 0.55));
    const sun = new THREE.DirectionalLight('#fff1dc', 3.1);
    // same rotation the renderer applies to the sky, so shadows agree with the visible sun
    const dir = this.sunRaw.clone().applyEuler(new THREE.Euler(0, -this.envRot.y, 0));
    if (dir.y < 0.35) dir.y = 0.35;
    dir.normalize();
    this.sunDir = dir;
    sun.position.copy(dir).multiplyScalar(260);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const s = sun.shadow.camera;
    s.left = -150; s.right = 150; s.top = 150; s.bottom = -150; s.near = 40; s.far = 620;
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 3;
    this.scene.add(sun, sun.target);
    this.sun = sun;
  }

  buildGround() {
    const grassTex = noiseTexture(256, C.grass, 14);
    grassTex.repeat.set(220, 220);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: '#ffffff', map: grassTex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    ground.receiveShadow = true;
    this.scene.add(ground);
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
    const pts = [[W, -L], ...arcOrdered(1, -1, [W, -(W + R)]), [L, -W], [L, W], ...arcOrdered(1, 1, [W + R, W]),
      [W, L], [-W, L], ...arcOrdered(-1, 1, [-W, W + R]), [-L, W], [-L, -W], ...arcOrdered(-1, -1, [-(W + R), -W]), [-W, -L]];
    return pts;
  }

  buildRoad() {
    const pts = this.roadOutline();
    const T = this.tex;
    for (const t of [T.asphalt, T.asphaltN, T.asphaltR]) t.repeat.set(1 / 7, 1 / 7);
    const roadMat = new THREE.MeshStandardMaterial({
      color: '#8f9296', map: T.asphalt, normalMap: T.asphaltN, normalScale: new THREE.Vector2(0.9, 0.9),
      roughnessMap: T.asphaltR, roughness: 1.0, metalness: 0,
    });
    // large-scale tonal variation breaks up texture tiling
    roadMat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'varying vec3 vWPos;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        float big = sin(vWPos.x * 0.031 + 1.3) * sin(vWPos.z * 0.027 + 0.4) * 0.5 + sin(vWPos.x * 0.11 - vWPos.z * 0.07) * 0.18;
        diffuseColor.rgb *= 0.93 + big * 0.08;
        // darker oil band down the centre of each lane near the junction
        float lane = abs(fract((abs(vWPos.x) < 7.0 ? vWPos.x : vWPos.z) / 3.2) - 0.5);
        float near = smoothstep(80.0, 12.0, max(abs(vWPos.x), abs(vWPos.z)));
        diffuseColor.rgb *= 1.0 - near * smoothstep(0.18, 0.02, lane) * 0.12;`);
    };
    const geo = flatPolygon(pts, 0.0);
    const road = new THREE.Mesh(geo, roadMat);
    road.receiveShadow = true;
    this.scene.add(road);

    // sidewalks: paving on top, light concrete curb faces
    T.pave.repeat.set(1 / 3, 1 / 3); T.paveN.repeat.set(1 / 3, 1 / 3);
    const swMat = new THREE.MeshStandardMaterial({ color: '#e2e0dc', map: T.pave, normalMap: T.paveN, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.92 });
    const curbMat = new THREE.MeshStandardMaterial({ color: '#c9c6bf', roughness: 0.85 });
    desaturate(swMat, 0.3);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const arc = this.arcOrdered(sx, sz, [sx * W, sz * (W + R)]);
      const poly = [[sx * W, sz * L], ...arc, [sx * L, sz * W], [sx * L, sz * FRONT], [sx * FRONT, sz * FRONT], [sx * FRONT, sz * L]];
      const g = extrudedPolygon(poly, 0.16);
      const m = new THREE.Mesh(g, [swMat, curbMat]);
      m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  buildMarkings() {
    const wear = wearTexture();
    wear.repeat.set(0.25, 0.25);
    const paint = (color) => new THREE.MeshStandardMaterial({
      color, roughness: 0.55, alphaMap: wear, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const white = paint(C.white), yellow = paint(C.yellow);
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
      strip(dir, STOP + 0.05, STOP + 0.55, 0.1, HALF, 'white');
      for (let c = -HALF + 0.4; c < HALF - 0.3; c += 1.25) strip(dir, W + 0.4, STOP - 0.6, c, c + 0.65, 'white');
    }
    for (const k of ['white', 'yellow']) {
      const m = new THREE.Mesh(mergeGeometries(geos[k]), k === 'white' ? white : yellow);
      m.receiveShadow = true;
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
    am.renderOrder = 1;
    this.scene.add(am);
  }

  // ------------------------------------------------------------------ city
  buildCity(gltf) {
    const models = {};
    let atlas = null;
    for (const sc of gltf.scenes) {
      let mesh = null;
      sc.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
      if (!mesh) continue;
      sc.updateMatrixWorld(true);
      const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      geo.computeBoundingBox();
      models[sc.name] = { geo, box: geo.boundingBox, mat: mesh.material };
      atlas ||= mesh.material.map;
    }
    const cells = atlasCells(atlas);
    const rm = cellRMTexture(cells, (c) => (c.glass ? [0.06, 0.55] : c.lum < 0.12 ? [0.6, 0.1] : [0.82, 0.0]));
    const mat = patchAtlasMaterial(new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.8 }), { rm });
    this.cityMat = mat;

    const S = 10.5; // Kenney unit → metres (a storey ≈ 3.3 m)
    const rnd = mulberry(42);
    const placed = [];
    const free = (x0, z0, x1, z1) => !placed.some((p) => x0 < p[2] && x1 > p[0] && z0 < p[3] && z1 > p[1]);
    const place = (name, x, z, rotY, scale = S) => {
      const m = models[name];
      const mesh = new THREE.Mesh(m.geo, mat);
      mesh.scale.setScalar(scale);
      mesh.rotation.y = rotY;
      mesh.position.set(x, 0.12 - m.box.min.y * scale, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      return mesh;
    };
    const footprint = (name, scale = S) => {
      const b = models[name].box;
      return { w: (b.max.x - b.min.x) * scale, d: (b.max.z - b.min.z) * scale, cx: (b.max.x + b.min.x) / 2 * scale, cz: (b.max.z + b.min.z) / 2 * scale };
    };
    const frontage = ['building-a', 'building-b', 'building-c', 'building-d', 'building-e', 'building-f', 'building-g', 'building-h', 'building-i', 'building-j', 'building-k', 'building-l', 'building-m', 'building-n'];
    const tall = ['building-skyscraper-a', 'building-skyscraper-b', 'building-skyscraper-c', 'building-skyscraper-d', 'building-skyscraper-e'];
    const far = ['low-detail-building-a', 'low-detail-building-c', 'low-detail-building-e', 'low-detail-building-g', 'low-detail-building-wide-a', 'low-detail-building-wide-b'];

    // plazas under the city blocks
    const lotTex = noiseTexture(256, '#d9d8d4', 8);
    lotTex.repeat.set(60, 60);
    const lotMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, map: lotTex });
    for (const [sx, sz] of [[1, -1], [-1, 1], [-1, -1]]) {
      const lot = new THREE.Mesh(flatPolygon([[sx * FRONT, sz * FRONT], [sx * 300, sz * FRONT], [sx * 300, sz * 300], [sx * FRONT, sz * 300]], 0.05), lotMat);
      lot.receiveShadow = true; this.scene.add(lot);
    }

    for (const [sx, sz] of [[1, -1], [-1, 1], [-1, -1]]) {
      // x-frontage faces the east–west street; z-frontage faces the north–south street
      for (const axis of ['x', 'z']) {
        let t = axis === 'x' ? FRONT + 1.5 : FRONT + 26;
        while (t < 230) {
          const name = frontage[Math.floor(rnd() * frontage.length)];
          const f = footprint(name);
          const along = t + f.w / 2;
          const depth = FRONT + 1.2 + f.d / 2;
          let x, z, rot;
          if (axis === 'x') { x = sx * along; z = sz * depth; rot = sz > 0 ? Math.PI : 0; }
          else { x = sx * depth; z = sz * along; rot = -sx * Math.PI / 2; }
          const [hw, hd] = axis === 'x' ? [f.w / 2, f.d / 2] : [f.d / 2, f.w / 2];
          if (free(x - hw, z - hd, x + hw, z + hd)) {
            // centre the model's footprint on (x, z) after rotation
            const c = new THREE.Vector3(f.cx, 0, f.cz).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
            place(name, x - c.x, z - c.z, rot);
            placed.push([x - hw, z - hd, x + hw, z + hd]);
          }
          t += f.w + 1.2 + (rnd() < 0.2 ? 5 : 0);
        }
      }
      // second row: towers, then low-detail infill further out
      for (let i = 0; i < 40; i++) {
        const isTall = i < 7;
        const name = isTall ? tall[Math.floor(rnd() * tall.length)] : far[Math.floor(rnd() * far.length)];
        const scale = isTall ? S * 1.05 : S * (1.1 + rnd() * 0.5);
        const f = footprint(name, scale);
        const dist = isTall ? 44 + rnd() * 70 : 60 + rnd() * 190;
        const along = 20 + rnd() * 200;
        const [x, z] = rnd() < 0.5 ? [sx * along, sz * dist] : [sx * dist, sz * along];
        const hw = Math.max(f.w, f.d) / 2 + 1.5;
        if (!free(x - hw, z - hw, x + hw, z + hw)) continue;
        const rot = [0, Math.PI / 2, Math.PI, -Math.PI / 2][Math.floor(rnd() * 4)];
        const c = new THREE.Vector3(f.cx, 0, f.cz).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
        place(name, x - c.x, z - c.z, rot, scale);
        placed.push([x - hw, z - hw, x + hw, z + hw]);
      }
    }
    this.buildPark();
  }

  buildPark() {
    const sx = 1, sz = 1;
    const lawnTex = noiseTexture(256, C.lawn, 16);
    lawnTex.repeat.set(30, 30);
    const lawn = new THREE.Mesh(flatPolygon([[FRONT, FRONT], [300, FRONT], [300, 300], [FRONT, 300]], 0.06), new THREE.MeshStandardMaterial({ color: '#ffffff', map: lawnTex, roughness: 1 }));
    lawn.receiveShadow = true; this.scene.add(lawn);
    const pathMat = new THREE.MeshStandardMaterial({ color: '#efe9dc', roughness: 0.95, map: this.tex.pave, normalMap: this.tex.paveN, normalScale: new THREE.Vector2(0.4, 0.4) });
    const path = [];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      path.push([sx * (FRONT + 4 + t * 140), sz * (FRONT + 8 + Math.sin(t * 3.2) * 14 + t * 70)]);
    }
    const geos = [];
    for (let i = 0; i < path.length - 1; i++) {
      const [x0, z0] = path[i], [x1, z1] = path[i + 1];
      const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
      const g = new THREE.PlaneGeometry(3, len + 0.5);
      g.rotateX(-Math.PI / 2); g.rotateY(Math.atan2(dx, dz)); g.translate((x0 + x1) / 2, 0.08, (z0 + z1) / 2);
      geos.push(g);
    }
    const pm = new THREE.Mesh(mergeGeometries(geos), pathMat); pm.receiveShadow = true; this.scene.add(pm);
    const pond = new THREE.Mesh(new THREE.CircleGeometry(13, 48), new THREE.MeshStandardMaterial({ color: '#5f8fa3', roughness: 0.08, metalness: 0.2 }));
    pond.rotation.x = -Math.PI / 2; pond.position.set(88, 0.09, 40); pond.scale.set(1.4, 1, 1);
    pond.receiveShadow = true; this.scene.add(pond);
    const rim = new THREE.Mesh(new THREE.RingGeometry(13, 14.2, 48), new THREE.MeshStandardMaterial({ color: '#d8d2c4', roughness: 0.9 }));
    rim.rotation.x = -Math.PI / 2; rim.position.set(88, 0.1, 40); rim.scale.set(1.4, 1, 1); rim.receiveShadow = true; this.scene.add(rim);
    // pavilion
    const pav = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.4, 0.5, 32), new THREE.MeshStandardMaterial({ color: '#e9e4d8', roughness: 0.9 }));
    base.position.y = 0.3; base.receiveShadow = true; pav.add(base);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(6.2, 2.4, 32), new THREE.MeshStandardMaterial({ color: '#b8603f', roughness: 0.7 }));
    roof.position.y = 4.6; roof.castShadow = true; pav.add(roof);
    for (let a = 0; a < 6; a++) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 3.2, 12), new THREE.MeshStandardMaterial({ color: '#f2eee6', roughness: 0.6 }));
      col.position.set(Math.cos(a * 1.047) * 4.4, 2.0, Math.sin(a * 1.047) * 4.4); col.castShadow = true; pav.add(col);
    }
    pav.position.set(52, 0, 70);
    this.scene.add(pav);
  }

  buildStreetFurniture() {
    const quads = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    const lampMat = new THREE.MeshStandardMaterial({ color: C.pole, roughness: 0.4, metalness: 0.6 });
    const lampGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.08, 0.12, 8, 10).translate(0, 4, 0),
      new THREE.CylinderGeometry(0.2, 0.24, 0.5, 10).translate(0, 0.25, 0),
      new THREE.BoxGeometry(0.09, 0.09, 2.2).translate(0, 7.95, -1.0),
      new RoundedBoxGeometry(0.42, 0.14, 0.9, 2, 0.05).translate(0, 7.88, -2.05),
    ].map(plain));
    const lamps = [];
    for (const [sx, sz] of quads) for (let t = 33; t < 220; t += 26) {
      lamps.push([sx * t, sz * (W + 0.6), Math.atan2(0, sz)]);
      lamps.push([sx * (W + 0.6), sz * t, Math.atan2(sx, 0)]);
    }
    const lm = new THREE.InstancedMesh(lampGeo, lampMat, lamps.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    lamps.forEach(([x, z, a], i) => { q.setFromEuler(e.set(0, a, 0)); m4.compose(new THREE.Vector3(x, 0.13, z), q, new THREE.Vector3(1, 1, 1)); lm.setMatrixAt(i, m4); });
    lm.castShadow = true;
    this.scene.add(lm);

    // bollards at each corner
    const bollard = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.14, 0.9, 12).translate(0, 0.45, 0), new THREE.MeshStandardMaterial({ color: '#3a3e42', roughness: 0.5, metalness: 0.3 }), 40);
    let k = 0;
    for (const [sx, sz] of quads) {
      const arc = this.arcOrdered(sx, sz, [sx * W, sz * (W + R)]);
      for (let i = 2; i < arc.length - 1; i += 3) {
        const [x, z] = arc[i];
        const dx = x - sx * (W + R), dz = z - sz * (W + R), d = Math.hypot(dx, dz);
        m4.makeTranslation(sx * (W + R) + (dx / d) * (R - 0.45), 0.13, sz * (W + R) + (dz / d) * (R - 0.45));
        bollard.setMatrixAt(k++, m4);
      }
    }
    bollard.count = k;
    bollard.castShadow = true;
    this.scene.add(bollard);
  }

  buildTrees(gltf) {
    const kinds = {};
    for (const sc of gltf.scenes) {
      sc.updateMatrixWorld(true);
      const parts = [];
      sc.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const groups = o.geometry.groups.length ? o.geometry.groups : [{ start: 0, count: o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count, materialIndex: 0 }];
        for (const gr of groups) {
          const g = o.geometry.clone();
          g.clearGroups();
          if (g.index) g.setIndex(Array.from(g.index.array.slice(gr.start, gr.start + gr.count)));
          g.applyMatrix4(o.matrixWorld);
          parts.push({ g, m: mats[gr.materialIndex] });
        }
      });
      kinds[sc.name] = parts;
    }
    const leafMats = new Map();
    const matFor = (m) => {
      if (leafMats.has(m)) return leafMats.get(m);
      const isLeaf = /leaf|grass/i.test(m.name);
      const nm = new THREE.MeshStandardMaterial({ color: isLeaf ? '#5f9142' : /wood|bark/i.test(m.name) ? '#6e5443' : '#7d8a5c', roughness: isLeaf ? 0.8 : 0.95, vertexColors: false });
      if (isLeaf) patchWind(nm, this.time);
      leafMats.set(m, nm);
      return nm;
    };

    const rnd = mulberry(7);
    const list = { tree_oak: [], tree_default: [], tree_detailed: [], tree_fat: [], plant_bushLarge: [], plant_bush: [] };
    const street = ['tree_oak', 'tree_default', 'tree_detailed'];
    const quads = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (const [sx, sz] of quads) {
      for (let t = 27; t < 230; t += 12) {
        list[street[Math.floor(rnd() * 3)]].push([sx * t + (rnd() - 0.5), sz * (FRONT - 1.2), 5.2 + rnd() * 1.4]);
        list[street[Math.floor(rnd() * 3)]].push([sx * (FRONT - 1.2), sz * t + (rnd() - 0.5), 5.2 + rnd() * 1.4]);
      }
    }
    // park
    for (let i = 0; i < 120; i++) {
      const x = FRONT + 6 + rnd() * 160, z = FRONT + 6 + rnd() * 160;
      if (Math.hypot(x - 52, z - 70) < 10 || Math.hypot((x - 88) / 1.4, z - 40) < 16) continue;
      const kind = ['tree_oak', 'tree_fat', 'tree_default', 'tree_detailed', 'plant_bushLarge', 'plant_bush'][Math.floor(rnd() * 6)];
      list[kind].push([x, z, kind.startsWith('plant') ? 4 + rnd() * 2 : 6 + rnd() * 3]);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    for (const [kind, items] of Object.entries(list)) {
      if (!items.length || !kinds[kind]) continue;
      for (const p of kinds[kind]) {
        const im = new THREE.InstancedMesh(p.g, matFor(p.m), items.length);
        items.forEach(([x, z, s], i) => {
          const r2 = mulberry(Math.floor(x * 131 + z * 17))();
          q.setFromAxisAngle(up, r2 * 6.28);
          m4.compose(new THREE.Vector3(x, 0.1, z), q, new THREE.Vector3(s, s * (0.9 + r2 * 0.25), s));
          im.setMatrixAt(i, m4);
          im.setColorAt(i, col.setHSL(0, 0, 0.84 + r2 * 0.16));
        });
        im.castShadow = true;
        im.receiveShadow = true;
        this.scene.add(im);
      }
    }
  }

  // -------------------------------------------------------------- signals
  buildSignals() {
    const poleMat = new THREE.MeshStandardMaterial({ color: C.pole, roughness: 0.35, metalness: 0.7 });
    const housingMat = new THREE.MeshStandardMaterial({ color: C.housing, roughness: 0.45, metalness: 0.2 });
    const plateMat = new THREE.MeshStandardMaterial({ color: '#141617', roughness: 0.6 });
    const edgeMat = new THREE.MeshStandardMaterial({ color: '#e9b62c', roughness: 0.5 });
    this.lensOn = { R: new THREE.Color('#ff2d1f'), Y: new THREE.Color('#ffa600'), G: new THREE.Color('#14e07a') };
    this.lensOff = { R: new THREE.Color('#2b0f0d'), Y: new THREE.Color('#2b1f08'), G: new THREE.Color('#0c2416') };
    this.lensMats = {};
    this.lampLevel = {};
    for (const d of ['N', 'E', 'S', 'W']) {
      this.lensMats[d] = {}; this.lampLevel[d] = {};
      for (const k of ['R', 'Y', 'G']) {
        this.lensMats[d][k] = new THREE.MeshStandardMaterial({ color: this.lensOff[k].clone(), emissive: this.lensOn[k], emissiveIntensity: 0, roughness: 0.2 });
        this.lampLevel[d][k] = 0;
      }
    }
    this.countdowns = {};
    const head = (d, withTimer) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new RoundedBoxGeometry(0.46, 1.25, 0.34, 2, 0.05), housingMat));
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
        // countdown box, as on Indian fixed-time junctions
        const box = new THREE.Mesh(new RoundedBoxGeometry(0.62, 0.42, 0.22, 2, 0.04), housingMat);
        box.position.set(0, -1.02, 0);
        const cv = document.createElement('canvas'); cv.width = 128; cv.height = 80;
        const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
        const face = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.34), new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 9, roughness: 0.3 }));
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
      grp.position.set(base[0], 0.13, base[1]);
      grp.rotation.y = Math.atan2(dir[0], dir[1]);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 6.6, 16), poleMat); pole.position.y = 3.3;
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.35, 16), poleMat); foot.position.y = 0.17;
      const armLen = W + 1.3 - LANE_W * 0.9;
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, armLen, 12), poleMat);
      arm.rotation.z = Math.PI / 2; arm.position.set(armLen / 2, 6.2, 0);
      const h1 = head(d, false); h1.position.set(armLen - 0.1, 5.35, 0);
      const h2 = head(d, true); h2.position.set(0, 3.3, -0.36);
      grp.add(pole, foot, arm, h1, h2);
      grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.scene.add(grp);
    }
  }

  setSignals(states) { this.signalStates = states; }

  // remaining: {N: seconds|null, ...}; colour follows that approach's lamp
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
      g.fillStyle = '#000'; g.fillRect(0, 0, 128, 80);
      g.fillStyle = s === 'G' ? '#2bff8e' : s === 'Y' ? '#ffb000' : '#ff3a2a';
      g.font = '700 62px "Geist Mono", ui-monospace, monospace';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(txt || '--', 64, 44);
      if (!txt) { g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(0, 0, 128, 80); }
      c.tex.needsUpdate = true;
    }
  }

  animateSignals(dt) {
    if (!this.signalStates) return;
    const k = 1 - Math.exp(-dt * 14); // LED rise/fall ≈ 70 ms
    for (const d of ['N', 'E', 'S', 'W']) for (const key of ['R', 'Y', 'G']) {
      const target = this.signalStates[d] === key ? 1 : 0;
      const lv = (this.lampLevel[d][key] += (target - this.lampLevel[d][key]) * k);
      const m = this.lensMats[d][key];
      m.emissiveIntensity = lv * 18;
      m.color.copy(this.lensOff[key]).lerp(this.lensOn[key], lv * 0.6);
    }
  }

  // ------------------------------------------------------------- vehicles
  buildVehicles(gltf) {
    const atlas = gltf.scenes[0].getObjectByProperty('isMesh', true).material.map;
    atlas.anisotropy = 8;
    const cells = atlasCells(atlas);
    const rm = cellRMTexture(cells, (c) => (c.glass ? [0.05, 0.3] : c.lum < 0.1 ? [0.75, 0.0] : c.lum > 0.85 ? [0.35, 0.1] : [0.45, 0.15]));
    const tail = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    this.cars = [];
    for (const name of CAR_MODELS) {
      const sc = gltf.scenes.find((s) => s.name === name);
      sc.updateMatrixWorld(true);
      let body = null;
      const wheels = [];
      sc.traverse((o) => {
        if (!o.isMesh) return;
        if (/^wheel-(front|back)-(left|right)$/.test(o.name)) wheels.push({ geo: o.geometry, matrix: o.matrixWorld.clone(), sign: o.matrixWorld.elements[0] >= 0 ? 1 : -1 });
        else {
          const g = plain(o.geometry).applyMatrix4(o.matrixWorld);
          body = body ? mergeGeometries([body, g]) : g;
        }
      });
      body.computeBoundingBox();
      const b = body.boundingBox;
      const len = b.max.z - b.min.z, wid = b.max.x - b.min.x;
      // stretch Kenney's stubby proportions toward a real 4.1 m × 1.75 m car
      const scale = new THREE.Vector3(1.75 / wid, 1.2, 4.1 / len);
      const paintCell = name === 'taxi' ? null : dominantCell(body, cells);
      const mat = patchAtlasMaterial(new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.5 }), { rm, paintCell });
      const max = 160;
      const bodyIM = new THREE.InstancedMesh(body, mat, max);
      body.setAttribute('aPaint', new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(-1), 3));
      const wheelIMs = wheels.map((w) => new THREE.InstancedMesh(w.geo, mat, max));
      const lights = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.12, 0.05), tail, max * 4);
      const rearZ = b.min.z * scale.z - 0.01, frontZ = b.max.z * scale.z + 0.01;
      const lightY = (b.min.y + (b.max.y - b.min.y) * 0.42) * scale.y;
      const halfW = (wid / 2) * scale.x - 0.22;
      for (const im of [bodyIM, ...wheelIMs, lights]) { im.count = 0; im.frustumCulled = false; im.castShadow = im !== lights; im.receiveShadow = true; this.scene.add(im); }
      lights.setColorAt(0, new THREE.Color(0, 0, 0));
      this.cars.push({ name, bodyIM, wheelIMs, wheels, lights, scale, rearZ, frontZ, lightY, halfW, wheelR: 0.3 * scale.y, max, paint: !!paintCell });
    }
    this.buildOtherVehicles();
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this._c = new THREE.Color(); this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._w = new THREE.Matrix4(); this._r = new THREE.Matrix4(); this._sm = new THREE.Matrix4();
  }

  // buses, motorcycles and autos for the mixed-fleet scenario (no CC0 models fit these)
  buildOtherVehicles() {
    const rb = (w, h, d, r = 0.18, s = 3) => new RoundedBoxGeometry(w, h, d, s, r);
    const paint = (c, rough = 0.32) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0.3 });
    const glass = new THREE.MeshStandardMaterial({ color: '#1c252c', roughness: 0.05, metalness: 0.6 });
    const tyre = new THREE.MeshStandardMaterial({ color: '#17191b', roughness: 0.85 });
    const rimM = new THREE.MeshStandardMaterial({ color: '#b9bdc2', roughness: 0.3, metalness: 0.8 });
    const tail = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    const wheel = (r, w) => new THREE.CylinderGeometry(r, r, w, 18).rotateZ(Math.PI / 2);
    const four = (W2, L2, r, w, inset) => mergeGeometries([-1, 1].flatMap((sx) => [-1, 1].map((sz) => wheel(r, w).translate(sx * (W2 / 2 - w / 2 + 0.02), r, sz * (L2 / 2 - inset)))));
    const hubs = (W2, L2, r, w, inset) => mergeGeometries([-1, 1].flatMap((sx) => [-1, 1].map((sz) => wheel(r * 0.55, w + 0.02).translate(sx * (W2 / 2 - w / 2 + 0.02), r, sz * (L2 / 2 - inset)))));
    const tails = (W2, L2, y) => mergeGeometries([-1, 1].map((sx) => new THREE.BoxGeometry(0.34, 0.16, 0.06).translate(sx * (W2 / 2 - 0.3), y, -L2 / 2 - 0.01)));
    this.others = {
      bus: { max: 60, parts: [
        { g: rb(2.5, 1.3, 11.9, 0.2).translate(0, 1.05, 0), m: paint('#c8372d') },          // BEST red lower body
        { g: rb(2.48, 1.25, 11.6, 0.16).translate(0, 2.25, 0), m: paint('#efe6d2', 0.5) },    // cream upper
        { g: new THREE.BoxGeometry(2.52, 0.78, 10.2).translate(0, 2.3, 0.3), m: glass },
        { g: new THREE.BoxGeometry(2.3, 1.0, 0.06).translate(0, 2.2, 5.93), m: glass },
        { g: rb(2.2, 0.18, 10.6, 0.06).translate(0, 2.95, 0), m: paint('#dcd6c8', 0.6) },
        { g: four(2.5, 11.9, 0.52, 0.34, 2.4), m: tyre },
        { g: hubs(2.5, 11.9, 0.52, 0.34, 2.4), m: rimM },
        { g: tails(2.5, 11.9, 0.95), m: tail, brake: true },
      ] },
      motorcycle: { max: 260, parts: [
        { g: rb(0.34, 0.42, 1.6, 0.12).translate(0, 0.62, 0.05), m: paint('#ffffff'), tint: true },
        { g: rb(0.36, 0.18, 0.7, 0.08).translate(0, 0.9, -0.35), m: paint('#1c1d20', 0.6) },
        { g: rb(0.46, 0.6, 0.34, 0.15).translate(0, 1.28, -0.22), m: paint('#ffffff', 0.7), rider: true },
        { g: new THREE.SphereGeometry(0.17, 16, 12).translate(0, 1.76, -0.12), m: paint('#ffffff', 0.25), helmet: true },
        { g: mergeGeometries([wheel(0.3, 0.12).translate(0, 0.3, 0.72), wheel(0.3, 0.12).translate(0, 0.3, -0.72)]), m: tyre },
        { g: new THREE.BoxGeometry(0.18, 0.08, 0.05).translate(0, 0.78, -0.86), m: tail, brake: true },
      ] },
      auto: { max: 160, parts: [
        { g: rb(1.36, 0.7, 2.7, 0.18).translate(0, 0.62, 0), m: paint('#22764a') },
        { g: rb(1.32, 0.9, 1.95, 0.26).translate(0, 1.5, -0.25), m: paint('#f2c230', 0.45) },
        { g: new THREE.BoxGeometry(1.2, 0.5, 0.06).translate(0, 1.34, 0.74), m: glass },
        { g: rb(1.0, 0.5, 0.3, 0.08).translate(0, 0.98, -0.95), m: paint('#1c1d20', 0.8) },
        { g: mergeGeometries([wheel(0.24, 0.16).translate(0, 0.24, 1.0), wheel(0.24, 0.16).translate(-0.58, 0.24, -0.9), wheel(0.24, 0.16).translate(0.58, 0.24, -0.9)]), m: tyre },
        { g: tails(1.36, 2.7, 0.72), m: tail, brake: true },
      ] },
    };
    this.motoColors = ['#b8322a', '#22344d', '#d4561f', '#13806f', '#7b8288', '#e8b92c', '#202226'];
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
    const counts = new Map();
    const lightCounts = new Map();
    for (const c of this.cars) { counts.set(c, 0); lightCounts.set(c, 0); }
    const oc = { bus: 0, motorcycle: 0, auto: 0 };
    const m = this._m, q = this._q, p = this._p;
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
      this._e.set(st.pitch, h, st.roll, 'YXZ');
      q.setFromEuler(this._e);

      if (v.type === 'passenger' || v.type === 'car') {
        const car = st.model;
        const i = counts.get(car);
        if (i >= car.max) continue;
        counts.set(car, i + 1);
        st.spin += (v.v * dt) / car.wheelR;
        m.compose(p, q, car.scale);
        car.bodyIM.setMatrixAt(i, m);
        if (car.paint) {
          const col = this._c.set(PAINT[v.color % PAINT.length]);
          car.bodyIM.geometry.attributes.aPaint.setXYZ(i, col.r, col.g, col.b);
        }
        // wheels: ground-aligned (no body pitch), spinning about their axle
        this._e.set(0, h, 0, 'YXZ'); q.setFromEuler(this._e);
        this._w.compose(p, q, this._s);
        car.wheels.forEach((w, k) => {
          const wm = this._sm.copy(w.matrix);
          const pos = new THREE.Vector3().setFromMatrixPosition(wm).multiply(car.scale);
          wm.setPosition(pos);
          wm.multiply(this._r.makeScale(car.scale.y, car.scale.y, car.scale.y)).multiply(this._r.makeRotationX(st.spin * w.sign));
          car.wheelIMs[k].setMatrixAt(i, this._r.multiplyMatrices(this._w, wm));
        });
        // tail lights (2) + indicators (2) per car
        let li = lightCounts.get(car);
        this._e.set(st.pitch, h, st.roll, 'YXZ'); q.setFromEuler(this._e);
        const brake = braking ? this._c.setRGB(18, 0.9, 0.4) : this._c.setRGB(0.35, 0.03, 0.02);
        for (const sx of [-1, 1]) {
          const lp = new THREE.Vector3(sx * car.halfW, car.lightY, car.rearZ).applyQuaternion(q).add(p);
          m.compose(lp, q, this._s); car.lights.setMatrixAt(li, m); car.lights.setColorAt(li, brake); li++;
        }
        const side = v.move === 'R' ? -1 : 1;
        const on = turning && blink;
        for (const z0 of [car.rearZ - 0.005, car.frontZ]) {
          const lp = new THREE.Vector3(side * (car.halfW + 0.12), car.lightY + 0.02, z0).applyQuaternion(q).add(p);
          if (on) m.compose(lp, q, this._s); else m.makeScale(0, 0, 0);
          car.lights.setMatrixAt(li, m); car.lights.setColorAt(li, this._c.setRGB(18, 7, 0.4)); li++;
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
          if (part.brake) im.setColorAt(i, braking ? this._c.setRGB(18, 0.9, 0.4) : this._c.setRGB(0.35, 0.03, 0.02));
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
    let r = ((v.color * 7919) % 1000) / 1000 * total;
    for (let i = 0; i < this.cars.length; i++) { r -= CAR_WEIGHTS[i]; if (r <= 0) return this.cars[i]; }
    return this.cars[0];
  }

  // ------------------------------------------------------- agent overlay
  buildOverlay() {
    this.overlay = new THREE.Group();
    this.overlay.visible = false;
    this.overlayFade = 0;
    this.cells = [];
    this.pillars = [];
    const CELL = 200 / 3;
    this.overlayLine = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.0, depthWrite: false });
    IN_LANES.forEach(([d, i], li) => {
      const u = U[d], dir = [-u[0], -u[1]], r = right(dir);
      const off = LANE_W / 2 + LANE_W * (1 - i);
      for (let c = 0; c < 3; c++) {
        const a0 = Math.max(0, c * CELL - 10.4) + 0.6, a1 = Math.min(LANE_LEN, (c + 1) * CELL - 10.4) - 0.6;
        const len = a1 - a0, mid = STOP + (a0 + a1) / 2;
        const geo = new THREE.PlaneGeometry(LANE_W - 0.5, len);
        geo.rotateX(-Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({ color: '#5ce1cf', transparent: true, opacity: 0.0, depthWrite: false, fog: false, toneMapped: false });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.y = Math.atan2(dir[0], dir[1]);
        mesh.position.set(u[0] * mid + r[0] * off, 0.06, u[1] * mid + r[1] * off);
        mesh.renderOrder = 2;
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), this.overlayLine);
        edges.rotation.copy(mesh.rotation); edges.position.copy(mesh.position); edges.position.y = 0.07;
        this.overlay.add(mesh, edges);
        this.cells[li * 3 + c] = mesh;
      }
      const pg = new RoundedBoxGeometry(LANE_W - 0.8, 1, 1.6, 2, 0.12).translate(0, 0.5, 0);
      const pm = new THREE.MeshStandardMaterial({ color: '#f4c15d', transparent: true, opacity: 0.92, roughness: 0.35, emissive: '#f4c15d', emissiveIntensity: 0.35 });
      const pillar = new THREE.Mesh(pg, pm);
      pillar.position.set(u[0] * (STOP + 2.2) + r[0] * off, 0.05, u[1] * (STOP + 2.2) + r[1] * off);
      pillar.rotation.y = Math.atan2(dir[0], dir[1]);
      pillar.scale.y = 0.01;
      this.overlay.add(pillar);
      const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false, toneMapped: false }));
      sprite.scale.set(6, 3, 1);
      sprite.renderOrder = 5;
      this.overlay.add(sprite);
      this.pillars[li] = { pillar, sprite, cv, tex, last: -1, base: pillar.position.clone() };
    });
    this.scene.add(this.overlay);
    this.slow = new THREE.Color('#ff7a52');
    this.fast = new THREE.Color('#5ce1cf');
  }

  setOverlay(on) { this.overlayOn = on; if (on) this.overlay.visible = true; }

  updateOverlay(state, dt) {
    const target = this.overlayOn ? 1 : 0;
    this.overlayFade += (target - this.overlayFade) * (1 - Math.exp(-dt * 7));
    if (!this.overlayOn && this.overlayFade < 0.01) { this.overlay.visible = false; return; }
    if (!state) return;
    const f = this.overlayFade;
    this.overlayLine.opacity = 0.55 * f;
    for (let li = 0; li < 8; li++) {
      for (let c = 0; c < 3; c++) {
        const m = this.cells[li * 3 + c];
        const dens = state[li * 3 + c], sp = state[24 + li * 3 + c];
        const want = (dens > 0 ? 0.25 + 0.6 * dens : 0.06) * f;
        m.material.opacity += (want - m.material.opacity) * 0.2;
        m.material.color.copy(this.slow).lerp(this.fast, dens > 0 ? sp : 1);
      }
      const q = Math.round(state[48 + li] * 20);
      const P = this.pillars[li];
      const h = Math.max(0.01, q * 0.9 * f);
      P.pillar.scale.y += (h - P.pillar.scale.y) * 0.2;
      P.pillar.material.opacity = 0.92 * f;
      P.sprite.position.set(P.base.x, P.pillar.scale.y + 2.2, P.base.z);
      P.sprite.visible = q > 0;
      P.sprite.material.opacity = f;
      if (q !== P.last) {
        P.last = q;
        const g = P.cv.getContext('2d');
        g.clearRect(0, 0, 128, 64);
        g.fillStyle = 'rgba(14,15,17,0.92)';
        g.beginPath(); g.roundRect(18, 8, 92, 48, 10); g.fill();
        g.fillStyle = '#f4f4f2';
        g.font = '600 32px "Geist Mono", monospace';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(q), 64, 33);
        P.tex.needsUpdate = true;
      }
    }
  }

  // ------------------------------------------------------------ post
  buildPost() {
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    const rt = new THREE.WebGLRenderTarget(size.x || 1, size.y || 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = new GTAOPass(this.scene, this.camera, size.x || 1, size.y || 1);
    this.ao.output = GTAOPass.OUTPUT.Default;
    this.ao.blendIntensity = 0.85;
    this.ao.updateGtaoMaterial({ radius: 2.2, distanceExponent: 1.4, thickness: 2.0, scale: 1.0, samples: 12 });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    this.composer.addPass(this.ao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.6, 0.4, 3.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.frameTimes = [];
  }

  // drop the costliest effects if the GPU cannot keep up (desktop iGPUs)
  adaptQuality(dt) {
    if (this.quality !== 'auto' || this.adapted || this.tween) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg > 0.03 && this.ao.enabled) { this.ao.enabled = false; return; }
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
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  render(dt) {
    this.time.value += dt;
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const k = tw.t < 1 ? 1 - Math.pow(1 - tw.t, 4) : 1;
      this.camera.position.lerpVectors(tw.from.pos, tw.to.pos, k);
      // lift the camera through the middle of the move so it arcs over the city
      const dist = tw.from.pos.distanceTo(tw.to.pos);
      this.camera.position.y += Math.sin(k * Math.PI) * dist * tw.arc;
      this.controls.target.lerpVectors(tw.from.target, tw.to.target, k);
      if (tw.t >= 1) this.tween = null;
    }
    this.controls.update();
    this.animateSignals(dt);
    this.adaptQuality(dt);
    this.composer.render(dt);
  }
}
