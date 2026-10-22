// Real-input "human" controller: aims by moving the mouse under pointer lock, moves with WASD, clicks to fire.
// node tools/sim/human.mjs <mode aim|duel> <species> <enemy> [dist=15] [lead=0] [secs=20] [rounds=5] [shot=name]
import { open } from './real.mjs';
const [mode = 'aim', sp = 'kraehe', en = 'elster', D = '15', LEAD = '0', SECS = '20', ROUNDS = '5', SHOT = ''] = process.argv.slice(2);
const { b, p, errs } = await open(sp);
await p.waitForTimeout(3400); if (process.env.STILL) await p.evaluate(() => window.__still = true);
const setup = () => p.evaluate(([en, D, mode]) => {
  const g = __pw.game;
  if (!g.teams.slice(1).some(t => t.id === en)) return false;
  const ti = g.teams.findIndex((t, i) => i > 0 && t.id === en);
  const P = g.player, Q = g.actors.find(a => a.team === ti);
  for (const a of g.actors) if (a !== P && a !== Q) { a.alive = false; a.respawnT = 1e9; a.model.root.visible = false; a.ring.visible = false; }
  for (const x of g.pickups) { x.respawnT = 1e9; x.mesh.visible = false; }
  P.alive = Q.alive = true; P.anim.dead = Q.anim.dead = false;
  P.hp = P.maxHp; Q.hp = Q.maxHp;
  P.pos.set(-48, 0, 0); Q.pos.set(-48 + Number(D), 0, 0);
  if (mode === 'aim') { Q.maxHp = Q.hp = 1e6; P.invulnT = 1e9; if (window.__still) Q.stunT = 1e9; }
  __pw.cam.yaw = Math.PI / 2; __pw.cam.pitch = 0.15;
  window.__q = Q; window.__st = { fires: 0, hits: 0, cdP: 0, dmg: P.stats.dmg, specials: 0, cdS: 0 };
  return true;
}, [en, D, mode]);
const ctl = () => p.evaluate(([lead]) => {
  const g = __pw.game, P = g.player, Q = window.__q, cam = __pw.cam, st = window.__st;
  if (P.cdP > st.cdP + 1e-6) { st.fires++; if (P.stats.dmg > st.dmg) st.mhit = (st.mhit || 0) + 1; }
  if (P.stats.dmg > st.dmg) st.hits++;
  if (P.cdS > st.cdS + 1e-6) st.specials++;
  st.cdP = P.cdP; st.dmg = P.stats.dmg; st.cdS = P.cdS;
  const flight = lead ? P.pos.distanceTo(Q.pos) / (P.spec.primary.speed || 30) : 0;
  const ax = Q.pos.x + Q.vel.x * flight, az = Q.pos.z + Q.vel.z * flight, ay = Q.pos.y + Q.model.height * 0.5;
  const dx = ax - cam.pos.x, dz = az - cam.pos.z, dy = ay - cam.pos.y;
  let dyaw = Math.atan2(dx, dz) - cam.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  const lookY = Math.max(P.pos.y, 0) + P.model.height * 0.9 + 0.5;
  const fwdAng = Math.atan2(lookY - Math.sin(cam.pitch) * 10 + 0.6 - cam.pos.y, 10);
  const wantAng = Math.atan2(dy, Math.hypot(dx, dz));
  return { dyaw, dpitch: fwdAng - wantAng, d: Math.hypot(Q.pos.x - P.pos.x, Q.pos.z - P.pos.z) - Q.radius, alive: P.alive && Q.alive, pa: P.alive, qa: Q.alive,
    php: P.hp, qhp: Math.round(Q.hp), st, range: P.spec.primary.range || 0, ranged: !P.spec.primary.range, srange: P.spec.special.radius || P.spec.special.range || P.spec.special.dist || 8 };
}, [Number(LEAD)]);
let vx = 640, vy = 360;
const results = [];
for (let r = 0; r < (mode === 'duel' ? Number(ROUNDS) : 1); r++) {
  let ok = await setup();
  for (let k = 0; !ok && k < 10; k++) { await p.evaluate(() => { __pw.startMatch(); }); await p.waitForTimeout(3400); ok = await setup(); }
  if (!ok) { console.log('enemy not in match'); break; }
  const t0 = Date.now(); let fire = false, strafe = 'KeyA', strafeT = 0, keys = new Set(), shotDone = false;
  const setKey = async (k, on) => { if (on && !keys.has(k)) { keys.add(k); await p.keyboard.down(k); } if (!on && keys.has(k)) { keys.delete(k); await p.keyboard.up(k); } };
  let s;
  while (Date.now() - t0 < Number(SECS) * 1000) {
    s = await ctl();
    if (!s.alive) break;
    const jit = () => (Math.random() - 0.5) * 6;
    vx += -s.dyaw / 0.0024 * 0.35 + jit(); vy += s.dpitch / 0.0022 * 0.35 + jit();
    await p.mouse.move(vx, vy);
    const aimed = Math.abs(s.dyaw) < 0.12;
    if (aimed !== fire) { fire = aimed; fire ? await p.mouse.down() : await p.mouse.up(); }
    if (mode === 'duel') {
      await setKey('KeyW', s.ranged ? s.d > 12 : s.d > s.range * 0.7);
      if (Date.now() > strafeT) { strafeT = Date.now() + 600 + Math.random() * 900; await setKey(strafe, false); strafe = strafe === 'KeyA' ? 'KeyD' : 'KeyA'; }
      await setKey(strafe, s.ranged || s.d < 4);
      if (s.d < s.srange * 0.9) { await p.keyboard.down('KeyE'); await p.waitForTimeout(60); await p.keyboard.up('KeyE'); }
    }
    if (SHOT && !shotDone && Date.now() - t0 > 2500) { shotDone = true; await p.screenshot({ path: `.audit/shots/combat/${SHOT}.png` }); }
  }
  for (const k of keys) await p.keyboard.up(k);
  if (fire) await p.mouse.up();
  results.push({ round: r, t: ((Date.now() - t0) / 1000).toFixed(1), win: s.qa ? (s.pa ? 'draw' : 'lose') : 'win', php: s.php, qhp: s.qhp, fires: s.st.fires, hits: s.st.hits, specials: s.st.specials, mhit: s.st.mhit || 0 });
  await p.waitForTimeout(500);
}
console.log(JSON.stringify({ mode, sp, en, D, LEAD }), '\n' + results.map(r => JSON.stringify(r)).join('\n'));
if (errs.length) console.log('ERR', errs);
await b.close();
