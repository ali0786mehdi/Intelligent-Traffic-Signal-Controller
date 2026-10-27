// node tools/shoot.mjs [outDir] — desktop + mobile screenshots of dist/index.html using local Edge/Chrome
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || path.join(here, '..', 'shots');
fs.mkdirSync(out, { recursive: true });
const exe = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => fs.existsSync(p));
const url = pathToFileURL(path.join(here, '..', 'dist', 'index.html')).href + (process.env.QS ?? '?q=high');

const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const shots = [
  { name: 'desktop', w: 1440, h: 900, dpr: 1, act: async () => {} },
  { name: 'desktop-agent', w: 1440, h: 900, dpr: 1, act: async (p) => { await p.click('#agentToggle'); await sleep(4000); } },
  { name: 'desktop-board', w: 1440, h: 900, dpr: 1, act: async (p) => { await p.click('#agentToggle'); await p.click('#boardBtn'); await sleep(1500); } },
  { name: 'desktop-street', w: 1440, h: 900, dpr: 1, act: async (p) => { await p.click('#viewSeg button:nth-of-type(2)'); await p.click('#raceRows button:nth-child(1)'); await sleep(4000); } },
  { name: 'desktop-plan', w: 1440, h: 900, dpr: 1, act: async (p) => { await p.click('#viewSeg button:nth-of-type(3)'); await p.click('#raceRows button:nth-child(2)'); await sleep(4000); } },
  { name: 'desktop-tour', w: 1440, h: 900, dpr: 1, act: async (p) => { await p.click('#viewSeg button:nth-of-type(4)'); await sleep(5000); } },
  { name: 'mobile', w: 390, h: 844, dpr: 2, mobile: true, act: async () => {} },
  { name: 'mobile-scrolled', w: 390, h: 844, dpr: 2, mobile: true, act: async (p) => { await p.evaluate(() => window.scrollTo(0, 700)); await sleep(600); } },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.env.ONLY;
for (const s of shots) {
  if (only && !only.split(',').includes(s.name)) continue;
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.setViewport({ width: s.w, height: s.h, deviceScaleFactor: s.dpr, isMobile: !!s.mobile, hasTouch: !!s.mobile });
  await page.goto(url, { waitUntil: 'load' });
  await sleep(Number(process.env.WAIT || 6000));
  await s.act(page);
  const file = path.join(out, `${s.name}.png`);
  await page.screenshot({ path: file, fullPage: !!s.full });
  console.log(file, errors.length ? `\n  ${errors.slice(0, 6).join('\n  ')}` : '');
  await page.close();
}
await browser.close();
