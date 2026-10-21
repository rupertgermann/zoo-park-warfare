import { open } from './real.mjs';
const [sp = 'taube', en = 'schwan', SECS = 15] = process.argv.slice(2);
const { b, p, errs } = await open(sp);
await p.waitForTimeout(3400);
const ok = await p.evaluate(en => {
  const g = __pw.game; const ti = g.teams.findIndex((t, i) => i > 0 && t.id === en); if (ti < 0) return false;
  const P = g.player, Q = g.actors.find(a => a.team === ti);
  for (const a of g.actors) if (a !== P && a !== Q) { a.alive = false; a.respawnT = 1e9; }
  for (const x of g.pickups) { x.respawnT = 1e9; x.mesh.visible = false; }
  P.pos.set(-40, 0, 0); Q.pos.set(-34, 0, 0); __pw.cam.yaw = Math.PI / 2; __pw.cam.pitch = 0.5; window.__Q = Q;
  window.__ys = []; return true;
}, en);
if (!ok) { console.log('enemy not in match, rerun'); process.exit(); }
let vx = 640, vy = 360; const t0 = Date.now(); let fire = false, n = 0, shot = false;
while (Date.now() - t0 < SECS * 1000) {
  const s = await p.evaluate(() => {
    const g = __pw.game, P = g.player, Q = __Q, cam = __pw.cam; __ys.push(P.pos.y);
    const dx = Q.pos.x - cam.pos.x, dz = Q.pos.z - cam.pos.z, dy = Q.pos.y + 0.5 - cam.pos.y;
    let dyaw = Math.atan2(dx, dz) - cam.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const lookY = Math.max(P.pos.y, 0) + P.model.height * 0.9 + 0.5;
    const fwdAng = Math.atan2(lookY - Math.sin(cam.pitch) * 10 + 0.6 - cam.pos.y, 10);
    return { dyaw, dpitch: fwdAng - Math.atan2(dy, Math.hypot(dx, dz)), alive: P.alive && Q.alive, y: P.pos.y };
  });
  if (!s.alive) break;
  vx += -s.dyaw / 0.0024 * 0.35; vy += s.dpitch / 0.0022 * 0.35; await p.mouse.move(vx, vy);
  if (!fire) { fire = true; await p.mouse.down(); }
  if (n++ % 10 === 0) { await p.keyboard.down('Space'); await p.waitForTimeout(70); await p.keyboard.up('Space'); }
  if (!shot && Date.now() - t0 > 6000) { shot = true; await p.screenshot({ path: `/Users/rupertgermann/AI/games/zoo-park-wars/.audit/shots/combat/fly-${sp}-vs-${en}.png` }); }
}
await p.mouse.up();
console.log(await p.evaluate(() => { const ys = __ys, P = __pw.game.player; return { maxY: Math.max(...ys).toFixed(1), meanY: (ys.reduce((a, b) => a + b, 0) / ys.length).toFixed(1), fracAbove3: (ys.filter(y => y > 3).length / ys.length).toFixed(2), playerHp: P.hp + '/' + P.maxHp, alive: P.alive, enemyHp: __Q.hp + '/' + __Q.maxHp, enemyDeaths: __Q.stats.deaths, killer: __Q.lastHitBy?.name, killerSpec: __Q.lastHitBy?.spec.id, feed: document.getElementById('feed')?.innerText, playerDmgDealt: P.stats.dmg }; }), errs);
await b.close();
