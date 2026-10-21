// Boss dive dodge test. Usage: SP=schwan,nutria MODES=none,run,lock9 node tools/sim/dodge.mjs  (lockN emulates the ring freezing N s before the dive)
// Boss dive dodge test: player runs perpendicular at full speed from telegraph start (zero reaction time), or does not dodge.
import { chromium } from 'playwright-core';
import { homedir } from 'node:os';
const b = await chromium.launch({ executablePath: `${homedir()}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`, headless: true, args: ['--use-angle=metal'] });
const p = await b.newPage({ viewport: { width: 480, height: 300 } });
await p.routeWebSocket(/.*/, () => {});
await p.goto('http://localhost:5199'); await p.waitForFunction(() => window.__pw);
for (const sp of (process.env.SP || 'schwan,kaninchen,taube').split(',')) for (const mode of (process.env.MODES || 'none,run,runlate,dash').split(',')) {
  console.log(sp, mode, JSON.stringify(await p.evaluate(async ([sp, mode]) => {
    const { game: g, app } = __pw; app.test = true; __pw.select(sp); __pw.startMatch(); app.paused = true; g.autopilot = true;
    g.skipToBoss();
    const V = g.player.pos.constructor;
    const ctl = { wish: new V(), aim: new V(), jump: false, hold: false, primary: false, special: false };
    const res = { dives: 0, hits: 0, diveT: [], lockDist: [] };
    let last = null, hpBefore = 0, tDive = 0, runDir = null, t0 = 0;
    for (let i = 0; i < 60 * 240 && g.phase !== 'over'; i++) {
      const ai = g.bossAi, P = g.player;
      P.invulnT = 0; if (P.hp < 50) P.hp = P.maxHp; // keep the player alive to sample many dives
      const m = ai?.mode, onMe = ai?.target === P;
      if (m === 'telegraph' && last !== 'telegraph') { t0 = g.time; runDir = null; }
      const dodging = onMe && (m === 'telegraph' || m === 'dive') && mode !== 'none' && P.alive && !(mode.startsWith('lock') && m === 'telegraph' && ai.t > Number(mode.slice(4)) - 0.15);
      if (dodging) {
        if (mode === 'runlate' && m !== 'dive') { g.autopilot = false; ctl.wish.set(0, 0, 0); }
        else {
          if (!runDir) runDir = new V(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
          g.autopilot = false; ctl.wish.copy(runDir); ctl.aim.copy(P.pos).addScaledVector(runDir, 5);
          ctl.special = mode === 'dash' && m === 'dive' && last !== 'dive';
        }
      } else { g.autopilot = true; ctl.special = false; }
      if (g.boss) g.boss.hp = g.boss.maxHp;
      // emulated fix: the red ring stops following LOCK s before the dive
      const LOCK = mode.startsWith('lock') ? Number(mode.slice(4)) : 0;
      const saved = LOCK && m === 'telegraph' && ai.t <= LOCK ? ai.point.clone() : null;
      g.update(1 / 60, ctl);
      if (saved && (g.bossAi.mode === 'telegraph' || g.bossAi.mode === 'dive')) g.bossAi.point.copy(saved);
      const post = g.bossAi?.mode;
      if (m !== 'dive' && post === 'dive' && g.bossAi.target === P) { res.dives++; hpBefore = P.hp; tDive = g.time; res.lockDist.push(+Math.hypot(P.pos.x - g.bossAi.point.x, P.pos.z - g.bossAi.point.z).toFixed(1)); }
      if (m === 'dive' && post === 'stunned' && g.bossAi.target === P) { res.diveT.push(+(g.time - tDive).toFixed(2)); if (P.hp < hpBefore) res.hits++; }
      last = post;
      if (i % 600 === 0) await new Promise(r => setTimeout(r, 0));
    }
    g.autopilot = true; app.paused = false;
    const avg = a => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
    return { dives: res.dives, hitRate: (res.hits / res.dives).toFixed(2), diveTime: avg(res.diveT), lockDist: avg(res.lockDist) };
  }, [sp, mode])));
}
await b.close();
