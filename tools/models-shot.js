// Screenshot the model gallery: node tools/models-shot.js [shot ...]
// shot = name:querystring, e.g. "move:anim=move". Writes .audit/shots/models-<name>.png, prints stats + console errors.
import { chromium } from 'playwright-core';
import { homedir } from 'node:os';

const base = process.env.BASE || 'http://localhost:5201/tools/models.html';
const shots = process.argv.slice(2).map(s => s.split(/:(.*)/s));
const exe = process.env.CHROME || `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
let stats;
for (const [name, qs = ''] of shots) {
  await page.goto(`${base}?${qs}`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 15000 });
  await page.waitForTimeout(Number(process.env.WAIT || 900));
  stats ??= await page.evaluate(() => window.__stats);
  await page.screenshot({ path: `.audit/shots/models-${name}.png` });
  console.log('shot', name);
}
console.log(JSON.stringify(stats));
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
