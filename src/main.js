import * as THREE from 'three';
import { SPECIES, byId, DIFFICULTY } from './species.js';
import { L, setLang } from './i18n.js';
import { buildCreature } from './models.js';
import { buildPark } from './park.js';
import { audio } from './audio.js';
import { input } from './input.js';
import { createFx } from './fx.js';
import { createUI } from './ui.js';
import { createGame } from './game.js';
import { createPost } from './post.js';

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, powerPreference: 'high-performance' });
renderer.info.autoReset = false; // post-processing renders several passes per frame
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
const FOV = 65;
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const park = buildPark(scene);
const fx = createFx(scene);
const ui = createUI(document.getElementById('ui'));
const game = createGame({ scene, park, fx, ui });
const post = createPost(renderer, scene, camera);

// ---------- portraits ----------
(function makePortraits() {
  const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  r.setSize(160, 160);
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const s = new THREE.Scene();
  s.add(new THREE.HemisphereLight(0xffffff, 0x88aa66, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(2, 4, 5);
  s.add(sun);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  for (const sp of SPECIES) {
    const c = buildCreature(sp.id);
    c.update(0.016, { t: 0 });
    c.root.rotation.y = 0.55;
    s.add(c.root);
    const box = new THREE.Box3().setFromObject(c.root), size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
    const half = Math.max(size.y, size.x * 0.8) * 0.62;
    cam.position.set(mid.x, mid.y + half * 0.25, mid.z + half / Math.tan(THREE.MathUtils.degToRad(15)));
    cam.lookAt(mid);
    r.render(s, cam);
    ui.portraits[sp.id] = r.domElement.toDataURL();
    s.remove(c.root);
  }
  r.dispose();
  r.forceContextLoss();
})();
ui.buildGrid();

// ---------- app state ----------
const app = { mode: 'menu', paused: false, resultShown: false, selected: localStorage.getItem('pw.species') || 'gans' };
if (!byId[app.selected]) app.selected = 'gans';
const cam = { yaw: 0, pitch: 0.18, pos: new THREE.Vector3() };

// Menu showcase: the selected creature on a little lawn spot by the pond, camera orbiting slowly.
const showcase = { root: new THREE.Group(), model: null, spin: 0.4, drag: null, t: 0 };
scene.add(showcase.root);
// Menu stage: a clear lawn spot on the pond's shore, camera looking back over the water.
const SHOW = (() => {
  for (let i = 0; i < 24; i++) {
    const ang = Math.PI / 2 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.13;
    let r = 1;
    while (park.isWater(Math.cos(ang) * r, Math.sin(ang) * r) || r < 6) r += 0.5;
    const x = Math.cos(ang) * (r + 3), z = Math.sin(ang) * (r + 3);
    if (!park.blocked(x, z, 0, 2) && !park.blocked(x + Math.cos(ang) * 5, z + Math.sin(ang) * 5, 0, 1)) return { pos: new THREE.Vector3(x, 0, z), ang };
  }
  return { pos: new THREE.Vector3(0, 0, 20), ang: Math.PI / 2 };
})();

function setShowcase(id) {
  if (showcase.model) showcase.root.remove(showcase.model.root);
  showcase.model = buildCreature(id);
  showcase.model.setTeamColor(0xffd23f);
  showcase.root.add(showcase.model.root);
  showcase.root.position.copy(SHOW.pos);
  showcase.t = 0;
}

function select(id) {
  if (id === app.selected && showcase.model) return;
  app.selected = id;
  localStorage.setItem('pw.species', id);
  ui.setSelected(id);
  setShowcase(id);
  audio.sfx('uiMove');
  audio.sfx(byId[id].voice, { vol: 0.6, pitch: byId[id].pitch });
  showcase.model.update(0, { attack: 1 });
  showcase.pop = 1;
}

function toMenu() {
  app.mode = 'menu';
  app.paused = false;
  game.clear();
  document.exitPointerLock?.();
  ui.hideHud();
  showcase.root.visible = true;
  setShowcase(app.selected);
  ui.showMenu(app.selected, { select, start: startMatch });
  audio.music('menu');
}

function startMatch() {
  audio.unlock();
  audio.sfx('ui');
  showcase.root.visible = false;
  app.mode = 'play';
  app.paused = false;
  ui.showPause(false);
  app.resultShown = false;
  input.pressed.clear();
  game.start(app.selected);
  cam.yaw = game.player.yaw;
  cam.pitch = 0.2;
  camTarget(cam.pos);
  lock();
}

function lock() {
  if (input.locked) return setPaused(false);
  try {
    const r = canvas.requestPointerLock?.({ unadjustedMovement: true });
    r?.catch?.(() => { if (!input.locked && !app.test) setPaused(true, L.noLock); });
  } catch { setPaused(true); }
}

function setPaused(on, note = '') {
  if (app.mode !== 'play' || game.phase === 'over') return;
  app.paused = on;
  ui.showPause(on, { resume: lock, quit: toMenu }, note);
}

// Pointer lock is the source of truth: losing it pauses, regaining it resumes.
document.addEventListener('pointerlockchange', () => {
  if (app.mode !== 'play') return;
  if (input.locked) { if (app.paused) setPaused(false); }
  else if (!app.paused && game.phase !== 'over' && !app.test) setPaused(true);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && !app.test) setPaused(true); });
canvas.addEventListener('click', () => { if (app.mode === 'play' && !input.locked && !app.paused) lock(); });

addEventListener('keydown', e => {
  if (e.repeat && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight' && e.code !== 'ArrowUp' && e.code !== 'ArrowDown') return;
  audio.unlock();
  if (e.code === 'KeyM') ui.setMuted(audio.toggleMute(), true);
  if (app.mode === 'menu') {
    const i = SPECIES.findIndex(s => s.id === app.selected);
    const cols = 2;
    const move = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.code];
    if (move !== undefined && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      const n = (i + move + SPECIES.length) % SPECIES.length;
      select(SPECIES[n].id);
      document.querySelector(`[data-id="${SPECIES[n].id}"]`)?.focus({ preventScroll: true });
    }
    if (e.code === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); startMatch(); }
  } else if (app.mode === 'play') {
    if (game.phase === 'over' && app.resultShown) {
      const ready = !ui.el('again').disabled;
      if (ready && e.code === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); startMatch(); }
      if (ready && (e.code === 'Escape' || e.code === 'Backspace')) toMenu();
    }
  }
});

// Drag to spin the menu creature.
canvas.addEventListener('pointerdown', e => { if (app.mode === 'menu') { showcase.drag = e.clientX; canvas.setPointerCapture(e.pointerId); } });
canvas.addEventListener('pointermove', e => {
  if (app.mode !== 'menu' || showcase.drag === null) return;
  showcase.root.rotation.y += (e.clientX - showcase.drag) * 0.012;
  showcase.drag = e.clientX;
  showcase.spin = 0;
});
canvas.addEventListener('pointerup', () => { showcase.drag = null; setTimeout(() => { if (showcase.drag === null) showcase.spin = 0.4; }, 2500); });

const diffEl = ui.el('diff');
const setDiff = id => { game.diff = DIFFICULTY.find(d => d.id === id) || DIFFICULTY[1]; diffEl.querySelector(`[value="${game.diff.id}"]`).checked = true; };
setDiff(localStorage.getItem('pw.diff'));
diffEl.onchange = e => { setDiff(e.target.value); localStorage.setItem('pw.diff', e.target.value); audio.sfx('uiMove'); };
ui.el('lang').onchange = e => { setLang(e.target.value); ui.setLanguage(); audio.sfx('uiMove'); };

const volEl = ui.el('vol'), sensEl = ui.el('sens');
volEl.value = audio.getVolume();
volEl.oninput = () => audio.setVolume(Number(volEl.value));
sensEl.value = input.sensitivity;
sensEl.oninput = () => { input.sensitivity = Number(sensEl.value); localStorage.setItem('pw.sens', sensEl.value); };
ui.el('mute').onclick = () => { audio.unlock(); ui.setMuted(audio.toggleMute()); };
ui.setMuted(audio.isMuted());

// ---------- player control ----------
const ctl = { wish: new THREE.Vector3(), aim: new THREE.Vector3(), jump: false, hold: false, primary: false, special: false };
const ray = new THREE.Ray(), tmp = new THREE.Vector3(), fwd = new THREE.Vector3();

function readPlayer() {
  const k = c => input.down(c);
  const f = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
  const r = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
  const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
  ctl.wish.set(sy * f - cy * r, 0, cy * f + sy * r);
  if (ctl.wish.lengthSq() > 1) ctl.wish.normalize();
  const tap = c => input.pressed.has(c);
  ctl.jump = tap('Space');
  ctl.hold = k('Space');
  ctl.primary = input.locked && (input.mouse.left || tap('Mouse0'));
  ctl.special = (input.locked && tap('Mouse2')) || tap('KeyE') || tap('KeyQ');
  input.pressed.clear();
  // aim: camera ray; snap to a hostile near the crosshair, else first ground hit
  camera.getWorldDirection(fwd);
  ray.set(camera.position, fwd);
  const p = game.player;
  const skip = camera.position.distanceTo(p.pos) + 0.5;
  let best = null, bestT = 90;
  for (const a of game.actors) {
    if (!a.alive || !game.hostile(p, a)) continue;
    const c = game.center(a, tmp);
    const t = ray.closestPointToPoint(c, new THREE.Vector3()).distanceTo(camera.position);
    if (t < skip || t > bestT) continue;
    const miss = ray.distanceToPoint(c);
    if (miss < a.radius + 0.35 + t * 0.012) {
      bestT = t;
      // lead moving targets, but only partly so tracking still takes some skill
      const lead = p.spec.primary.speed ? 0.7 * Math.min(1, a.pos.distanceTo(p.pos) / p.spec.primary.speed) : 0;
      best = c.clone().addScaledVector(a.vel.clone().setY(0), lead);
    }
  }
  if (best) ctl.aim.copy(best);
  else {
    const t = fwd.y < -0.01 ? (camera.position.y - 0) / -fwd.y : 80;
    ctl.aim.copy(camera.position).addScaledVector(fwd, Math.min(Math.max(t, skip + 2), 80));
  }
}

function camTarget(out) {
  const p = game.player, s = p.spec;
  const h = p.model.height;
  const dist = 2.8 + s.size * 3.2;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const back = tmp.set(Math.sin(cam.yaw) * cp, 0, Math.cos(cam.yaw) * cp);
  const right = { x: -Math.cos(cam.yaw), z: Math.sin(cam.yaw) };
  out.set(
    p.pos.x - back.x * dist + right.x * 0.7,
    Math.max(p.pos.y, 0) + h * 0.9 + 0.5 + sp * dist,
    p.pos.z - back.z * dist + right.z * 0.7,
  );
  out.y = Math.max(out.y, 0.4);
  return out;
}
const camGoal = new THREE.Vector3();
// Pull the camera toward the player when a tree, kiosk or wall sits between them.
function occlude(goal) {
  const p = game.player, h = Math.max(p.pos.y, 0) + p.model.height * 0.8;
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const x = p.pos.x + (goal.x - p.pos.x) * k, z = p.pos.z + (goal.z - p.pos.z) * k, y = h + (goal.y - h) * k;
    const hit = park.blocked(x, z, y, 0.3)
      || park.canopies.some(c => y > c.y0 && y < c.y1 && Math.hypot(x - c.x, z - c.z) < c.r);
    if (hit) {
      const full = Math.hypot(goal.x - p.pos.x, goal.z - p.pos.z);
      const kk = Math.max(Math.min(1, 1.8 / Math.max(full, 0.01)), (i - 1) / steps);
      goal.set(p.pos.x + (goal.x - p.pos.x) * kk, h + (goal.y - h) * kk + 0.4 + (1 - kk) * 1.6, p.pos.z + (goal.z - p.pos.z) * kk);
      return;
    }
  }
}

function updateCamera(dt) {
  const p = game.player;
  if (input.locked && !app.paused) {
    const d = input.consumeLook();
    cam.yaw -= d.dx * 0.0024 * input.sensitivity;
    cam.pitch = THREE.MathUtils.clamp(cam.pitch + d.dy * 0.0022 * input.sensitivity, -0.45, 1.1);
  }
  const finale = game.phase === 'over' && game.result?.won;
  if ((game.phase === 'bossIntro' || finale) && game.boss) {
    const b = game.boss.pos;
    const shot = finale ? tmp.set(b.x + (p.pos.x - b.x) * 0.5, 4, b.z + (p.pos.z - b.z) * 0.5 + 9) : tmp.set(0, 5, 18);
    camera.position.lerp(shot, Math.min(1, dt * (finale ? 1.5 : 2.5)));
    camera.lookAt(b.x, b.y + 2, b.z);
    // telephoto on the intro so the far-off kingfisher fills the frame instead of being a dot
    camera.fov = finale ? FOV : THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(9 / camera.position.distanceTo(b))), 22, FOV);
    camera.updateProjectionMatrix();
    cam.pos.copy(camera.position);
    // the fight starts facing the boss
    cam.yaw = Math.atan2(b.x - p.pos.x, b.z - p.pos.z);
    cam.pitch = 0.2;
    return;
  }
  resetFov();
  if (game.autopilot) cam.yaw += Math.atan2(Math.sin(p.yaw - cam.yaw), Math.cos(p.yaw - cam.yaw)) * Math.min(1, dt * 3);
  camTarget(camGoal);
  occlude(camGoal);
  // cut instead of swooping across the park after a respawn or the boss intro
  if (cam.pos.distanceTo(camGoal) > 8) cam.pos.copy(camGoal);
  cam.pos.lerp(camGoal, Math.min(1, dt * 18));
  camera.position.copy(cam.pos);
  const lookY = Math.max(p.pos.y, 0) + p.model.height * 0.9 + 0.5;
  tmp.set(cam.pos.x + Math.sin(cam.yaw) * 10, lookY - Math.sin(cam.pitch) * 10 + 0.6, cam.pos.z + Math.cos(cam.yaw) * 10);
  camera.lookAt(tmp);
  if (game.shake > 0 && !reduceMotion) {
    camera.position.x += (Math.random() - 0.5) * game.shake;
    camera.position.y += (Math.random() - 0.5) * game.shake;
  }
}

function resetFov() { if (camera.fov !== FOV) { camera.fov = FOV; camera.updateProjectionMatrix(); } }

function updateMenuCamera(dt, t) {
  resetFov();
  if (!reduceMotion) showcase.root.rotation.y += showcase.spin * dt;
  showcase.t += dt;
  showcase.pop = Math.max(0, (showcase.pop || 0) - dt * 3);
  showcase.model?.update(dt, { t: showcase.t, attack: showcase.pop });
  const h = showcase.model?.height || 1;
  const d = 1.1 + h * 1.9;
  const a = SHOW.ang + (reduceMotion ? 0 : Math.sin(t * 0.15) * 0.08);
  camera.position.set(SHOW.pos.x + Math.cos(a) * d, h * 0.62 + 0.3, SHOW.pos.z + Math.sin(a) * d);
  camera.lookAt(SHOW.pos.x, h * 0.62, SHOW.pos.z);
}

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  park.update(dt, t);
  if (app.mode === 'menu') {
    updateMenuCamera(dt, t);
  } else if (!app.paused) {
    readPlayer();
    game.update(dt, ctl);
    updateCamera(dt);
    const p = game.player;
    audio.setListener(p.pos.x, p.pos.z, cam.yaw);
    if (game.phase === 'over' && game.phaseT <= 0 && !app.resultShown) {
      app.resultShown = true;
      document.exitPointerLock?.();
      ui.showResult({ again: startMatch, change: toMenu });
    }
  }
  fx.update(app.paused ? 0 : dt, camera.position);
  ui.update(app.paused ? 0 : dt, camera);
  renderer.info.reset();
  post.render();
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  post.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
toMenu();
requestAnimationFrame(frame);
addEventListener('pointerdown', () => audio.unlock(), { once: true });

// test hook for automated playtests
window.__pw = { game, app, startMatch, toMenu, select, cam, renderer };
