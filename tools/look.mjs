// Visual check for render changes: menu, match, pond and boss shots plus fps and draw calls.
// node tools/look.mjs [tag] [--w 1440 --h 900 --dpr 1 --lang de|en]  -> .audit/shots/look/<tag>-*.png
import { launch } from './chrome.mjs';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const tag = args[0] && !args[0].startsWith('--') ? args[0] : 'now';
const W = Number(opt('--w', 1440)), H = Number(opt('--h', 900)), DPR = Number(opt('--dpr', 1));
const LANG = opt('--lang', null);
const out = '.audit/shots/look';
mkdirSync(out, { recursive: true });

const browser = await launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => (m.type() === 'error' || m.type() === 'warning') && errors.push(m.text()));

const shot = async name => page.screenshot({ path: `${out}/${tag}-${name}.png` });
const perf = () => page.evaluate(() => new Promise(r => {
  let n = 0, calls = 0; const t0 = performance.now();
  const f = () => { n++; calls = Math.max(calls, __pw.renderer.info.render.calls); performance.now() - t0 < 2000 ? requestAnimationFrame(f) : r({ fps: Math.round(n / 2), calls }); };
  requestAnimationFrame(f);
}));

if (LANG) await page.addInitScript(l => localStorage.setItem('pw.lang', l), LANG);
await page.goto('http://localhost:5199/');
await page.waitForTimeout(2500);
await shot('menu');
console.log('menu', await perf());

await page.evaluate(() => { __pw.app.test = true; __pw.select('gans'); __pw.startMatch(); __pw.game.autopilot = true; });
await page.waitForTimeout(9000);
await shot('match');
console.log('match', await perf());

await page.evaluate(() => {
  const p = __pw.game.player;
  p.pos.set(-6, 0, 14); p.vel.set(0, 0, 0); p.hp = p.maxHp;
  __pw.game.autopilot = false;
  __pw.cam.yaw = Math.PI; __pw.cam.pitch = 0.25;
});
await page.waitForTimeout(400);
await shot('pond');
console.log('pond', await perf());

await page.evaluate(() => { __pw.game.autopilot = true; __pw.game.skipToBoss(); });
await page.waitForTimeout(12000);
await shot('boss');
console.log('boss', await perf());

console.log(errors.length ? errors.slice(0, 10) : 'no console errors or warnings');
await browser.close();
process.exit(errors.length ? 1 : 0);
