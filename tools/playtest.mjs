// Headless playtest: drives the real game through menu -> match -> boss -> result, screenshots each phase,
// fails on console errors. Usage: node tools/playtest.mjs [species] [--url http://localhost:5199] [--out .audit/shots/play]
// Needs the dev server running (npm run dev).
import { launch } from './chrome.mjs';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const species = args[0] && !args[0].startsWith('--') ? args[0] : 'gans';
const url = opt('--url', 'http://localhost:5199');
const out = opt('--out', '.audit/shots/play');
const W = Number(opt('--w', 1440)), H = Number(opt('--h', 900));
mkdirSync(out, { recursive: true });

const browser = await launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

const shot = async name => { await page.screenshot({ path: `${out}/${species}-${name}.png` }); console.log('shot', `${out}/${species}-${name}.png`); };
const state = () => page.evaluate(() => {
  const g = __pw.game;
  return { phase: g.phase, scores: g.scores, hp: g.player?.hp, ko: g.player?.stats.ko, boss: g.boss && Math.round(g.boss.hp), lives: g.lives, calls: __pw.renderer.info.render.calls, tris: __pw.renderer.info.render.triangles };
});
const fps = async (ms = 2000) => page.evaluate(ms => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < ms ? requestAnimationFrame(f) : r(Math.round(n / (ms / 1000))); }; requestAnimationFrame(f); }), ms);

await page.goto(url);
await page.waitForFunction(() => window.__pw);
await page.waitForTimeout(800);
await page.evaluate(id => __pw.select(id), species);
await page.waitForTimeout(500);
await shot('1-menu');
console.log('menu fps', await fps());

await page.evaluate(() => { __pw.app.test = true; __pw.startMatch(); __pw.game.autopilot = true; });
await page.waitForTimeout(1500);
await shot('2-countdown');
await page.waitForTimeout(4000);
await shot('3-match');
console.log('match', await state(), 'fps', await fps());
await page.waitForTimeout(12000);
await shot('4-match-later');
console.log('match later', await state());

await page.evaluate(() => __pw.game.skipToBoss());
await page.waitForTimeout(2500);
await shot('5-boss-intro');
await page.waitForTimeout(6000);
await shot('6-boss');
console.log('boss', await state(), 'fps', await fps());
await page.waitForTimeout(15000);
await shot('7-boss-later');
console.log('boss later', await state());
await page.evaluate(() => { const b = __pw.game.boss; if (b?.alive) { b.hp = 1; } });
await page.waitForTimeout(6000);
await shot('8-result');
console.log('end', await state());

console.log(errors.length ? `CONSOLE PROBLEMS (${errors.length}):\n` + [...new Set(errors)].slice(0, 30).join('\n') : 'no console errors');
await browser.close();
process.exit(errors.some(e => !e.startsWith('warning')) ? 1 : 0);
