// Usage: PW_DIR=<dir containing node_modules/playwright> node tools/audio-test.js [url]
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const { chromium } = createRequire((process.env.PW_DIR || process.cwd()) + '/')('playwright');
const url = process.argv[2] || 'http://localhost:5203/tools/audio.html';
const CONTRACT = ('honk hiss croak squeak coo caw chatter quack human screech ' +
  'hit hurt ko pickup jump flap splash throw swing boom dash stun summon steal ui uiMove countdown go win lose bossIntro bossDive').split(' ');

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction('window.__ready');

const names = await page.evaluate('window.__names');
for (const n of CONTRACT) assert(names.includes(n), `contract name missing: ${n}`);

assert.equal(typeof (await page.evaluate('window.__preUnlock()')), 'number', 'pre-unlock calls are safe');

const row = (n, r) => console.log(n.padEnd(10), 'rms', r.rms.toFixed(4), 'peak', r.peak.toFixed(3));
const soft = [];
for (const n of CONTRACT) {
  const r = await page.evaluate(([k, x]) => window.__render(k, x), ['sfx', n]);
  row(n, r);
  if (!(r.peak > 0.08)) soft.push(`${n} is silent/quiet (peak ${r.peak})`);
  if (r.bad || r.peak > 1.5) soft.push(`${n} invalid or clipping (bad ${r.bad}, peak ${r.peak})`);
}
assert.deepEqual(soft, [], 'sfx render problems');
for (const m of ['menu', 'match', 'boss']) {
  const r = await page.evaluate(([k, x]) => window.__render(k, x), ['music', m]);
  row('music:' + m, r);
  assert(r.rms > 0.003 && r.bad === 0, `music ${m} silent or invalid`);
}

const L = await page.evaluate(() => window.__render('sfx', 'honk', { x: 10, z: 0 }));
assert(L.rmsL > L.rmsR * 1.5, 'source at +x is left of a yaw-0 listener');
const R = await page.evaluate(() => window.__render('sfx', 'honk', { x: -10, z: 0 }));
assert(R.rmsR > R.rmsL * 1.5, 'source at -x is right of a yaw-0 listener');
const far = await page.evaluate(() => window.__render('sfx', 'boom', { x: 70, z: 0 }));
assert.equal(far.rms, 0, 'inaudible beyond 60 m');

// Real page: click every button, then confirm live output on the master bus.
for (const sel of ['[data-sfx]', '[data-sfx2]']) {
  for (const b of await page.locator(sel).all()) {
    const name = await b.textContent();
    await b.click();
    const lvl = await page.evaluate(() => window.__liveLevel(500));
    if (sel === '[data-sfx]') assert(lvl > 0.001, `live: ${name} silent (${lvl})`);
    await page.waitForTimeout(40);
  }
}
for (const b of await page.locator('[data-music]').all()) {
  const name = await b.textContent();
  await b.click();
  const lvl = await page.evaluate(() => window.__liveLevel(1500));
  if (name !== 'null') assert(lvl > 0.0005, `live: music ${name} silent (${lvl})`);
  else {
    await page.waitForTimeout(2500);
    assert((await page.evaluate(() => window.__liveLevel(300))) < 0.0005, 'music(null) stops');
  }
}

await page.locator('#vol').fill('0.3');
await page.click('#mute');
const saved = await page.evaluate(() => [localStorage.getItem('pw.volume'), localStorage.getItem('pw.muted')]);
assert.deepEqual(saved, ['0.3', 'true'], 'volume and mute persisted');
await page.reload();
await page.waitForFunction('window.__ready');
assert.equal(await page.evaluate('window.__audio.getVolume()'), 0.3, 'volume restored');

assert.deepEqual(errors, [], 'console errors: ' + errors.join('\n'));
await browser.close();
console.log('OK');
