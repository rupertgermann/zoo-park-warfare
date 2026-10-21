import { open } from './real.mjs';
const ALL = (process.argv[2] || 'gans,schwan,kormoran,nutria,kaninchen,taube,kraehe,elster,ente,mensch').split(',');
const DIST = { dash: 7, aoe: 3, dive: 5, summon: 10, lifesteal: 8, stun: 5, bomb: 12 };
for (const sp of ALL) {
  const { b, p, errs } = await open(sp);
  await p.waitForTimeout(3400);
  const info = await p.evaluate(DIST => {
    const g = __pw.game, P = g.player, Q = g.actors.find(a => a.team === 1);
    for (const a of g.actors) if (a !== P && a !== Q) { a.alive = false; a.respawnT = 1e9; }
    for (const x of g.pickups) { x.respawnT = 1e9; x.mesh.visible = false; }
    const d = DIST[P.spec.special.kind];
    P.pos.set(-48, 0, 0); Q.pos.set(-48 + d, 0, 0); Q.stunT = 0.0; Q.maxHp = Q.hp = 1000;
    P.vel.set(0, 0, 0); Q.vel.set(0, 0, 0);
    __pw.cam.yaw = Math.PI / 2; __pw.cam.pitch = 0.2;
    // freeze the target's AI so the special is judged on its own
    Q.ai.thinkT = 1e9; Q.ai.target = null; Q.ai.react = 1e9;
    window.__Q = Q;
    return { kind: P.spec.special.kind, enemy: Q.spec.id, d };
  }, DIST);
  await p.waitForTimeout(600);
  const before = await p.evaluate(() => ({ qhp: __Q.hp, php: __pw.game.player.hp, px: __pw.game.player.pos.x }));
  await p.keyboard.down('KeyE'); await p.waitForTimeout(90); await p.keyboard.up('KeyE');
  await p.waitForTimeout(30);
  await p.screenshot({ path: `/Users/rupertgermann/AI/games/zoo-park-wars/.audit/shots/combat/special-${sp}-a.png` });
  await p.waitForTimeout(350);
  await p.screenshot({ path: `/Users/rupertgermann/AI/games/zoo-park-wars/.audit/shots/combat/special-${sp}-b.png` });
  await p.waitForTimeout(2500);
  const after = await p.evaluate(() => ({ qhp: __Q.hp, php: __pw.game.player.hp, px: __pw.game.player.pos.x, cdS: __pw.game.player.cdS, qstun: __Q.stunT, qvel: Math.hypot(__Q.vel.x, __Q.vel.z), qpos: __Q.pos.x }));
  console.log(sp, info.kind, `vs ${info.enemy} @${info.d}m: enemy dmg ${before.qhp - after.qhp}, self hp ${before.php}->${after.php}, moved ${(after.px - before.px).toFixed(1)}m, cd left ${after.cdS.toFixed(1)}`, errs.length ? errs : '');
  await b.close();
}
