// Fetch and pack the CC0 assets used by the 3D scene.
//   node tools/fetch-assets.mjs
// Source (CC0): Kenney Car Kit, https://kenney.nl/assets/car-kit
// Output: src/assets/cars.glb (texture embedded, one scene per model)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const cache = path.join(root, '.asset-cache');
const out = path.join(root, 'src', 'assets');
fs.mkdirSync(cache, { recursive: true });
fs.mkdirSync(out, { recursive: true });

const KITS = {
  'car-kit': 'https://kenney.nl/media/pages/assets/car-kit/1a312ec241-1775131960/kenney_car-kit.zip',
};

const q = (a) => (/[\s&()]/.test(a) && !a.startsWith('"') ? `"${a}"` : a);
const sh = (cmd, args) => execFileSync(cmd, args.map(q), { stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' });
async function download(url, file) {
  if (fs.existsSync(file)) return;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  console.log('downloaded', path.basename(file));
}

for (const [k, url] of Object.entries(KITS)) {
  const zip = path.join(cache, `${k}.zip`);
  await download(url, zip);
  if (!fs.existsSync(path.join(cache, k))) execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force '${zip}' '${path.join(cache, k)}'`], { stdio: 'inherit' });
}


// models: merge each family into one GLB (texture embedded once)
const findGlb = (kit, name) => {
  const all = fs.readdirSync(path.join(cache, kit), { recursive: true });
  const hit = all.find((f) => f.replace(/\\/g, '/').endsWith(`GLB format/${name}.glb`) || f.replace(/\\/g, '/').endsWith(`/${name}.glb`));
  if (!hit) throw new Error(`missing ${name} in ${kit}`);
  return path.join(cache, kit, hit);
};
const GROUPS = {
  cars: ['car-kit', ['sedan', 'sedan-sports', 'hatchback-sports', 'suv', 'suv-luxury', 'taxi', 'van']],
};
for (const [group, [kit, names]] of Object.entries(GROUPS)) {
  const inputs = names.map((n) => findGlb(kit, n));
  const tmp = path.join(cache, `${group}.merged.glb`);
  sh('npx', ['gltf-transform', 'merge', ...inputs, tmp]);
  sh('npx', ['gltf-transform', 'dedup', tmp, path.join(out, `${group}.glb`)]);
  console.log('packed', group, `${(fs.statSync(path.join(out, `${group}.glb`)).size / 1024).toFixed(0)} KB`);
}
console.log('done');
