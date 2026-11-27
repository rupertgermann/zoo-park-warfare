// Run against the single-file build: node tools/check-audit-fixes.mjs [path-to-html]
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from './chrome.mjs';

const url = pathToFileURL(resolve(process.argv[2] || 'dist/zoo-park-warfare.html')).href;
const browser = await launch();

async function openPage(options = {}, init) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, reducedMotion: 'reduce', ...options });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (init) await page.addInitScript(init);
  await page.goto(url);
  await page.waitForFunction(() => window.__pw, null, { timeout: 20000 });
  return { page, errors };
}

try {
  {
    const { page, errors } = await openPage({}, () => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
    });
    assert.equal(await page.locator('input[name=diff]:checked').inputValue(), 'mittel');
    assert.equal(await page.evaluate(() => __pw.app.selected), 'gans');
    await page.locator('label:has(input[name=lang][value=en])').click();
    await page.locator('label:has(input[name=diff][value=leicht])').click();
    await page.locator('[data-id="schwan"]').click();
    assert.deepEqual(await page.evaluate(() => ({
      language: document.documentElement.lang,
      difficulty: __pw.game.diff.id,
      species: __pw.app.selected,
    })), { language: 'en', difficulty: 'leicht', species: 'schwan' });
    await page.locator('label:has(input[name=lang][value=de])').click();
    await page.locator('[data-id="mensch"]').click();
    await page.getByRole('radio', { name: 'Weiblich' }).click();
    assert.equal(await page.locator('#detail h2').textContent(), 'Parkbesucherin');
    await page.locator('#go').click();
    assert.equal(await page.evaluate(() => __pw.game.player.gender), 'f');
    assert.deepEqual(errors, []);
    await page.close();
    console.log('PASS blocked storage defaults and in-session preferences');
  }

  {
    const { page, errors } = await openPage({}, () => {
      const nativeLock = HTMLElement.prototype.requestPointerLock;
      window.restorePointerLock = () => { HTMLElement.prototype.requestPointerLock = nativeLock; };
      HTMLElement.prototype.requestPointerLock = function () {
        setTimeout(() => document.dispatchEvent(new Event('pointerlockerror')), 0);
      };
    });
    await page.locator('#go').click();
    await page.waitForFunction(() => __pw.app.paused && !document.querySelector('#pause').hidden);
    const frozen = await page.evaluate(async () => {
      const before = { phase: __pw.game.phase, time: __pw.game.time, countdown: __pw.game.phaseT };
      for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
      return { before, after: { phase: __pw.game.phase, time: __pw.game.time, countdown: __pw.game.phaseT } };
    });
    assert.equal(frozen.before.phase, 'countdown');
    assert.deepEqual(frozen.after, frozen.before);
    await page.evaluate(() => window.restorePointerLock());
    await page.locator('#resume').click();
    await page.waitForFunction(() => document.pointerLockElement && !__pw.app.paused);
    await page.waitForFunction(t => __pw.game.time > t, frozen.before.time);
    assert.deepEqual(errors, []);
    await page.close();
    console.log('PASS pointer-lock denial freezes countdown and retry resumes');
  }

  {
    const { page, errors } = await openPage();
    await page.locator('#go').click();
    await page.waitForFunction(() => document.pointerLockElement?.id === 'view' && __pw.game.time > 0);
    await page.evaluate(() => {
      const info = __pw.renderer.info;
      const reset = info.reset.bind(info);
      window.renders = 0;
      info.reset = () => { window.renders++; reset(); };
      document.exitPointerLock();
    });
    await page.locator('#pause').waitFor({ state: 'visible' });

    const sample = () => page.evaluate(async () => {
      for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
      const { game, renderer, camera } = __pw;
      const { width, height } = renderer.domElement;
      return { renders: window.renders, calls: renderer.info.render.calls, time: game.time, width, height, aspect: camera.aspect };
    });
    const paused = await sample();
    assert.deepEqual(await sample(), paused, 'a paused match submits no frames');

    await page.setViewportSize({ width: 1000, height: 700 });
    await page.waitForFunction(before => window.renders > before, paused.renders);
    const resized = await sample();
    assert.equal(resized.renders, paused.renders + 1, 'a paused resize draws one frame');
    assert.deepEqual([resized.width, resized.height, resized.aspect], [1000, 700, 1000 / 700]);
    assert.equal(resized.time, paused.time, 'redrawing leaves game time frozen');
    assert.ok(resized.calls > 0, 'the resized frame draws the scene');

    await page.locator('#resume').click();
    await page.waitForFunction(() => document.pointerLockElement?.id === 'view' && !__pw.app.paused);
    const resumed = await sample();
    assert.ok(resumed.renders > resized.renders + 1 && resumed.time > resized.time, 'resume restarts continuous rendering and the simulation');
    assert.deepEqual(errors, []);
    await page.close();
    console.log('PASS pause stops rendering, resize redraws once, and Resume restarts rendering');
  }

  {
    const { page, errors } = await openPage({ viewport: { width: 900, height: 500 } });
    await page.evaluate(() => document.querySelector('#view').addEventListener('gotpointercapture', () => { window.capturedDrag = true; }, { once: true }));
    await page.mouse.move(450, 250);
    await page.mouse.down();
    await page.mouse.move(480, 250);
    await page.mouse.up();
    assert.equal(await page.evaluate(() => window.capturedDrag), true, 'menu drag captures pointer');
    await page.mouse.wheel(0, 1200);
    await page.waitForFunction(() => document.querySelector('#menu').scrollTop > 0);
    await page.locator('[data-id="sittich"]').scrollIntoViewIfNeeded();
    const animal = page.locator('[data-id="sittich"]');
    const box = await animal.boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height <= 500, 'animal is visible after scrolling');
    assert.equal(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-id="sittich"]'), {
      x: box.x + box.width / 2, y: box.y + box.height / 2,
    }), true, 'animal receives pointer events');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    assert.equal(await page.evaluate(() => __pw.app.selected), 'sittich');
    const difficulty = page.locator('label:has(input[name=diff][value=leicht])');
    await difficulty.scrollIntoViewIfNeeded();
    const diffBox = await difficulty.boundingBox();
    assert.ok(diffBox);
    await page.mouse.click(diffBox.x + diffBox.width / 2, diffBox.y + diffBox.height / 2);
    assert.equal(await page.evaluate(() => __pw.game.diff.id), 'leicht');
    await page.locator('#go').scrollIntoViewIfNeeded();
    const go = await page.locator('#go').boundingBox();
    assert.ok(go && go.y >= 0 && go.y + go.height <= 500, 'start button is visible');
    assert.equal(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('#go'), {
      x: go.x + go.width / 2, y: go.y + go.height / 2,
    }), true, 'start button receives pointer events');
    await page.mouse.click(go.x + go.width / 2, go.y + go.height / 2);
    await page.waitForFunction(() => __pw.app.mode === 'play');
    assert.deepEqual(errors, []);
    await page.close();
    console.log('PASS 900x500 menu scrolling and mouse controls');
  }

  {
    const { page, errors } = await openPage();
    await page.locator('#go').click();
    await page.waitForFunction(() => document.pointerLockElement);
    await page.evaluate(() => {
      const { app, game } = __pw;
      app.paused = true;
      game.skipToBoss();
      game.autopilot = true;
      for (let i = 0; i < 500 && game.phase !== 'boss'; i++) game.update(1 / 60, null);
      game.autopilot = false;
      app.paused = false;
      document.exitPointerLock();
    });
    assert.equal(await page.evaluate(() => __pw.game.phase), 'boss');
    await page.waitForFunction(() => !document.querySelector('#pause').hidden);
    await page.locator('#quit').click();
    await page.evaluate(() => document.querySelector('#go').addEventListener('click', () => {
      __pw.app.paused = true;
      window.startDistances = __pw.game.actors.map(actor => {
        const spawn = __pw.game.spawns[actor.team];
        return Math.hypot(actor.pos.x - spawn.x, actor.pos.z - spawn.z);
      });
    }, { once: true }));
    await page.locator('#go').click();
    const spawns = await page.evaluate(() => window.startDistances);
    assert.equal(spawns.length, 15);
    for (const distance of spawns) assert.ok(Math.abs(distance - 2.2) < 0.001, `bad team spawn distance ${distance}`);
    console.log('PASS quit from boss and restart at team spawns');

    const combat = await page.evaluate(() => {
      const { game, app } = __pw;
      function prep(id) {
        __pw.toMenu();
        __pw.select(id);
        app.test = true;
        __pw.startMatch();
        app.paused = true;
        game.phase = 'match';
        game.shake = game.hitstop = 0;
        for (const actor of game.actors.slice(1)) { actor.alive = false; actor.respawnT = 1e6; }
        const player = game.player;
        return { player, ctl: { wish: player.pos.clone().set(0, 0, 0), aim: player.pos.clone(), jump: false, hold: false, primary: true, special: false } };
      }
      function lunge(start, end) {
        const { player, ctl } = prep('schwan');
        player.pos.set(start, 0, -15);
        ctl.aim.set(end, 0.8, -15);
        game.update(1 / 60, ctl);
        return player.pos.x;
      }
      function shot(start, targetX, height = 0) {
        const { player, ctl } = prep('sittich');
        player.pos.set(37, 0, -15);
        player.model.root.position.copy(player.pos);
        ctl.aim.set(targetX, 0.8, -15);
        game.update(0, ctl);
        const projectile = game.projectiles[0];
        if (!projectile) throw new Error('No projectile spawned');
        const target = game.actors.find(a => a.team === 1);
        target.alive = true;
        target.pos.set(targetX, height, -15);
        target.stunT = 5;
        target.invulnT = 0;
        projectile.pos.set(start, height + target.model.height * 0.5, -15);
        projectile.vel.set(40, 0, 0);
        const before = target.hp;
        ctl.primary = false;
        game.update(0.05, ctl);
        return { before, after: target.hp };
      }
      function nearestShot() {
        const { player, ctl } = prep('sittich');
        player.pos.set(30, 0, -15);
        ctl.aim.set(40, 1, -15);
        game.update(0, ctl);
        const projectile = game.projectiles[0];
        const far = game.actors.find(a => a.team === 1);
        const near = game.actors.find(a => a.team === 2);
        for (const [actor, x] of [[far, 38.4], [near, 37.5]]) {
          actor.alive = true;
          actor.pos.set(x, 1 - actor.model.height * 0.5, -15);
          actor.stunT = 5;
          actor.invulnT = 0;
        }
        projectile.pos.set(36, 1, -15);
        projectile.vel.set(60, 0, 0);
        const before = [near.hp, far.hp];
        ctl.primary = false;
        game.update(0.05, ctl);
        return { before, after: [near.hp, far.hp] };
      }
      return {
        blockedLunge: lunge(38, 44), openLunge: lunge(38, 34),
        blockedShot: shot(38.3, 40.3), openShot: shot(36.3, 38.3),
        aboveCover: shot(38.3, 40.3, 4), nearest: nearestShot(),
      };
    });
    assert.ok(combat.blockedLunge < 38.9, `lunge crossed obstacle: ${combat.blockedLunge}`);
    assert.ok(combat.openLunge < 37, `open lunge failed: ${combat.openLunge}`);
    assert.equal(combat.blockedShot.after, combat.blockedShot.before, 'shot hit through obstacle');
    assert.ok(combat.openShot.after < combat.openShot.before, 'open shot missed');
    assert.ok(combat.aboveCover.after < combat.aboveCover.before, 'shot above cover missed');
    assert.ok(combat.nearest.after[0] < combat.nearest.before[0], 'shot missed nearest actor');
    assert.equal(combat.nearest.after[1], combat.nearest.before[1], 'shot hit farther actor first');
    assert.deepEqual(errors, []);
    await page.close();
    console.log('PASS blocked and open melee lunges and shots');
  }

  {
    const { page, errors } = await openPage();
    const hits = await page.evaluateHandle(() => {
      const { app, game } = __pw;
      app.test = true;
      __pw.select('sittich');
      __pw.startMatch();
      game.phase = 'match';
      const [a, b] = game.actors.filter(actor => actor.team === 1);
      for (const actor of game.actors.slice(1)) {
        actor.alive = actor === a || actor === b;
        actor.respawnT = 100;
        actor.stunT = 100;
      }
      a.pos.set(-42, 0, 0);
      b.pos.set(-30, 0, 0);
      const player = game.player;
      player.pos.set(-48, 0, 0);
      player.model.root.position.copy(player.pos);
      const ctl = { wish: player.pos.clone().set(0, 0, 0), aim: a.pos.clone(), primary: false };
      function hit(target, amount) {
        ctl.primary = true;
        player.cdP = 0;
        game.update(0, ctl);
        const projectile = game.projectiles[0];
        projectile.pos.copy(game.center(target));
        projectile.dmg = amount;
        ctl.primary = false;
        game.update(0, ctl);
      }
      hit(a, 6);
      return { hit, a, b, first: document.querySelector('#plates .num') };
    });
    await page.waitForFunction(() => document.querySelector('#plates .num')?.style.opacity === '0');
    const labels = await hits.evaluate(({ hit, a, b, first }) => {
      __pw.app.paused = true;
      hit(b, 7);
      const reused = first.textContent === '7';
      hit(a, 11);
      hit(a, 13);
      return { reused, values: [...document.querySelectorAll('#plates .num')].map(n => Number(n.textContent)) };
    });
    assert.deepEqual(labels, { reused: true, values: [7, 24] }, 'reused damage labels must aggregate only on their current target');
    assert.deepEqual(errors, []);
    await page.close();
    console.log('PASS reused damage labels keep their targets and aggregate consecutive hits');
  }
} finally {
  await browser.close();
}
