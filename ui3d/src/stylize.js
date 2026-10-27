// Stylized look: soft toon ramp, toon materials, procedural textures,
// Kenney atlas repaint, procedural trees, grass and clouds.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ATLAS_COLS, ATLAS_ROWS } from './scene-util.js';

// Soft two-tone ramp: shadow side gets no direct light, lit side ramps up quickly.
export function toonRamp() {
  const n = 64;
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const s = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
    const v = s(0.46, 0.6, x) * 0.78 + s(0.6, 1.0, x) * 0.22;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = Math.round(v * 255);
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, n, 1);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

let RAMP = null;
export function toon(color, extra = {}) {
  RAMP ||= toonRamp();
  return new THREE.MeshToonMaterial({ color, gradientMap: RAMP, ...extra });
}

// ------------------------------------------------------------ procedural textures
function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const speckle = (g, size, n, colors, rmax, rnd) => {
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(rnd() * colors.length)];
    const r = 0.5 + rnd() * rmax;
    g.beginPath(); g.arc(rnd() * size, rnd() * size, r, 0, Math.PI * 2); g.fill();
  }
};

export function asphaltTex(rnd) {
  return canvasTex(512, (g, s) => {
    g.fillStyle = '#5b606b'; g.fillRect(0, 0, s, s);
    speckle(g, s, 9000, ['#555a65', '#61666f', '#585d68', '#666a73'], 1.6, rnd);
    speckle(g, s, 40, ['rgba(70,74,84,0.35)', 'rgba(110,114,122,0.18)'], 26, rnd);
  });
}

// 1.2 m sandstone pavers with joints; one texture repeat = 4.8 m
export function paverTex(rnd) {
  return canvasTex(512, (g, s) => {
    g.fillStyle = '#d9cbb2'; g.fillRect(0, 0, s, s);
    const n = 4, w = s / n;
    for (let k = 0; k < n; k++) for (let i = -1; i <= n; i++) {
      const off = (k % 2) * w * 0.5;
      const l = 228 - Math.floor(rnd() * 14);
      g.fillStyle = `rgb(${l},${l - 12},${l - 30})`;
      g.fillRect(i * w + off + 3, k * w + 3, w - 6, w - 6);
    }
    speckle(g, s, 1800, ['rgba(160,140,110,0.18)', 'rgba(255,255,255,0.18)'], 1.4, rnd);
  });
}

export function slabTex(rnd) {
  return canvasTex(512, (g, s) => {
    g.fillStyle = '#c9c7c1'; g.fillRect(0, 0, s, s);
    const n = 3, w = s / n;
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
      const l = 210 - Math.floor(rnd() * 12);
      g.fillStyle = `rgb(${l},${l - 2},${l - 7})`;
      g.fillRect(i * w + 2, k * w + 2, w - 4, w - 4);
    }
    speckle(g, s, 2200, ['rgba(120,118,112,0.16)', 'rgba(255,255,255,0.2)'], 1.3, rnd);
    speckle(g, s, 14, ['rgba(60,60,58,0.10)'], 7, rnd); // old gum
  });
}

export function plazaTex(rnd) {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#ece2cf'; g.fillRect(0, 0, s, s);
    speckle(g, s, 1500, ['rgba(200,184,156,0.35)', 'rgba(255,255,255,0.4)'], 1.6, rnd);
    g.strokeStyle = 'rgba(190,172,140,0.55)'; g.lineWidth = 2;
    g.strokeRect(1, 1, s - 2, s - 2);
  });
}

export function wornAlpha(rnd) {
  return canvasTex(256, (g, s) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, s, s);
    speckle(g, s, 500, ['#bbb', '#ccc', '#999'], 3, rnd);
  }, false);
}

// ---------------------------------------------------------- Kenney atlas repaint
export function wallCell(geometry, cells) {
  const uv = geometry.attributes.uv, pos = geometry.attributes.position, idx = geometry.index;
  const area = new Float32Array(ATLAS_COLS * ATLAS_ROWS);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = idx ? idx.count : pos.count;
  for (let t = 0; t < n; t += 3) {
    const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    const ar = b.sub(a).cross(c.sub(a)).length();
    const u = (uv.getX(i0) + uv.getX(i1) + uv.getX(i2)) / 3, v = (uv.getY(i0) + uv.getY(i1) + uv.getY(i2)) / 3;
    area[Math.min(ATLAS_COLS - 1, Math.max(0, Math.floor(u * ATLAS_COLS))) + Math.min(ATLAS_ROWS - 1, Math.max(0, Math.floor(v * ATLAS_ROWS))) * ATLAS_COLS] += ar;
  }
  let best = -1, bestA = 0;
  for (let k = 0; k < area.length; k++) {
    if (cells[k].lum < 0.78 || cells[k].sat > 0.15) continue;
    if (area[k] > bestA) { bestA = area[k]; best = k; }
  }
  return best < 0 ? null : cells[best];
}

// Repaint one atlas swatch. mode 'instanced' reads attribute aPaint (r<0 keeps the original),
// mode 'uniform' reads uniform uPaint.
export function patchPaint(mat, cell, mode, color) {
  const rect = cell
    ? new THREE.Vector4(cell.col / ATLAS_COLS, cell.row / ATLAS_ROWS, (cell.col + 1) / ATLAS_COLS, (cell.row + 1) / ATLAS_ROWS)
    : new THREE.Vector4(-1, -1, -1, -1);
  const ref = cell ? Math.max(0.05, Math.pow(cell.lum, 2.2)) : 1;
  const uPaint = { value: new THREE.Color(color || '#ffffff') };
  mat.userData.uPaint = uPaint;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPaintRect = { value: rect };
    sh.uniforms.uPaintRef = { value: ref };
    if (mode === 'instanced') {
      sh.vertexShader = 'attribute vec3 aPaint;\nvarying vec3 vPaint;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPaint = aPaint;');
      sh.fragmentShader = 'varying vec3 vPaint;\n' + sh.fragmentShader;
    } else {
      sh.uniforms.uPaint = uPaint;
      sh.fragmentShader = 'uniform vec3 uPaint;\n#define vPaint uPaint\n' + sh.fragmentShader;
    }
    sh.fragmentShader = 'uniform vec4 uPaintRect;\nuniform float uPaintRef;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec2 puv = vMapUv;
        float inP = step(uPaintRect.x, puv.x) * step(puv.x, uPaintRect.z) * step(uPaintRect.y, puv.y) * step(puv.y, uPaintRect.w) * step(0.0, vPaint.r);
        float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(diffuseColor.rgb, vPaint * clamp(l / uPaintRef, 0.7, 1.15), inP);
      }`);
  };
  mat.customProgramCacheKey = () => `paint-${mode}-${rect.x.toFixed(4)}-${rect.y.toFixed(4)}`;
  return mat;
}

// ------------------------------------------------------------ procedural trees
const hash = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };

// A rounded canopy made of a few overlapping lumpy spheres.
export function canopyGeometry(seed, lobes = 4) {
  const rnd = (k) => hash(seed, k, seed * 0.37);
  const parts = [];
  for (let i = 0; i < lobes; i++) {
    const r = i === 0 ? 1.0 : 0.62 + rnd(i) * 0.25;
    const g = new THREE.IcosahedronGeometry(r, 3);
    const a = (i / lobes) * Math.PI * 2 + rnd(i + 9);
    const d = i === 0 ? 0 : 0.62;
    g.translate(Math.cos(a) * d, i === 0 ? 0 : -0.12 + rnd(i + 3) * 0.45, Math.sin(a) * d);
    parts.push(g);
  }
  let g = mergeVertices(mergeSimple(parts), 1e-3);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * 3.1 + seed) * Math.sin(y * 2.7 + seed * 1.3) * Math.sin(z * 3.3) * 0.08;
    p.setXYZ(i, x * (1 + n), y * (0.88 + n) , z * (1 + n));
  }
  g.computeVertexNormals();
  return g;
}

function mergeSimple(geos) {
  // position/normal only, all non-indexed → indexed by mergeVertices later
  let count = 0;
  const flat = geos.map((g) => { const ng = g.index ? g.toNonIndexed() : g; count += ng.attributes.position.count; return ng; });
  const pos = new Float32Array(count * 3);
  let o = 0;
  for (const g of flat) { pos.set(g.attributes.position.array, o); o += g.attributes.position.array.length; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return out;
}

// ------------------------------------------------------------------- grass
// One merged mesh of triangular blades. Normals point up so blades shade like
// the ground and receive tree shadows; aTip (0 base, 1 tip) drives wind and colour.
export function grassGeometry(points, rnd) {
  const n = points.length;
  const pos = new Float32Array(n * 9), nor = new Float32Array(n * 9), col = new Float32Array(n * 9), tip = new Float32Array(n * 3), base = new Float32Array(n * 6);
  const cBase = new THREE.Color('#4c8a35'), cTip = new THREE.Color('#b4d85e'), cDry = new THREE.Color('#d8d27a'), tmp = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const [x, z, s] = points[i];
    const a = rnd() * Math.PI, w = 0.09 + rnd() * 0.06, h = (0.38 + rnd() * 0.5) * s;
    const dx = Math.cos(a) * w, dz = Math.sin(a) * w;
    const lean = (rnd() - 0.5) * 0.25;
    const v = [x - dx, 0, z - dz, x + dx, 0, z + dz, x + lean, h, z + lean * 0.6];
    pos.set(v, i * 9);
    for (let k = 0; k < 3; k++) { nor[i * 9 + k * 3 + 1] = 1; base[i * 6 + k * 2] = x; base[i * 6 + k * 2 + 1] = z; }
    tip[i * 3 + 2] = 1;
    const dry = rnd() < 0.08;
    const shade = 0.85 + rnd() * 0.25;
    tmp.copy(cBase).multiplyScalar(shade);
    col.set([tmp.r, tmp.g, tmp.b, tmp.r, tmp.g, tmp.b], i * 9);
    tmp.copy(dry ? cDry : cTip).multiplyScalar(0.9 + rnd() * 0.15);
    col.set([tmp.r, tmp.g, tmp.b], i * 9 + 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aTip', new THREE.BufferAttribute(tip, 1));
  g.setAttribute('aBase', new THREE.BufferAttribute(base, 2));
  g.computeBoundingSphere();
  return g;
}

export function grassMaterial(time) {
  const m = toon('#ffffff', { vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = 'uniform float uTime;\nattribute float aTip;\nattribute vec2 aBase;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      float gust = sin(aBase.x * 0.045 + uTime * 0.9) * 0.5 + 0.5;
      float w = sin(uTime * 2.2 + aBase.x * 0.35 + aBase.y * 0.25) * (0.35 + gust * 0.65);
      transformed.x += w * aTip * 0.22;
      transformed.z += w * aTip * 0.12;
      transformed.y -= abs(w) * aTip * 0.05;`);
  };
  m.customProgramCacheKey = () => 'grass';
  return m;
}

// --------------------------------------------------------------------- clouds
export function cloudGeometry(seed) {
  const rnd = (k) => hash(seed, k, 3.1);
  const parts = [];
  const n = 5 + Math.floor(rnd(1) * 4);
  for (let i = 0; i < n; i++) {
    const r = 6 + rnd(i + 2) * 7;
    const g = new THREE.IcosahedronGeometry(r, 2);
    g.translate((i - n / 2) * 7.5 + rnd(i + 5) * 4, rnd(i + 7) * 4, (rnd(i + 11) - 0.5) * 10);
    parts.push(g);
  }
  const g = mergeVertices(mergeSimple(parts), 1e-3);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < -2) p.setY(i, -2 - (p.getY(i) + 2) * 0.15); // flat bottoms
  g.computeVertexNormals();
  return g;
}
