// Procedural, stylized New York block: brick and brownstone mid-rises with
// fire escapes, cornices, storefronts, awnings and rooftop water towers;
// a hazy art-deco skyline; and street props (hydrants, steam stack, subway entrance).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon } from './stylize.js';

const BAY = 3.2, STOREY = 3.4, SHOP = 4.4;

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// One tile = 2 bays × 2 storeys of facade.
function facadeTex(wall, { mortar = true, frame = '#efe8d8', glass = '#3f5c74', lintel = null, arch = false, rnd }) {
  return canvasTex(256, 256, (g, W, H) => {
    g.fillStyle = wall; g.fillRect(0, 0, W, H);
    if (mortar) {
      g.fillStyle = 'rgba(255,255,255,0.07)';
      for (let y = 0; y < H; y += 8) g.fillRect(0, y, W, 1);
      for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(0,0,0,${0.03 + rnd() * 0.05})`; g.fillRect(rnd() * W, rnd() * H, 6 + rnd() * 6, 3); }
    }
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
      const x = c * 128 + 34, y = r * 128 + 30, w = 60, h = 78;
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x - 2, y - 2, w + 8, h + 10);           // reveal shadow
      g.fillStyle = frame; g.fillRect(x - 5, y - 5, w + 10, h + 10);
      if (lintel) { g.fillStyle = lintel; g.fillRect(x - 9, y - 14, w + 18, 10); }
      g.fillStyle = frame; g.fillRect(x - 9, y + h + 4, w + 18, 7);                         // sill
      g.fillStyle = glass;
      if (arch) { g.beginPath(); g.moveTo(x, y + h); g.lineTo(x, y + 18); g.arc(x + w / 2, y + 18, w / 2, Math.PI, 0); g.lineTo(x + w, y + h); g.fill(); }
      else g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(190,220,240,0.35)'; g.fillRect(x + 4, y + 4, w * 0.35, h * 0.5);  // sky glint
      g.fillStyle = frame; g.fillRect(x, y + h * 0.48, w, 4); g.fillRect(x + w / 2 - 2, y, 4, h); // sash
    }
  });
}

function shopTex(sign, rnd) {
  return canvasTex(256, 176, (g, W, H) => {
    g.fillStyle = '#2b2d31'; g.fillRect(0, 0, W, H);
    g.fillStyle = sign; g.fillRect(0, 0, W, 38);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 6; i++) g.fillRect(24 + i * 34 + rnd() * 4, 15, 20, 8);              // greeked lettering
    g.fillStyle = '#56738a'; g.fillRect(10, 50, 150, 118);
    g.fillStyle = 'rgba(210,230,245,0.35)'; g.fillRect(16, 56, 50, 70);
    g.fillStyle = '#3a3c40'; for (let x = 10; x < 160; x += 50) g.fillRect(x, 50, 4, 118);
    g.fillStyle = '#7b5a3c'; g.fillRect(180, 58, 58, 110);                                   // door
    g.fillStyle = '#56738a'; g.fillRect(188, 66, 42, 54);
  });
}

// Box with world-scale UVs: one texture repeat covers tileW × tileH metres.
function boxUV(w, h, d, tileW, tileH) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * (dims[f][0] / tileW), uv.getY(i) * (dims[f][1] / tileH));
  }
  return g;
}

export class NYCBuilder {
  constructor(scene, rnd) {
    this.scene = scene;
    this.rnd = rnd;
    this.batches = new Map(); // material -> geometries
    const R = rnd;
    this.styles = {
      redBrick: toon('#ffffff', { map: facadeTex('#a6553f', { rnd: R, lintel: '#e6dcc6' }) }),
      darkBrick: toon('#ffffff', { map: facadeTex('#7f4636', { rnd: R, lintel: '#d9ccb2' }) }),
      tanBrick: toon('#ffffff', { map: facadeTex('#c98d5e', { rnd: R, frame: '#f4eee2', lintel: '#8f5b3c' }) }),
      creamBrick: toon('#ffffff', { map: facadeTex('#e3d3b4', { rnd: R, frame: '#3b4a57', glass: '#35556d', lintel: '#b9a27e' }) }),
      limestone: toon('#ffffff', { map: facadeTex('#e9dfca', { mortar: false, frame: '#d6c8aa', glass: '#3b5b73', arch: true, rnd: R }) }),
      brownstone: toon('#ffffff', { map: facadeTex('#7a4e3d', { mortar: false, frame: '#2d2623', glass: '#3a5266', lintel: '#5e3b2e', arch: true, rnd: R }) }),
    };
    this.shops = ['#2f5d3a', '#a3312a', '#1f3b5c', '#d8a23a', '#3c3a37', '#7a2f4a'].map((c) => toon('#ffffff', { map: shopTex(c, R) }));
    this.awnings = ['#2f6b3f', '#b1372d', '#24466e', '#e0a838', '#efe6d2'].map((c) => toon(c));
    this.m = {
      corniceLight: toon('#efe4cc'), corniceDark: toon('#3d3a38'), roof: toon('#77787c'), iron: toon('#26282b'),
      wood: toon('#8b5a3a'), woodDark: toon('#5b3b28'), steel: toon('#9aa0a6'), stoop: toon('#6d4535'),
      skyline: toon('#a9bccd'), skylineDark: toon('#91a7bb'),
    };
  }

  add(mat, geo, matrix) { if (matrix) geo.applyMatrix4(matrix); if (!this.batches.has(mat)) this.batches.set(mat, []); this.batches.get(mat).push(geo); }

  // A building in its own frame: front facade faces +z, base centred at the origin.
  building({ x, z, rotY, bays, depth, storeys, style, frontage = true, tower = false }) {
    const R = this.rnd;
    const w = bays * BAY, h = SHOP + storeys * STOREY;
    const M = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, 0, z);
    const at = (gx, gy, gz) => new THREE.Matrix4().multiplyMatrices(M, new THREE.Matrix4().makeTranslation(gx, gy, gz));
    const mat = this.styles[style];
    // upper body, uv offset so windows start above the shopfront
    const body = boxUV(w, h - SHOP, depth, BAY * 2, STOREY * 2);
    this.add(mat, body, at(0, SHOP + (h - SHOP) / 2, 0));
    // shopfront
    const shop = boxUV(w + 0.08, SHOP, depth + 0.08, BAY * 2, SHOP);
    this.add(this.shops[Math.floor(R() * this.shops.length)], shop, at(0, SHOP / 2, 0));
    // cornices
    const corn = style === 'creamBrick' || style === 'limestone' ? this.m.corniceDark : this.m.corniceLight;
    this.add(corn, new THREE.BoxGeometry(w + 0.9, 0.7, depth + 0.9), at(0, h + 0.1, 0));
    this.add(corn, new THREE.BoxGeometry(w + 0.5, 0.35, depth + 0.5), at(0, SHOP + 0.15, 0));
    this.add(this.m.roof, new THREE.BoxGeometry(w - 0.2, 0.2, depth - 0.2), at(0, h + 0.5, 0));
    if (storeys > 6 && R() < 0.5) this.add(corn, new THREE.BoxGeometry(w + 0.3, 0.3, depth + 0.3), at(0, SHOP + STOREY * Math.floor(storeys * 0.66), 0));

    if (frontage) {
      // awnings over a couple of bays
      const aw = this.awnings[Math.floor(R() * this.awnings.length)];
      const nA = Math.max(1, Math.floor(bays / 2));
      for (let i = 0; i < nA; i++) {
        const ax = -w / 2 + (i + 0.5) * (w / nA);
        const g = new THREE.BoxGeometry(Math.min(BAY * 1.7, w / nA - 0.4), 0.12, 1.5);
        g.rotateX(0.32);
        this.add(aw, g, at(ax, SHOP - 0.55, depth / 2 + 0.7));
      }
      // fire escape on brick walk-ups
      if (style.endsWith('Brick') && storeys <= 9 && R() < 0.85) this.fireEscape(at, w, depth, storeys);
    }
    if (style === 'brownstone') {
      // stoop
      for (let s = 0; s < 6; s++) this.add(this.m.stoop, new THREE.BoxGeometry(2.0, 0.22, 3.2 - s * 0.45), at(-w / 4, 0.11 + s * 0.22, depth / 2 + 1.6 - s * 0.22));
    }
    // water tower
    if (!tower && storeys >= 4 && R() < 0.55) this.waterTower(at, (R() - 0.5) * (w - 4), h + 0.6, (R() - 0.5) * (depth - 4));
    // rooftop bulkhead
    if (R() < 0.7) this.add(this.m.roof, new THREE.BoxGeometry(3, 2.4, 3), at((R() - 0.5) * (w - 4), h + 1.6, (R() - 0.5) * (depth - 4)));
    return { w, h };
  }

  fireEscape(at, w, depth, storeys) {
    const fw = Math.min(w - 1.2, BAY * 2.2), fx = 0;
    for (let s = 1; s < storeys; s++) {
      const y = SHOP + s * STOREY - 0.2;
      this.add(this.m.iron, new THREE.BoxGeometry(fw, 0.07, 1.1), at(fx, y, depth / 2 + 0.55));
      this.add(this.m.iron, new THREE.BoxGeometry(fw, 0.05, 0.05), at(fx, y + 0.95, depth / 2 + 1.08));
      for (let k = 0; k <= 6; k++) this.add(this.m.iron, new THREE.BoxGeometry(0.04, 0.95, 0.04), at(fx - fw / 2 + (k / 6) * fw, y + 0.48, depth / 2 + 1.08));
      // ladder between landings
      const lad = new THREE.BoxGeometry(0.5, Math.hypot(STOREY, fw * 0.55), 0.06);
      lad.rotateZ(Math.atan2(fw * 0.55, STOREY) * (s % 2 ? 1 : -1));
      this.add(this.m.iron, lad, at(fx, y + STOREY / 2, depth / 2 + 0.75));
    }
  }

  waterTower(at, x, y, z) {
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.add(this.m.iron, new THREE.BoxGeometry(0.14, 2.2, 0.14), at(x + lx * 1.05, y + 1.1, z + lz * 1.05));
    this.add(this.m.iron, new THREE.BoxGeometry(2.6, 0.12, 2.6), at(x, y + 2.2, z));
    this.add(this.m.wood, new THREE.CylinderGeometry(1.55, 1.6, 3.0, 16), at(x, y + 3.8, z));
    for (const by of [2.9, 3.8, 4.7]) this.add(this.m.iron, new THREE.CylinderGeometry(1.63, 1.63, 0.07, 16), at(x, y + by, z));
    this.add(this.m.woodDark, new THREE.ConeGeometry(1.8, 1.3, 16), at(x, y + 5.95, z));
  }

  // Art-deco setback tower
  tower({ x, z, rotY, base, storeys, style = 'limestone', spire = true }) {
    const R = this.rnd;
    let w = base, d = base, y = 0;
    const M = new THREE.Matrix4().makeRotationY(rotY).setPosition(x, 0, z);
    const at = (gx, gy, gz) => new THREE.Matrix4().multiplyMatrices(M, new THREE.Matrix4().makeTranslation(gx, gy, gz));
    const tiers = [Math.floor(storeys * 0.5), Math.floor(storeys * 0.25), Math.floor(storeys * 0.15), Math.max(2, Math.floor(storeys * 0.1))];
    tiers.forEach((n, i) => {
      const hh = n * STOREY + (i === 0 ? SHOP : 0);
      const g = boxUV(w, hh, d, BAY * 2, STOREY * 2);
      this.add(i === 0 && R() < 0.5 ? this.styles.creamBrick : this.styles[style], g, at(0, y + hh / 2, 0));
      this.add(this.m.corniceLight, new THREE.BoxGeometry(w + 0.6, 0.5, d + 0.6), at(0, y + hh, 0));
      y += hh;
      w *= 0.74; d *= 0.74;
    });
    if (spire) {
      this.add(this.m.steel, new THREE.ConeGeometry(w * 0.55, 9, 8), at(0, y + 4.5, 0));
      this.add(this.m.steel, new THREE.CylinderGeometry(0.15, 0.15, 7, 6), at(0, y + 12, 0));
    }
    return y;
  }

  skyline(rnd) {
    for (let i = 0; i < 46; i++) {
      const a = -Math.PI * 0.95 + rnd() * Math.PI * 1.25;     // mostly north and west of the junction
      const r = 520 + rnd() * 420;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const base = 22 + rnd() * 26, hgt = 60 + rnd() * rnd() * 220;
      let w = base, y = 0;
      const mat = rnd() < 0.5 ? this.m.skyline : this.m.skylineDark;
      const tiers = 1 + Math.floor(rnd() * 3);
      for (let t = 0; t < tiers; t++) {
        const hh = (hgt / tiers) * (t === 0 ? 1.3 : 0.8);
        this.add(mat, new THREE.BoxGeometry(w, hh, w * (0.7 + rnd() * 0.5)), new THREE.Matrix4().makeTranslation(x, y + hh / 2, z));
        y += hh; w *= 0.72;
      }
      if (rnd() < 0.3) this.add(mat, new THREE.ConeGeometry(w * 0.4, 18, 6), new THREE.Matrix4().makeTranslation(x, y + 9, z));
    }
  }

  flush() {
    for (const [mat, geos] of this.batches) {
      const m = new THREE.Mesh(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g))), mat);
      m.castShadow = mat !== this.m.skyline && mat !== this.m.skylineDark;
      m.receiveShadow = true;
      this.scene.add(m);
    }
    this.batches.clear();
  }
}

export const NYC = { BAY, STOREY, SHOP };
