// node tools/playtest.mjs [species] [--url http://localhost:5199] [--out .audit/shots/play]
// node tools/playtest.mjs --ci [--url file:///path/to/build.html]
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { launch } from './chrome.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const smoke = args.includes('--ci');
const species = args[0] && !args[0].startsWith('--') ? args[0] : 'gans';
const url = opt('--url', smoke ? pathToFileURL('dist/zoo-park-warfare.html').href : 'http://localhost:5199');
const out = smoke ? null : opt('--out', '.audit/shots/play');
const W = Number(opt('--w', smoke ? 640 : 1440)), H = Number(opt('--h', smoke ? 480 : 900));
if (out) mkdirSync(out, { recursive: true });

const argsForBrowser = smoke && process.platform !== 'darwin' ? ['--use-gl=angle', '--use-angle=swiftshader'] : [];
const browser = await launch({ args: argsForBrowser });
const page = await browser.newPage({ viewport: { width: W, height: H }, reducedMotion: smoke ? 'reduce' : 'no-preference' });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));

const shot = async name => {
  if (!out) return;
  const path = `${out}/${species}-${name}.png`;
  await page.screenshot({ path });
  console.log('shot', path);
};
const state = () => page.evaluate(() => {
  const g = __pw.game;
  return { phase: g.phase, scores: g.scores, hp: g.player?.hp, ko: g.player?.stats.ko, boss: g.boss && Math.round(g.boss.hp), lives: g.lives, calls: __pw.renderer.info.render.calls, tris: __pw.renderer.info.render.triangles };
});
const fps = async (ms = 2000) => page.evaluate(ms => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < ms ? requestAnimationFrame(f) : r(Math.round(n / (ms / 1000))); }; requestAnimationFrame(f); }), ms);

async function waitForPhase(expected) {
  try {
    await page.waitForFunction(phase => __pw.game.phase === phase, expected, { timeout: 45_000 });
  } catch (error) {
    const actual = await page.evaluate(() => window.__pw?.game.phase).catch(() => undefined);
    throw new Error(`Expected phase ${expected}, found ${actual}`, { cause: error });
  }
  if (smoke) console.log(`PASS ${expected}`);
}

// Keep the real frame-driven transitions fast on software-rendered CI workers.
const shortenPhase = () => page.evaluate(() => { __pw.game.phaseT = Math.min(__pw.game.phaseT, 0.2); });

try {
  await page.goto(url);
  await page.waitForFunction(() => window.__pw);
  await page.locator('#menu').waitFor({ state: 'visible' });
  if (smoke) console.log('PASS menu');
  await page.evaluate(({ species, test }) => {
    __pw.select(species);
    __pw.app.test = test;
    __pw.game.autopilot = true;
  }, { species, test: !smoke });
  await shot('1-menu');
  if (out) console.log('menu fps', await fps());

  if (smoke) {
    await page.locator('#go').click();
    await page.waitForFunction(() => document.pointerLockElement?.id === 'view' && !__pw.app.paused, null, { timeout: 15_000 });
  } else await page.locator('#go').press('Enter');
  await waitForPhase('countdown');
  await page.locator('#banner.show.count').waitFor({ state: 'visible' });
  await shot('2-countdown');
  if (smoke) await shortenPhase();
  await waitForPhase('match');
  await shot('3-match');
  if (out) {
    console.log('match', await state(), 'fps', await fps());
    await page.waitForTimeout(12_000);
    await shot('4-match-later');
    console.log('match later', await state());
  }

  await page.evaluate(() => __pw.game.skipToBoss());
  await waitForPhase('bossIntro');
  if (smoke) await shortenPhase();
  else await page.waitForTimeout(2400);
  await shot('5-boss-intro');
  await waitForPhase('boss');
  await page.locator('#bossbar').waitFor({ state: 'visible' });
  await shot('6-boss');
  if (out) {
    console.log('boss', await state(), 'fps', await fps());
    await page.waitForTimeout(15_000);
    await shot('7-boss-later');
    console.log('boss later', await state());
    await page.evaluate(() => { if (__pw.game.boss?.alive) __pw.game.boss.hp = 1; });
  } else {
    await page.locator('#crownchip').waitFor({ state: 'visible' });
    // Let the normal collision and KO path reach a result on the next frame.
    await page.evaluate(() => {
      const fight = __pw.game;
      const { player, boss, bossAi } = fight;
      player.pos.set(-40, 0, 8);
      player.vel.set(0, 0, 0);
      player.hp = fight.lives = 1;
      player.invulnT = 0;
      boss.pos.copy(player.pos);
      bossAi.point.copy(player.pos);
      bossAi.mode = 'dive';
    });
  }
  await waitForPhase('over');
  if (smoke) await shortenPhase();
  await page.waitForFunction(() => __pw.game.phaseT <= 0, undefined, { timeout: 45_000 });
  assert.ok(await page.locator('#result').isVisible(), 'result dialog is visible after the round ends');
  assert.ok((await page.locator('#restitle').textContent())?.trim(), 'result has a title');
  await shot('8-result');
  console.log('PASS result', await state());

  if (smoke) {
    await page.locator('#again').click();
    await waitForPhase('countdown');
    await page.locator('#crownchip').waitFor({ state: 'hidden' });
    console.log('PASS crown badge resets on replay');
  }
  assert.deepEqual(errors.filter(error => !error.startsWith('warning')), [], 'console errors');
} finally {
  if (errors.length) console.log(`CONSOLE PROBLEMS (${errors.length}):\n${[...new Set(errors)].slice(0, 30).join('\n')}`);
  await browser.close();
}
