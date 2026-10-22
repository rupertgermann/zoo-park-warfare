// Motion/moment probe: logs camera jumps per frame (respawn, boss intro end) and screenshots the boss intro,
// enrage, stun window, boss KO and defeat beats. Usage: node tools/moments.mjs [species] [--out .audit/shots/moments]
import { launch } from './chrome.mjs';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const sp = args[0] && !args[0].startsWith('--') ? args[0] : 'gans';
const oi = args.indexOf('--out');
const out = oi >= 0 ? args[oi + 1] : '.audit/shots/moments';
mkdirSync(out, { recursive: true });
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', e => errors.push(e.message));
const shot = n => page.screenshot({ path: `${out}/${sp}-${n}.png` });
await page.goto('http://localhost:5199');
await page.waitForFunction(() => window.__pw);
// per-frame camera tracker: biggest single-frame camera move and its phase
await page.evaluate(() => {
  const c = __pw.renderer.domElement; let prev = null; window.__jumps = [];
  const cam = () => __pw.game.player && __pw.cam.pos;
  const tick = () => {
    const g = __pw.game, p = __pw.app.mode === 'play' && cam();
    if (p) { const cp = __pw.camera?.position;
      const now = { x: __pw.cam.pos.x, y: __pw.cam.pos.y, z: __pw.cam.pos.z };
      if (prev) { const d = Math.hypot(now.x - prev.x, now.y - prev.y, now.z - prev.z); if (d > 1.2) __jumps.push({ d: +d.toFixed(1), phase: g.phase, alive: g.player.alive }); }
      prev = now; }
    requestAnimationFrame(tick);
  };
  tick();
});
await page.evaluate(id => { __pw.app.test = true; __pw.select(id); __pw.startMatch(); __pw.game.autopilot = true; }, sp);
// time to first contact: first damage dealt or taken by the player
const contact = await page.evaluate(() => new Promise(r => {
  const g = __pw.game; let t0 = null;
  const f = () => { if (g.phase === 'match' && t0 === null) t0 = performance.now();
    if (t0 !== null && (g.player.stats.dmg > 0 || g.player.hp < g.player.maxHp)) return r(((performance.now() - t0) / 1000).toFixed(1));
    if (t0 !== null && performance.now() - t0 > 30000) return r('>30'); requestAnimationFrame(f); };
  f();
}));
console.log('first contact after LOS (autopilot):', contact, 's');
// force a player death to watch the respawn camera
await page.evaluate(() => { const g = __pw.game; g.player.invulnT = 0; g.player.hp = 1; });
await page.waitForFunction(() => !__pw.game.player.alive || __pw.game.player.hp > 1, null, { timeout: 20000 }).catch(() => {});
await page.evaluate(() => { const g = __pw.game, p = g.player; if (p.alive) { p.hp = 0; p.alive = false; p.anim.dead = true; p.respawnT = 3; } });
await page.waitForTimeout(1200); await shot('1-dead');
await page.waitForFunction(() => __pw.game.player.alive, null, { timeout: 8000 });
await page.waitForTimeout(80); await shot('2-respawn');
console.log('jumps so far', JSON.stringify(await page.evaluate(() => __jumps.splice(0))));
await page.evaluate(() => __pw.game.skipToBoss());
for (const [ms, n] of [[300, '3-won'], [1200, '4-intro-a'], [1500, '4-intro-b'], [1500, '4-intro-c'], [1500, '5-fight']]) { await page.waitForTimeout(ms); await shot(n); }
console.log('jumps intro', JSON.stringify(await page.evaluate(() => __jumps.splice(0))));
await page.waitForFunction(() => __pw.game.bossAi.mode === 'stunned' && __pw.game.bossAi.divesLeft <= 0, null, { timeout: 40000 }).catch(() => console.log('no stun seen'));
await page.waitForTimeout(300); await shot('6-stunned');
await page.evaluate(() => { const b = __pw.game.boss; b.hp = b.maxHp * 0.5 + 1; });
await page.waitForFunction(() => __pw.game.bossAi.enraged, null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(200); await shot('7-enrage');
await page.evaluate(() => { __pw.game.boss.hp = 1; });
await page.waitForFunction(() => __pw.game.phase === 'over', null, { timeout: 30000 });
for (const [ms, n] of [[100, '8-ko-a'], [700, '8-ko-b'], [1200, '8-ko-c'], [1500, '8-ko-d'], [1500, '9-result']]) { await page.waitForTimeout(ms); await shot(n); }
console.log('jumps finale', JSON.stringify(await page.evaluate(() => __jumps.splice(0))));
// defeat path
await page.evaluate(() => { __pw.startMatch(); __pw.game.autopilot = true; });
await page.waitForFunction(() => __pw.game.phase === 'match');
await page.evaluate(() => __pw.game.skipToBoss());
await page.waitForFunction(() => __pw.game.phase === 'boss', null, { timeout: 10000 });
await page.evaluate(() => { __pw.game.lives = 1; });
await page.waitForFunction(() => { const g = __pw.game, p = g.player; if (p.alive) { p.hp = Math.min(p.hp, 1); p.invulnT = 0; } return g.phase === 'over'; }, null, { timeout: 60000, polling: 'raf' }).catch(() => console.log('player survived'));
for (const [ms, n] of [[300, 'a-lose-a'], [1200, 'a-lose-b'], [1500, 'a-lose-result']]) { await page.waitForTimeout(ms); await shot(n); }
console.log(errors.length ? 'CONSOLE: ' + [...new Set(errors)].join('\n') : 'no console errors');
await browser.close();
