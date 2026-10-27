// Shared helpers for the 3D scene: textures, flat/extruded polygons, Kenney
// atlas analysis, and material patches (paint, per-cell roughness, wind).
import * as THREE from 'three';

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function noiseTexture(size, base, spread, grain = 1) {
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

// Blotchy alpha for worn road paint (white = paint present).
export function wearTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, size, size);
  const rnd = mulberry(9);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * size, y = rnd() * size, r = 0.6 + rnd() * rnd() * 7;
    const v = 120 + Math.floor(rnd() * 120);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function arcPoints(cx, cz, r, a0, a1, n = 16) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); }
  return pts;
}

// Flat polygon in the XZ plane (points given as [x, z]), facing up. UVs = world metres.
export function flatPolygon(points, y = 0) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ShapeGeometry(shape, 4);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  const n = geo.attributes.normal;
  if (n.getY(0) < 0) {
    const idx = geo.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t; }
    for (let i = 0; i < n.count; i++) n.setY(i, 1);
  }
  return geo;
}

export function extrudedPolygon(points, height) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.04, bevelSegments: 2, curveSegments: 6 });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, -0.03, 0);
  return geo;
}

// ------------------------------------------------------------ Kenney atlas
// Kenney kits share a 512² colour atlas made of 32×128 px swatches (16 × 4).
export const ATLAS_COLS = 16, ATLAS_ROWS = 4;

export function atlasCells(texture) {
  const img = texture.image;
  const c = document.createElement('canvas');
  c.width = ATLAS_COLS; c.height = ATLAS_ROWS;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, ATLAS_COLS, ATLAS_ROWS);
  const d = g.getImageData(0, 0, ATLAS_COLS, ATLAS_ROWS).data;
  const cells = [];
  for (let r = 0; r < ATLAS_ROWS; r++) for (let k = 0; k < ATLAS_COLS; k++) {
    const i = (r * ATLAS_COLS + k) * 4;
    const [R, G, B] = [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
    const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const sat = Math.max(R, G, B) - Math.min(R, G, B);
    cells.push({ col: k, row: r, R, G, B, lum, sat, glass: B > R + 0.08 && B >= G && lum > 0.3 });
  }
  return cells;
}

// Roughness (r) and metalness (g) per atlas cell, as a nearest-filtered 16×4 texture.
export function cellRMTexture(cells, rule) {
  const data = new Uint8Array(ATLAS_COLS * ATLAS_ROWS * 4);
  cells.forEach((c, i) => {
    const [r, m] = rule(c);
    data[i * 4] = Math.round(r * 255); data[i * 4 + 1] = Math.round(m * 255); data[i * 4 + 3] = 255;
  });
  const t = new THREE.DataTexture(data, ATLAS_COLS, ATLAS_ROWS);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

// The swatch a car body is painted with: the most-used saturated cell by UV area.
export function dominantCell(geometry, cells) {
  const uv = geometry.attributes.uv, pos = geometry.attributes.position, idx = geometry.index;
  const area = new Float32Array(ATLAS_COLS * ATLAS_ROWS);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = idx ? idx.count : pos.count;
  for (let t = 0; t < n; t += 3) {
    const i0 = idx ? idx.getX(t) : t, i1 = idx ? idx.getX(t + 1) : t + 1, i2 = idx ? idx.getX(t + 2) : t + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    const ar = b.sub(a).cross(c.sub(a)).length();
    const u = (uv.getX(i0) + uv.getX(i1) + uv.getX(i2)) / 3, v = (uv.getY(i0) + uv.getY(i1) + uv.getY(i2)) / 3;
    const k = Math.min(ATLAS_COLS - 1, Math.max(0, Math.floor(u * ATLAS_COLS))) + Math.min(ATLAS_ROWS - 1, Math.max(0, Math.floor(v * ATLAS_ROWS))) * ATLAS_COLS;
    area[k] += ar;
  }
  let best = -1, bestA = 0;
  for (let k = 0; k < area.length; k++) {
    const cell = cells[k];
    if (cell.lum < 0.25 || cell.sat < 0.18 || cell.glass) continue;
    if (area[k] > bestA) { bestA = area[k]; best = k; }
  }
  return best < 0 ? null : cells[best];
}

// Patch a MeshStandardMaterial: per-cell roughness/metalness from the atlas,
// optional repaint of one swatch with a per-instance colour (aPaint, r<0 = keep).
export function patchAtlasMaterial(mat, { rm, paintCell = null, paintRough = 0.26, paintMetal = 0.35 }) {
  const rect = paintCell
    ? new THREE.Vector4(paintCell.col / ATLAS_COLS, paintCell.row / ATLAS_ROWS, (paintCell.col + 1) / ATLAS_COLS, (paintCell.row + 1) / ATLAS_ROWS)
    : new THREE.Vector4(-1, -1, -1, -1);
  const ref = paintCell ? Math.max(0.05, Math.pow(paintCell.lum, 2.2)) : 1;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uCellRM = { value: rm };
    sh.uniforms.uPaintRect = { value: rect };
    sh.uniforms.uPaintRef = { value: ref };
    sh.vertexShader = 'attribute vec3 aPaint;\nvarying vec3 vPaint;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPaint = aPaint;');
    sh.fragmentShader = 'uniform sampler2D uCellRM;\nuniform vec4 uPaintRect;\nuniform float uPaintRef;\nvarying vec3 vPaint;\nfloat gPaint = 0.0;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec2 puv = vMapUv;
          gPaint = step(uPaintRect.x, puv.x) * step(puv.x, uPaintRect.z) * step(uPaintRect.y, puv.y) * step(puv.y, uPaintRect.w) * step(0.0, vPaint.r);
          float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          diffuseColor.rgb = mix(diffuseColor.rgb, vPaint * clamp(l / uPaintRef, 0.55, 1.35), gPaint);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        vec2 cellRM = texture2D(uCellRM, vMapUv).rg;
        roughnessFactor = mix(cellRM.r, ${paintRough.toFixed(3)}, gPaint);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(cellRM.g, ${paintMetal.toFixed(3)}, gPaint);`);
  };
  mat.customProgramCacheKey = () => `atlas-${rect.x.toFixed(4)}-${rect.y.toFixed(4)}-${paintRough}`;
  return mat;
}

// Wind sway for instanced foliage.
export function patchWind(mat, timeUniform, strength = 0.035) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uTime = timeUniform;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 ip = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
        float hh = max(position.y - 0.35, 0.0);
        float w = sin(uTime * 1.25 + ip.x * 0.13 + ip.y * 0.09) * 0.6 + sin(uTime * 2.3 + ip.x * 0.31) * 0.25;
        transformed.x += w * hh * ${strength.toFixed(3)};
        transformed.z += w * hh * ${(strength * 0.7).toFixed(3)};
      #endif`);
  };
  mat.customProgramCacheKey = () => `wind-${strength}`;
}

export function sampleHorizon(image) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 32;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(image, 0, 0, 64, 32);
  const d = g.getImageData(0, 14, 64, 2).data;
  let r = 0, gg = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
  const n = d.length / 4;
  return new THREE.Color(`rgb(${Math.round(r / n)},${Math.round(gg / n)},${Math.round(b / n)})`);
}

// Direction of the brightest texel of an equirect HDR (the sun), in three's equirect convention.
export function sunFromHDR(tex) {
  const { data, width, height } = tex.image;
  let best = -1, bi = 0;
  const stride = data.length / (width * height);
  for (let i = 0; i < width * height; i++) {
    const l = data[i * stride] * 0.2126 + data[i * stride + 1] * 0.7152 + data[i * stride + 2] * 0.0722;
    if (l > best) { best = l; bi = i; }
  }
  const x = bi % width, y = Math.floor(bi / width);
  const u = (x + 0.5) / width;
  const v = tex.flipY ? 1 - (y + 0.5) / height : (y + 0.5) / height;
  const el = (v - 0.5) * Math.PI, az = (u - 0.5) * 2 * Math.PI;
  return new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
}
