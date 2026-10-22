import { open } from './real.mjs';
const { b, p, errs } = await open(process.argv[2] || 'schwan');
await p.evaluate(() => { __pw.game.autopilot = true; __pw.game.skipToBoss(); });
await p.waitForFunction(() => __pw.game.phase === 'boss', null, { timeout: 30000 });
const D = '.audit/shots/combat';
let shots = 0, stun = false, circ = false;
for (let i = 0; i < 900 && shots < 3; i++) {
  const s = await p.evaluate(() => ({ m: __pw.game.bossAi.mode, onMe: __pw.game.bossAi.target === __pw.game.player, t: __pw.game.bossAi.t, ph: __pw.game.phase }));
  if (s.m === 'telegraph' && s.onMe && s.t < 0.6 && !shots) { await p.screenshot({ path: `${D}/boss-telegraph.png` }); shots++; }
  if (s.m === 'stunned' && !stun && shots) { await p.screenshot({ path: `${D}/boss-stunned.png` }); stun = true; shots++; }
  if (s.m === 'circle' && !circ && stun) { await p.waitForTimeout(1500); await p.screenshot({ path: `${D}/boss-circle.png` }); circ = true; shots++; }
  if (s.ph === 'over') break;
  await p.waitForTimeout(30);
}
console.log('shots', shots, errs);
await b.close();
