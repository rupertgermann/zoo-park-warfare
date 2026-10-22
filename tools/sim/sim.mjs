// Headless balance harness: runs full autopilot matches (and boss fights) in the real game by stepping
// __pw.game.update(1/60) inside the page with the RAF loop paused, then prints per-species aggregates.
// Usage: node tools/sim/sim.mjs [--species all|gans,schwan] [--n 3] [--boss 2] [--duels 0] [--patch stats.json] [--code fix.json] [--realtime 0] [--cap 600] [--url http://localhost:5199] [--out .audit/sim]
//   --duels    1v1 round-robin, N per pair, on the open west path
//   --n        autopilot matches per player species (match phase only, ends at RULES.koToWin KOs or --cap seconds)
//   --boss     boss trials per species (fresh match + skipToBoss, ends on boss KO, 3 player deaths or --cap)
//   --realtime seconds of one real-time RAF sample to compare against the stepped clock (sanity check)
// Needs the dev server (npm run dev). Writes raw records to <out>/sim-<timestamp>.json.
import { launch } from '../chrome.mjs';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const url = opt('--url', 'http://localhost:5199');
const N = Number(opt('--n', 3)), NB = Number(opt('--boss', 2)), CAP = Number(opt('--cap', 600)), RT = Number(opt('--realtime', 0));
const out = opt('--out', '.audit/sim');
const ALL = ['gans', 'schwan', 'kormoran', 'nutria', 'kaninchen', 'taube', 'kraehe', 'elster', 'ente', 'mensch', 'nilgans', 'sittich'];
const sel = opt('--species', 'all');
const species = sel === 'all' ? ALL : sel.split(',');

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 480, height: 300 } });
const errors = [];
page.on('pageerror', e => errors.push(e.stack || e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
// --patch file.json: deep-merge stat overrides into the live species module before every run, to test a fix
// without editing src/. Shape: { "RULES": { "koToWin": 20 }, "BOSS": { "hp": 9000 }, "species": { "schwan": { "speed": 7, "primary": { "knock": 4 } } } }
const patchFile = opt('--patch', null);
const patch = patchFile ? JSON.parse(readFileSync(patchFile, 'utf8')) : null;
const applyPatch = () => patch && page.evaluate(async patch => {
  const m = await import('/src/species.js');
  const merge = (t, o) => { for (const [k, v] of Object.entries(o)) v && typeof v === 'object' && !Array.isArray(v) ? merge(t[k] ||= {}, v) : (t[k] = v); };
  if (patch.RULES) merge(m.RULES, patch.RULES);
  if (patch.BOSS) merge(m.BOSS, patch.BOSS);
  for (const [id, o] of Object.entries(patch.species || {})) merge(m.byId[id], o);
}, patch);
// Swallow Vite's HMR socket so concurrent src/ edits cannot full-reload the page mid-run.
await page.routeWebSocket(/.*/, () => {});
// --code fix.json: serve src modules with exact-once string replacements, to test a code fix without editing src/.
// Shape: [{ "file": "/src/game.js", "find": "...", "replace": "..." }]. A find that does not match exactly once aborts.
const codeFile = opt('--code', null);
if (codeFile) {
  const edits = JSON.parse(readFileSync(codeFile, 'utf8'));
  for (const file of new Set(edits.map(e => e.file))) {
    await page.route(u => new URL(u).pathname === file, async route => {
      const res = await route.fetch();
      let body = await res.text();
      for (const e of edits.filter(e => e.file === file)) {
        const n = body.split(e.find).length - 1;
        if (n !== 1) { console.error(`--code: ${file} find matched ${n}x: ${e.find.slice(0, 80)}`); process.exit(2); }
        body = body.replace(e.find, () => e.replace);
      }
      await route.fulfill({ response: res, body });
    });
  }
}
// --diff leicht|mittel|schwer (default schwer, the tuned baseline)
await page.addInitScript(d => localStorage.setItem('pw.diff', d), opt('--diff', 'schwer'));
await page.goto(url);
await page.waitForFunction(() => window.__pw);
await applyPatch();

// One in-page run. mode 'match' stops when the match phase ends; mode 'boss' skips to the boss and stops at 'over'.
const run = async (...a) => {
  // Vite full-reloads when src/ changes under us; wait for the app and retry the run.
  for (let k = 0; ; k++) {
    try { return await runOnce(...a); } catch (e) {
      if (k > 5 || !/context was destroyed|navigation|__pw/.test(e.message)) throw e;
      console.log('page reloaded, retrying run');
      await page.waitForFunction(() => window.__pw, null, { timeout: 30000 }); await page.waitForTimeout(500); await applyPatch();
    }
  }
};
const runOnce = (spec, mode, cap, opp) => page.evaluate(async ({ spec, mode, cap, opp }) => {
  const { game: g, app } = __pw;
  app.test = true;
  __pw.select(spec);
  __pw.startMatch();
  app.paused = true;
  g.autopilot = true;
  const DT = 1 / 60, ctl = null;
  const per = new Map(g.actors.map(a => [a, { anchor: a.pos.clone(), t: 0, air: 0, wet: 0, stun: 0, live: 0, cdP: 0, dmg: 0, fires: 0, hits: 0, melee: 0, mhits: 0 }]));
  const stuck = [];
  let pickups = 0;
  const pk = g.pickups.map(x => x.respawnT);
  const R = { spec, mode, teams: g.teams.map(s => s.id) };
  const T0 = g.time;
  let bossStart = null, bossBase = null, steps = 0, matchEnd = null;
  const startBoss = () => {
    bossStart = g.time;
    bossBase = { deaths: g.player.stats.deaths, dmg: new Map(g.actors.map(a => [a, a.stats.dmg])), stunned: 0, dives: 0, perch: 0, divePlayer: 0, lastMode: null, playerHits: 0 };
  };
  if (mode === 'boss') g.skipToBoss();
  let duel = null;
  if (mode === 'duel') {
    for (let k = 0; k < 40 && !g.teams.slice(1).some(t => t.id === opp); k++) __pw.startMatch();
    app.paused = true;
    while (g.phase === 'countdown') g.update(DT, ctl);
    const ti = g.teams.findIndex((t, i) => i > 0 && t.id === opp);
    const A = g.player, B = g.actors.find(a => a.team === ti);
    for (const a of g.actors) if (a !== A && a !== B) { a.alive = false; a.respawnT = 1e9; a.model.root.visible = false; }
    for (const p of g.pickups) p.respawnT = 1e9;
    A.pos.set(-48, 0, 0); B.pos.set(-26, 0, 0);
    A.invulnT = B.invulnT = 0;
    duel = { A, B, t0: g.time };
  }
  while (true) {
    g.update(DT, ctl);
    steps++;
    const fighting = g.phase === 'match' || g.phase === 'boss';
    if (fighting) for (const a of g.actors) {
      if (a.isBoss) continue;
      let s = per.get(a);
      if (!s) { s = { anchor: a.pos.clone(), t: 0, air: 0, wet: 0, stun: 0, live: 0, cdP: 0, dmg: 0, fires: 0, hits: 0, melee: 0, mhits: 0 }; per.set(a, s); }
      const fired = a.cdP > s.cdP + 1e-6, kind = a.spec.primary.kind;
      if (fired) s.fires++;
      if (a.stats.dmg > s.dmg) s.hits++;
      if (fired && (kind === 'melee' || kind === 'cone')) { s.melee++; if (a.stats.dmg > s.dmg) s.mhits++; }
      s.cdP = a.cdP; s.dmg = a.stats.dmg;
      if (!a.alive) { s.anchor.copy(a.pos); s.t = 0; continue; }
      s.live += DT;
      if (a.pos.y > 2) s.air += DT;
      if (a.inWater) s.wet += DT;
      if (a.stunT > 0) s.stun += DT;
      const w = a.ai.ctl?.wish;
      const wants = w && w.lengthSq() > 0.04 && a.stunT <= 0;
      if (!wants || a.pos.distanceTo(s.anchor) > 0.75) { s.anchor.copy(a.pos); if (s.t > 3) stuck.at(-1).dur = +s.t.toFixed(1); s.t = 0; continue; }
      s.t += DT;
      if (s.t >= 3 && s.t - DT < 3) stuck.push({ spec: a.spec.id, player: a.isPlayer, phase: g.phase, x: +a.pos.x.toFixed(1), z: +a.pos.z.toFixed(1), y: +a.pos.y.toFixed(1), water: a.inWater, dur: 3 });
    }
    if (duel && (!duel.A.alive || !duel.B.alive || g.time - duel.t0 > cap)) {
      return { spec, opp, winner: !duel.B.alive ? spec : !duel.A.alive ? opp : 'draw', t: +(g.time - duel.t0).toFixed(1),
        hpLeft: +((duel.A.alive ? duel.A.hp / duel.A.maxHp : duel.B.alive ? duel.B.hp / duel.B.maxHp : 0)).toFixed(2), paused: (app.paused = false) };
    }
    if (mode === 'match' && matchEnd === null && g.phase !== 'match' && g.phase !== 'countdown') { matchEnd = g.time; break; }
    g.pickups.forEach((x, i) => { if (x.respawnT > pk[i] + 1) pickups++; pk[i] = x.respawnT; });
    if (g.phase === 'boss' && bossStart === null) startBoss();
    if (bossBase && g.boss) {
      const m = g.bossAi.mode;
      if (m === 'stunned' && g.bossAi.divesLeft <= 0) bossBase.stunned += DT;
      if (m === 'perch') bossBase.perch += DT;
      if (m === 'dive' && bossBase.lastMode !== 'dive') { bossBase.dives++; if (g.bossAi.target?.isPlayer) bossBase.divePlayer++; }
      bossBase.lastMode = m;
    }
    if (g.phase === 'over') break;
    if (g.time > cap + 8 + (bossStart ?? T0)) { R.timeout = true; break; }
    if (steps % 600 === 0) await new Promise(r => setTimeout(r, 0));
  }
  R.matchTime = +((matchEnd ?? g.time) - T0 - 3.2).toFixed(1);
  R.scores = g.scores.slice();
  const best = Math.max(...g.scores);
  R.winner = g.teams[g.scores.indexOf(best)].id;
  R.playerTeamWon = g.crown === 0; // crown = the team that reached RULES.koToWin
  R.actors = g.actors.filter(a => !a.isBoss).map(a => {
    const s = per.get(a);
    return { spec: a.spec.id, player: a.isPlayer, team: a.team, ko: a.stats.ko, deaths: a.stats.deaths, dmg: a.stats.dmg,
      fires: s.fires, hits: s.hits, melee: s.melee, mhits: s.mhits, airFrac: s.live ? +(s.air / s.live).toFixed(3) : 0, wetFrac: s.live ? +(s.wet / s.live).toFixed(3) : 0, stunT: +s.stun.toFixed(1),
      bossDmg: bossBase ? a.stats.dmg - (bossBase.dmg.get(a) ?? 0) : 0 };
  });
  R.stuck = stuck;
  R.pickups = pickups;
  if (bossBase) {
    const b = g.boss;
    R.boss = { time: +(g.time - bossStart).toFixed(1), outcome: !b.alive ? 'win' : g.result ? 'lose' : 'timeout', bossHpLeft: Math.max(0, Math.round(b.hp)), bossMax: b.maxHp,
      playerDeaths: g.player.stats.deaths - bossBase.deaths, bossDmgDealt: b.stats.dmg, stunnedT: +bossBase.stunned.toFixed(1), perchT: +bossBase.perch.toFixed(1),
      dives: bossBase.dives, divesAtPlayer: bossBase.divePlayer,
      playerBossDmg: g.player.stats.dmg - bossBase.dmg.get(g.player) };
  }
  app.paused = false;
  return R;
}, { spec, mode, cap, opp });

const fmt = (n, d = 1) => Number.isFinite(n) ? n.toFixed(d) : '-';
const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const records = [];

if (RT > 0) {
  // Real-time sanity sample: same autopilot, RAF-driven, compare KOs per game-minute to the stepped runs.
  const r = await page.evaluate(async secs => {
    const { game: g, app } = __pw;
    app.test = true; __pw.select('kraehe'); __pw.startMatch(); g.autopilot = true; app.paused = false;
    const t0 = performance.now(), g0 = g.time;
    app.paused = false;
    await new Promise(r => setTimeout(r, secs * 1000));
    const kos = g.scores.reduce((a, b) => a + b, 0);
    return { wall: (performance.now() - t0) / 1000, game: g.time - g0, kos, phase: g.phase };
  }, RT);
  const s = await run('kraehe', 'match', r.game);
  const kosS = s.scores.reduce((a, b) => a + b, 0);
  console.log(`realtime: ${fmt(r.game)}s game in ${fmt(r.wall)}s wall, ${r.kos} KOs (${fmt(r.kos / (r.game - 3.2) * 60)}/min) | stepped: ${s.matchTime}s, ${kosS} KOs (${fmt(kosS / s.matchTime * 60)}/min)`);
}

const ND = Number(opt('--duels', 0));
if (ND > 0) {
  // Round-robin 1v1 on the open west path (22 m apart, no pickups). Row = species A, value = A's win% vs column.
  const win = {}, ttk = [];
  for (const a of species) for (const b of ALL) {
    if (a === b || (win[b]?.[a] !== undefined)) continue;
    let w = 0, n = 0;
    for (let i = 0; i < ND; i++) {
      const r = await run(a, 'duel', 60, b);
      records.push({ mode: 'duel', ...r });
      if (r.winner === a) w++; if (r.winner !== 'draw') { n++; ttk.push(r.t); }
    }
    (win[a] ||= {})[b] = n ? w / n : NaN; (win[b] ||= {})[a] = n ? 1 - w / n : NaN;
  }
  console.log('\nDUELS (row win% vs column, ' + ND + ' per pair):');
  console.log('           ' + ALL.map(s => s.slice(0, 5).padStart(6)).join('') + '   avg');
  for (const a of ALL) {
    if (!win[a]) continue;
    const vals = ALL.map(b => win[a][b]);
    console.log(a.padEnd(11) + vals.map(v => (v === undefined ? '' : fmt(100 * v, 0)).padStart(6)).join('') + fmt(100 * avg(vals.filter(Number.isFinite)), 0).padStart(6));
  }
  console.log(`duel time-to-kill avg ${fmt(avg(ttk))}s (from 22 m apart)`);
}

for (const sp of species) {
  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    const r = await run(sp, 'match', CAP);
    records.push(r);
    console.log(`match ${sp} #${i + 1}: ${r.matchTime}s winner=${r.winner}${r.playerTeamWon ? ' (player)' : ''} scores=${r.scores.join('/')} stuck=${r.stuck.length} (${((Date.now() - t0) / 1000).toFixed(1)}s wall)`);
  }
  for (let i = 0; i < NB; i++) {
    const t0 = Date.now();
    const r = await run(sp, 'boss', CAP);
    records.push(r);
    const b = r.boss;
    console.log(`boss  ${sp} #${i + 1}: ${b?.outcome} ${b?.time}s hpLeft=${b?.bossHpLeft} playerDeaths=${b?.playerDeaths} playerDmg=${b?.playerBossDmg} (${((Date.now() - t0) / 1000).toFixed(1)}s wall)`);
  }
}

mkdirSync(out, { recursive: true });
const file = `${out}/sim-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(file, JSON.stringify(records, null, 1));

const matches = records.filter(r => r.mode === 'match');
if (matches.length) {
  console.log(`\nMATCHES: ${matches.length}, length avg ${fmt(avg(matches.map(r => r.matchTime)))}s (min ${fmt(Math.min(...matches.map(r => r.matchTime)))}, max ${fmt(Math.max(...matches.map(r => r.matchTime)))}), timeouts ${matches.filter(r => r.timeout).length}, pickups/match ${fmt(avg(matches.map(r => r.pickups)))}, player-team wins ${matches.filter(r => r.playerTeamWon).length}, player time dead ${fmt(100 * avg(matches.map(r => r.actors.find(a => a.player).deaths * 3 / r.matchTime)), 0)}%`);
  console.log('species     games  win%  KO/bot  death/bot  dmg/bot  KO/D   air%  wet%  stunT/bot  stuck/game  meleeHit%');
  for (const sp of ALL) {
    const games = matches.filter(r => r.teams.includes(sp));
    if (!games.length) continue;
    const as = games.flatMap(r => r.actors.filter(a => a.spec === sp));
    const st = games.flatMap(r => r.stuck.filter(s => s.spec === sp));
    const ko = avg(as.map(a => a.ko)), de = avg(as.map(a => a.deaths));
    console.log(`${sp.padEnd(11)} ${String(games.length).padStart(5)} ${fmt(100 * games.filter(r => r.winner === sp).length / games.length, 0).padStart(5)} ${fmt(ko).padStart(7)} ${fmt(de).padStart(10)} ${fmt(avg(as.map(a => a.dmg)), 0).padStart(8)} ${fmt(ko / de, 2).padStart(6)} ${fmt(100 * avg(as.map(a => a.airFrac))).padStart(6)} ${fmt(100 * avg(as.map(a => a.wetFrac))).padStart(5)} ${fmt(avg(as.map(a => a.stunT))).padStart(10)} ${fmt(st.length / games.length, 2).padStart(11)} ${fmt(100 * as.reduce((s, a) => s + a.mhits, 0) / as.reduce((s, a) => s + a.melee, 0), 0).padStart(9)}`);
  }
  const stuck = matches.flatMap(r => r.stuck);
  const cells = {};
  for (const s of stuck) { const k = `${Math.round(s.x / 4) * 4},${Math.round(s.z / 4) * 4}`; cells[k] = (cells[k] || 0) + 1; }
  console.log('stuck hotspots (4m cells):', Object.entries(cells).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k}:${n}`).join('  '));
}
const bosses = records.filter(r => r.boss);
if (bosses.length) {
  console.log(`\nBOSS: ${bosses.length} fights`);
  console.log('species     fights win%  time   hpLeft%  pDeaths  pDmg  botDmg  stunnedT  dives(atP)  bossStuck');
  for (const sp of ALL) {
    const bs = bosses.filter(r => r.spec === sp);
    if (!bs.length) continue;
    const b = bs.map(r => r.boss);
    const botDmg = avg(bs.map(r => r.actors.filter(a => !a.player).reduce((s, a) => s + a.bossDmg, 0)));
    console.log(`${sp.padEnd(11)} ${String(bs.length).padStart(6)} ${fmt(100 * b.filter(x => x.outcome === 'win').length / b.length, 0).padStart(4)} ${fmt(avg(b.map(x => x.time)), 0).padStart(6)} ${fmt(100 * avg(b.map(x => x.bossHpLeft / x.bossMax)), 0).padStart(8)} ${fmt(avg(b.map(x => x.playerDeaths))).padStart(8)} ${fmt(avg(b.map(x => x.playerBossDmg)), 0).padStart(5)} ${fmt(botDmg, 0).padStart(7)} ${fmt(avg(b.map(x => x.stunnedT))).padStart(9)} ${fmt(avg(b.map(x => x.dives))).padStart(6)}(${fmt(avg(b.map(x => x.divesAtPlayer)))}) ${fmt(avg(bs.map(r => r.stuck.filter(s => s.phase === 'boss').length)), 1).padStart(10)}`);
  }
}
console.log(`\nraw: ${file}`);
if (errors.length) console.log('PAGE ERRORS:', [...new Set(errors)].slice(0, 10).join('\n'));
await browser.close();
