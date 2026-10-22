// Plays one autopilot match through the boss and checks that game events reach their listeners:
// the phases arrive in order, combat events fire, the HUD, chat and sounds react.
// node tools/events.mjs [species]   (needs npm run dev)
import assert from 'node:assert/strict';
import { launch } from './chrome.mjs';

const species = process.argv[2] ?? 'gans';
const TYPES = ['phase', 'countdown', 'damage', 'ko', 'attack', 'special', 'specialReady', 'noTarget', 'jump', 'splash', 'pickup', 'respawn',
  'explode', 'summonHit', 'bossEnraged', 'bossVolley', 'bossTarget', 'bossDive', 'bossLand'];

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', e => errors.push(e.message));

await page.goto('http://localhost:5199');
await page.waitForFunction(() => window.__pw);
await page.evaluate(({ species, TYPES }) => {
  const audio = __pw.audio;
  const rec = window.__rec = { seen: {}, phases: [], sfx: {}, music: [] };
  const sfx = audio.sfx, music = audio.music;
  audio.sfx = (name, o) => { rec.sfx[name] = (rec.sfx[name] ?? 0) + 1; return sfx.call(audio, name, o); };
  audio.music = name => { rec.music.push(name); return music.call(audio, name); };
  for (const t of TYPES) __pw.game.on(t, e => { rec.seen[t] = (rec.seen[t] ?? 0) + 1; if (t === 'phase') rec.phases.push(e); });
  __pw.select(species);
  __pw.app.test = true;
  __pw.startMatch();
  __pw.game.autopilot = true;
}, { species, TYPES });

await page.waitForTimeout(18000);
const match = await page.evaluate(() => ({
  feed: document.querySelectorAll('#feed .kill').length,
  scores: document.querySelectorAll('#scores .sc').length,
  chat: document.querySelectorAll('#chat .msg').length,
}));
await page.evaluate(() => __pw.game.skipToBoss());
await page.waitForTimeout(22000);
const boss = await page.evaluate(() => ({ bar: !document.querySelector('#bossbar').hidden }));
await page.evaluate(() => { const b = __pw.game.boss; if (b?.alive) b.hp = 1; });
await page.waitForFunction(() => __pw.game.phase === 'over', null, { timeout: 30000 });
await page.waitForTimeout(500);
const rec = await page.evaluate(() => window.__rec);
await browser.close();

console.log('events', rec.seen);
console.log('sfx', rec.sfx);
console.log('music', rec.music.join(' > '));
console.log('dom', match, boss);

assert.deepEqual(rec.phases, ['countdown', 'match', 'won', 'bossIntro', 'boss', 'over'], 'phases in order');
for (const t of ['countdown', 'damage', 'ko', 'attack', 'special', 'jump', 'bossVolley', 'bossTarget', 'bossDive', 'bossLand'])
  assert(rec.seen[t] > 0, `event ${t} fired`);
for (const s of ['countdown', 'go', 'hit', 'ko', 'jump', 'screech', 'bossDive', 'bossIntro', 'boom'])
  assert(rec.sfx[s] > 0, `sound ${s} played`);
assert(rec.sfx.win || rec.sfx.lose, 'a win or lose sting played');
assert.deepEqual(rec.music, ['match', null, 'boss', null], 'music follows the phases');
assert(match.feed > 0 && match.scores === 5 && match.chat > 0, 'killfeed, scores and chat show up in the match');
assert(boss.bar, 'boss bar shows in the boss phase');
assert.deepEqual(errors, [], 'no console errors');
console.log('events ok');
