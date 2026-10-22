// Special-ability readability lever: for each species, stage the player 5 m from one rival, fire the special,
// and screenshot the moment from the player's camera. Then let a rival fire its special at the player.
// Usage: node tools/specials.mjs [species...] [--out .audit/shots/specials]
import { launch } from './chrome.mjs';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const oi = args.indexOf('--out');
const out = oi >= 0 ? args[oi + 1] : '.audit/shots/specials';
const ids = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out');
mkdirSync(out, { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:5199');
await page.waitForFunction(() => window.__pw);
const all = await page.evaluate(() => [...document.querySelectorAll('[data-id]')].map(b => b.dataset.id));

// Park everyone except the player and one rival far away; put the rival 5 m in front of the camera.
const stage = () => page.evaluate(() => {
  const g = __pw.game, p = g.player, cam = __pw.cam;
  const rival = g.actors.find(a => a.team !== 0 && !a.isBoss);
  p.pos.set(0, 0, 22); p.vel.set(0, 0, 0); p.yaw = Math.PI; cam.yaw = Math.PI; cam.pitch = 0.15;
  for (const a of g.actors) if (a !== p && a !== rival && !a.isBoss) { a.pos.set(50, 0, -38); a.stunT = 99; }
  rival.pos.set(0.6, 0, 17); rival.vel.set(0, 0, 0); rival.hp = rival.maxHp; rival.invulnT = 0;
  p.hp = p.maxHp; p.cdS = 0; p.invulnT = 0;
  return rival.spec.id;
});

for (const id of ids.length ? ids : all) {
  await page.evaluate(id => { __pw.app.test = true; __pw.select(id); __pw.startMatch(); }, id);
  await page.waitForFunction(() => __pw.game.phase === 'match', null, { timeout: 8000 });
  await page.waitForTimeout(1500);
  const rival = await stage();
  await page.waitForTimeout(150);
  await page.keyboard.press('KeyE');
  for (const ms of [120, 450, 1100]) {
    await page.waitForTimeout(ms === 120 ? 120 : ms - (ms === 450 ? 120 : 450));
    await page.screenshot({ path: `${out}/${id}-mine-${ms}.png` });
  }
  // rival's turn: freeze the player, let the rival fire its special at us
  const fired = await page.evaluate(async () => {
    const g = __pw.game, p = g.player;
    const r = g.actors.find(a => a.team !== 0 && !a.isBoss);
    r.pos.set(0.6, 0, 17); r.cdS = 0; r.stunT = 0; p.hp = p.maxHp; p.invulnT = 0;
    for (let i = 0; i < 150; i++) {
      await new Promise(f => requestAnimationFrame(f));
      if (r.cdS > 0) return true;
      r.cdS = 0; r.pos.set(0.6, 0, 17);
    }
    return false;
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/${id}-vs-${rival}.png` });
  console.log(id, 'rival', rival, 'fired', fired);
}
console.log(errors.length ? 'CONSOLE: ' + [...new Set(errors)].join('\n') : 'no console errors');
await browser.close();
