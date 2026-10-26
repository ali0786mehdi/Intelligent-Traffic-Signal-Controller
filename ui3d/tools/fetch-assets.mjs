// Fetch and pack the CC0 assets used by the 3D scene.
//   node tools/fetch-assets.mjs
// Sources (all CC0):
//   Kenney Car Kit, City Kit (Commercial), Nature Kit  — https://kenney.nl
//   Poly Haven asphalt_04, concrete_pavement_02, kloofendal_48d_partly_cloudy_puresky — https://polyhaven.com
// Output: src/assets/{cars,buildings,trees}.glb (texture embedded, one scene per model),
//         src/assets/*.jpg / sky.hdr
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
  'city-commercial': 'https://kenney.nl/media/pages/assets/city-kit-commercial/a742d900eb-1753115042/kenney_city-kit-commercial_2.1.zip',
  'nature-kit': 'https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip',
};
const PH = 'https://dl.polyhaven.org/file/ph-assets';
const FILES = {
  'asphalt_diff.jpg': `${PH}/Textures/jpg/2k/asphalt_04/asphalt_04_diff_2k.jpg`,
  'asphalt_nor.jpg': `${PH}/Textures/jpg/1k/asphalt_04/asphalt_04_nor_gl_1k.jpg`,
  'asphalt_rough.jpg': `${PH}/Textures/jpg/1k/asphalt_04/asphalt_04_rough_1k.jpg`,
  'pavement_diff.jpg': `${PH}/Textures/jpg/1k/concrete_pavement_02/concrete_pavement_02_diff_1k.jpg`,
  'pavement_nor.jpg': `${PH}/Textures/jpg/1k/concrete_pavement_02/concrete_pavement_02_nor_gl_1k.jpg`,
  'sky.hdr': `${PH}/HDRIs/hdr/1k/kloofendal_48d_partly_cloudy_puresky_1k.hdr`,
  'sky_bg.jpg': `${PH}/HDRIs/extra/Tonemapped%20JPG/kloofendal_48d_partly_cloudy_puresky.jpg`,
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
for (const [name, url] of Object.entries(FILES)) await download(url, path.join(cache, name));

// textures: re-encode to keep the single-file build small
const ff = (inp, outName, scale) => sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(cache, inp), ...(scale ? ['-vf', `scale=${scale}`] : []), '-q:v', '4', path.join(out, outName)]);
ff('asphalt_diff.jpg', 'asphalt_diff.jpg');
ff('asphalt_nor.jpg', 'asphalt_nor.jpg');
ff('asphalt_rough.jpg', 'asphalt_rough.jpg');
ff('pavement_diff.jpg', 'pavement_diff.jpg');
ff('pavement_nor.jpg', 'pavement_nor.jpg');
ff('sky_bg.jpg', 'sky_bg.jpg', '4096:2048');
fs.copyFileSync(path.join(cache, 'sky.hdr'), path.join(out, 'sky.hdr'));

// models: merge each family into one GLB (texture embedded once)
const findGlb = (kit, name) => {
  const all = fs.readdirSync(path.join(cache, kit), { recursive: true });
  const hit = all.find((f) => f.replace(/\\/g, '/').endsWith(`GLB format/${name}.glb`) || f.replace(/\\/g, '/').endsWith(`/${name}.glb`));
  if (!hit) throw new Error(`missing ${name} in ${kit}`);
  return path.join(cache, kit, hit);
};
const GROUPS = {
  cars: ['car-kit', ['sedan', 'sedan-sports', 'hatchback-sports', 'suv', 'suv-luxury', 'taxi', 'van']],
  buildings: ['city-commercial', ['building-a', 'building-b', 'building-c', 'building-d', 'building-e', 'building-f', 'building-g', 'building-h', 'building-i', 'building-j', 'building-k', 'building-l', 'building-m', 'building-n', 'building-skyscraper-a', 'building-skyscraper-b', 'building-skyscraper-c', 'building-skyscraper-d', 'building-skyscraper-e', 'low-detail-building-a', 'low-detail-building-c', 'low-detail-building-e', 'low-detail-building-g', 'low-detail-building-wide-a', 'low-detail-building-wide-b']],
  trees: ['nature-kit', ['tree_oak', 'tree_default', 'tree_detailed', 'tree_fat', 'plant_bushLarge', 'plant_bush']],
};
for (const [group, [kit, names]] of Object.entries(GROUPS)) {
  const inputs = names.map((n) => findGlb(kit, n));
  const tmp = path.join(cache, `${group}.merged.glb`);
  sh('npx', ['gltf-transform', 'merge', ...inputs, tmp]);
  sh('npx', ['gltf-transform', 'dedup', tmp, path.join(out, `${group}.glb`)]);
  console.log('packed', group, `${(fs.statSync(path.join(out, `${group}.glb`)).size / 1024).toFixed(0)} KB`);
}
console.log('done');
