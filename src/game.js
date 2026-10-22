import * as THREE from 'three';
import { SPECIES, BOSS, byId, TEAM_COLORS, RULES, DIFFICULTY } from './species.js';
import { L, text } from './i18n.js';
import { buildCreature, buildProp } from './models.js';
import { audio } from './audio.js';

const GRAVITY = 22;
const MAX_FLY = 7.5;
const DASH_SPEED = 30;
const CROWN_BONUS = 1.3; // the phase-1 winner hits the boss harder
const BOSS_SCALE = 1.35;
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[(Math.random() * arr.length) | 0];
const shuffle = arr => arr.map(x => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

const ringGeo = new THREE.RingGeometry(0.75, 1, 32).rotateX(-Math.PI / 2);

export function createGame({ scene, park, fx, ui }) {
  // what happened in the match; ui, chat and sounds listen, the rules don't know who
  const listeners = {};
  const emit = (type, e) => listeners[type]?.forEach(fn => fn(e));
  const g = {
    on: (type, fn) => (listeners[type] ||= []).push(fn),
    phase: 'idle', phaseT: 0, actors: [], player: null, boss: null,
    projectiles: [], summons: [], pickups: [], scores: [], teams: [],
    lives: 0, shake: 0, result: null, time: 0, hitstop: 0, slow: 0.15,
  };
  const pool = {};
  let lastCount = 0; // last countdown number shown
  ui.bind(g);

  // ---------- setup ----------
  function clear() {
    for (const a of g.actors) { scene.remove(a.model.root); scene.remove(a.ring); }
    for (const p of g.projectiles) release(p.mesh, p.model);
    for (const s of g.summons) release(s.mesh, s.model);
    for (const p of g.pickups) scene.remove(p.mesh);
    Object.assign(g, { actors: [], projectiles: [], summons: [], pickups: [], player: null, boss: null, result: null });
    fx.clear();
  }

  function makeActor(spec, team, name, isPlayer = false) {
    const model = buildCreature(spec.id);
    const isBoss = spec === BOSS;
    if (!isBoss) model.setTeamColor(TEAM_COLORS[team]);
    scene.add(model.root);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: isBoss ? 0x000000 : TEAM_COLORS[team], transparent: true, opacity: isPlayer ? 0.95 : 0.6, depthWrite: false,
    }));
    ring.scale.setScalar(isBoss ? 2.6 : spec.size * 1.25);
    scene.add(ring);
    const a = {
      spec, team, name, isPlayer, isBoss, model, ring,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, aimYaw: 0, faceT: 0,
      hp: spec.hp, maxHp: spec.hp, alive: true, respawnT: 0,
      cdP: 0, cdS: 0, rageT: 0, stunT: 0, invulnT: 0, knockT: 0, dashT: 0, dashV: new THREE.Vector3(), dashHit: new Set(), diveT: 0,
      onGround: true, inWater: false, radius: isBoss ? 3.1 : 0.35 + spec.size * 0.55,
      anim: { move: 0, air: false, swim: false, attack: 0, hurt: 0, stun: false, special: 0, dead: false, t: Math.random() * 10 },
      ai: {
        thinkT: 0, target: null, goal: null, strafe: 1, strafeT: 0, stuckT: 0, lastPos: new THREE.Vector3(), wander: null, wanderT: 0, react: rand(0.25, 0.6),
        ctl: { wish: new THREE.Vector3(), aim: new THREE.Vector3(), jump: false, hold: false, primary: false, special: false },
      },
      stats: { ko: 0, deaths: 0, dmg: 0 }, lastHitBy: null,
    };
    g.actors.push(a);
    return a;
  }

  function start(speciesId) {
    clear();
    const mine = byId[speciesId];
    const rivals = shuffle(SPECIES.filter(s => s !== mine)).slice(0, RULES.teams - 1);
    g.teams = [mine, ...rivals];
    g.scores = g.teams.map(() => 0);
    g.spawns = shuffle(park.teamSpawns.slice()).slice(0, RULES.teams);
    g.teams.forEach((spec, team) => {
      const names = shuffle(text(spec).names.slice());
      for (let i = 0; i < RULES.perTeam; i++) {
        const isPlayer = team === 0 && i === 0;
        const a = makeActor(spec, team, isPlayer ? 'Du' : names[i % names.length], isPlayer);
        placeAtSpawn(a, i);
        if (isPlayer) g.player = a;
      }
    });
    g.lives = g.diff.lives;
    for (const s of park.pickupSpots) {
      const mesh = new THREE.Group();
      const snack = buildProp('bread');
      snack.scale.setScalar(1.6);
      mesh.add(snack);
      const glow = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x9dff6a, transparent: true, opacity: 0.7, depthWrite: false }));
      glow.scale.setScalar(0.8);
      glow.position.y = -0.55;
      mesh.add(glow);
      mesh.position.set(s.x, 0.6, s.z);
      scene.add(mesh);
      g.pickups.push({ x: s.x, z: s.z, mesh, respawnT: 0 });
    }
    g.crown = -1;
    lastCount = 0;
    setPhase('countdown', 3);
    ui.matchStart();
  }

  function placeAtSpawn(a, i = Math.random() * 3) {
    if (g.phase === 'boss') {
      for (let k = 0; k < 12; k++) {
        const ang = Math.random() * Math.PI * 2;
        a.pos.set(Math.cos(ang) * 26, 0, Math.sin(ang) * 22);
        if (!park.blocked(a.pos.x, a.pos.z, 0.5, a.radius + 0.3) && !park.isWater(a.pos.x, a.pos.z)) break;
      }
    } else {
      const s = g.spawns[a.team];
      const ang = i * 2.1 + Math.random();
      a.pos.set(s.x + Math.cos(ang) * 2.2, 0, s.z + Math.sin(ang) * 2.2);
    }
    a.vel.set(0, 0, 0);
    a.yaw = Math.atan2(-a.pos.x, -a.pos.z);
    a.aimYaw = a.yaw;
  }

  function setPhase(p, t = 0) {
    g.phase = p;
    g.phaseT = t;
    ui.phase(p);
    emit('phase', p);
  }

  const hostile = (a, b) => a !== b && (g.phase === 'boss' ? a.isBoss !== b.isBoss : a.team !== b.team);
  const center = (a, out = v1) => out.set(a.pos.x, a.pos.y + a.model.height * 0.5, a.pos.z);
  // bots fighting against the player; allies and the player keep full stats
  const rival = a => !a.isPlayer && a.team !== g.player.team;
  const near = (a, d = 18) => a.isPlayer || a.pos.distanceTo(g.player.pos) < d;
  const fighting = () => g.phase === 'match' || g.phase === 'boss';

  // ---------- pools ----------
  function acquire(model) {
    const m = (pool[model] ||= []).pop() || buildProp(model);
    scene.add(m);
    return m;
  }
  function release(mesh, model) {
    scene.remove(mesh);
    pool[model].push(mesh);
  }

  // ---------- combat ----------
  function damage(t, amount, src, dir, knock = 0, stun = 0) {
    if (!t.alive || t.invulnT > 0 || !fighting()) return;
    if (t.isBoss && !src.isPlayer) amount *= 0.15;
    if (t.isBoss && src.team === g.crown) amount *= CROWN_BONUS;
    if (t.isBoss && g.bossAi.mode === 'stunned') amount *= 1.5;
    if (t.isPlayer) amount *= g.diff.dmg;
    amount = Math.round(amount);
    t.hp -= amount;
    t.anim.hurt = 1;
    t.lastHitBy = src;
    src.stats.dmg += amount;
    if (!t.isBoss && dir && knock) {
      t.vel.x += dir.x * knock;
      t.vel.z += dir.z * knock;
      if (knock >= 6) { t.vel.y = Math.max(t.vel.y, knock * 0.3); t.knockT = 0.3; }
    }
    if (stun && !t.isBoss) t.stunT = Math.max(t.stunT, stun);
    if (src.isPlayer) ui.hitmarker(t, amount, t.hp <= 0);
    if (t.isPlayer) { ui.hurt(src, stun > 0 && src.spec.special?.kind === 'stun'); g.shake = Math.max(g.shake, 0.25); }
    if (src.isPlayer || t.isPlayer || near(t, 25)) audio.sfx(t.isPlayer ? 'hurt' : 'hit', { x: t.pos.x, z: t.pos.z, vol: src.isPlayer || t.isPlayer ? 1 : 0.5 });
    if (t.hp <= 0) ko(t, src);
  }

  function heal(a, n) {
    a.hp = Math.min(a.maxHp, a.hp + n);
  }

  function ko(t, src) {
    t.alive = false;
    t.hp = 0;
    t.anim.dead = true;
    t.respawnT = RULES.respawn;
    t.stats.deaths++;
    fx.burst(center(t), [t.spec.accent, 0xffffff, t.spec.accent, t.spec.color], t.isBoss ? 110 : 26, { speed: t.isBoss ? 16 : 7, up: 8, life: t.isBoss ? 2.2 : 1.4, size: t.isBoss ? 2.4 : 0.9 });
    audio.sfx('ko', { x: t.pos.x, z: t.pos.z });
    if (src !== t) src.stats.ko++;
    if (src.isPlayer) g.hitstop = 0.07;
    ui.killfeed(src, t);
    if (t.isBoss) return finish(true);
    if (g.phase === 'match' && src !== t) {
      g.scores[src.team]++;
      ui.scores();
      if (g.scores[src.team] >= RULES.koToWin) {
        g.hitstop = 0.6;
        g.slow = 0.3;
        winPhase1(src.team, 3);
        audio.sfx(src.team === g.player.team ? 'win' : 'lose');
      }
    }
    emit('ko', { src, t });
    if (t.isPlayer) {
      if (g.phase === 'boss') {
        g.lives--;
        ui.lives(g.lives);
        if (g.lives <= 0) return finish(false, L.tooFast);
      }
      ui.died(src, t.respawnT);
    }
  }

  function finish(won, reason) {
    g.result = { won, reason, crown: g.crown === g.player.team, stats: { ...g.player.stats } };
    setPhase('over', won ? 3.6 : 2.4);
    if (won) { g.hitstop = 1; g.slow = 0.3; }
    audio.sfx(won ? 'win' : 'lose');
    audio.music(null);
  }

  function hitArc(a, range, arc, dmg, knock, stun = 0) {
    let hit = 0;
    for (const t of g.actors) {
      if (!t.alive || !hostile(a, t)) continue;
      const dx = t.pos.x - a.pos.x, dz = t.pos.z - a.pos.z, dy = (t.pos.y - a.pos.y);
      const d = Math.hypot(dx, dz) - t.radius;
      if (d > range || Math.abs(dy) > (t.isBoss ? 7 : 2.5)) continue;
      if (arc < Math.PI && Math.abs(angleDiff(Math.atan2(dx, dz), a.aimYaw)) > arc) continue;
      const n = v2.set(dx, 0, dz).normalize();
      damage(t, dmg, a, n, knock, stun);
      hit++;
    }
    return hit;
  }

  function spawnProjectile(a, o) {
    const mesh = acquire(o.model);
    mesh.scale.setScalar(o.scale ?? 1);
    mesh.position.copy(o.pos);
    g.projectiles.push({ owner: a, mesh, model: o.model, pos: mesh.position, vel: o.vel, dmg: o.dmg, splash: o.splash || 0,
      gravity: o.gravity ?? 3, life: o.life ?? 2.5, r: o.r ?? 0.35, knock: o.knock ?? 3, spin: o.spin ?? 0 });
  }

  // Velocity that lands at `to` from `from` with roughly `speed`; lobs arc higher when close.
  function ballistic(from, to, speed, grav) {
    const dx = to.x - from.x, dz = to.z - from.z, dy = to.y - from.y;
    const d = Math.hypot(dx, dz);
    const T = THREE.MathUtils.clamp(d / speed, 0.35, 1.6);
    return new THREE.Vector3(dx / T, (dy + 0.5 * grav * T * T) / T, dz / T);
  }

  function muzzle(a) {
    return a.model.muzzle.getWorldPosition(new THREE.Vector3());
  }

  function voice(a, vol) {
    audio.sfx(a.spec.voice, { x: a.pos.x, z: a.pos.z, vol, pitch: a.spec.pitch });
  }

  function primary(a, aim) {
    const p = a.spec.primary;
    const dmg = p.dmg * (a.rageT > 0 ? a.spec.special.mult : 1);
    if (a.cdP > 0 || a.diveT > 0) return;
    a.cdP = p.rate * (rival(a) ? g.diff.rate : 1);
    a.anim.attack = 1;
    a.faceT = 0.45;
    a.aimYaw = Math.atan2(aim.x - a.pos.x, aim.z - a.pos.z);
    const loud = a.isPlayer || Math.random() < 0.3;
    if (loud && (p.kind === 'cone' || Math.random() < 0.35)) voice(a, a.isPlayer ? 0.8 : 0.5);
    if (p.kind === 'shot') {
      const from = muzzle(a);
      const vel = v1.copy(aim).sub(from).normalize().multiplyScalar(p.speed).clone();
      vel.y += 1.2;
      spawnProjectile(a, { model: p.model, pos: from, vel, dmg, gravity: 2.5, spin: p.spin || 0 });
      if (near(a)) audio.sfx('throw', { x: a.pos.x, z: a.pos.z, vol: a.isPlayer ? 0.6 : 0.3 });
    } else if (p.kind === 'lob') {
      const from = muzzle(a);
      spawnProjectile(a, { model: p.model, pos: from, vel: ballistic(from, aim, p.speed, 18), dmg, gravity: 18, splash: p.splash, life: 3 });
      if (near(a)) audio.sfx('throw', { x: a.pos.x, z: a.pos.z, vol: 0.4 });
    } else {
      if (p.lunge) { const dx = aim.x - a.pos.x, dz = aim.z - a.pos.z, d = Math.hypot(dx, dz), step = Math.min(p.lunge, Math.max(0, d - p.range * 0.5)); if (d > 0.01) { a.pos.x += dx / d * step; a.pos.z += dz / d * step; } }
      if (hitArc(a, p.range, p.arc, dmg, p.knock) && a.isPlayer) g.hitstop = Math.max(g.hitstop, 0.035);
      if (near(a)) audio.sfx('swing', { x: a.pos.x, z: a.pos.z, vol: a.isPlayer ? 0.7 : 0.35 });
      const f = v2.set(Math.sin(a.aimYaw), 0, Math.cos(a.aimYaw));
      const at = new THREE.Vector3(a.pos.x + f.x * p.range * 0.6, a.pos.y + 0.6, a.pos.z + f.z * p.range * 0.6);
      if (p.kind === 'cone') {
        const q = acquire(p.model);
        q.position.copy(muzzle(a));
        q.rotation.set(0, a.aimYaw, 0);
        g.summons.push({ kind: 'wave', mesh: q, model: p.model, life: 0.35, max: 0.35, vel: f.clone().multiplyScalar(14) });
      } else fx.burst(at, [0xffffff, a.spec.accent], 8, { speed: 4, up: 2, life: 0.35, size: 0.8, gravity: 2 });
    }
  }

  function nearestHostile(a, range = Infinity) {
    let best = null, bd = range;
    for (const t of g.actors) {
      if (!t.alive || !hostile(a, t)) continue;
      const d = a.pos.distanceTo(t.pos) - t.radius;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  function special(a, aim, wish) {
    const s = a.spec.special;
    if (a.cdS > 0 || a.stunT > 0) return;
    const f = v2.set(aim.x - a.pos.x, 0, aim.z - a.pos.z).normalize();
    if (s.kind === 'lifesteal' || s.kind === 'summon') {
      if (!nearestHostile(a, s.range ?? 40)) { if (a.isPlayer) ui.toast(L.noTarget); return; }
    }
    a.cdS = s.cd;
    a.anim.special = 1;
    if (!a.isPlayer) ui.cast(a);
    a.faceT = 0.5;
    a.aimYaw = Math.atan2(f.x, f.z);
    const at = { x: a.pos.x, z: a.pos.z };
    switch (s.kind) {
      case 'dash': {
        const dir = s.dir === 'move' && wish && wish.lengthSq() > 0.1 ? wish.clone().normalize() : f.clone();
        a.dashV.copy(dir).multiplyScalar(DASH_SPEED);
        a.dashT = s.dist / DASH_SPEED;
        a.dashHit.clear();
        if (s.dmg === 0) a.invulnT = Math.max(a.invulnT, a.dashT + 0.15);
        audio.sfx('dash', at);
        if (s.dmg) voice(a, 0.9);
        break;
      }
      case 'aoe':
        hitArc(a, s.radius, Math.PI, s.dmg, s.knock, s.stun);
        fx.ring(a.pos, s.radius, a.spec.accent, 0.5);
        fx.burst(center(a), [a.spec.color, a.spec.accent], 20, { speed: 10, up: 2, life: 0.6 });
        voice(a, 1);
        audio.sfx('boom', { ...at, vol: 0.6 });
        g.shake = Math.max(g.shake, a.isPlayer ? 0.3 : 0);
        break;
      case 'rage':
        a.rageT = s.dur;
        fx.ring(a.pos, 2.5, 0xff3b3b, 0.5);
        fx.burst(center(a), [0xff3b3b, 0xffb020, a.spec.accent], 22, { speed: 6, up: 6, life: 0.7 });
        voice(a, 1);
        break;
      case 'dive':
        a.diveT = s.dur;
        a.invulnT = Math.max(a.invulnT, s.dur);
        fx.burst(a.pos, [0x9fd8ff, 0xffffff], 18, { speed: 5, up: 6, life: 0.6 });
        audio.sfx('splash', at);
        break;
      case 'summon':
        for (let i = 0; i < s.count; i++) {
          const mesh = acquire(s.model);
          const ang = a.aimYaw + (i - (s.count - 1) / 2) * 0.5;
          mesh.position.set(a.pos.x + Math.sin(ang) * 1.2, s.fly ? 1.5 : 0, a.pos.z + Math.cos(ang) * 1.2);
          g.summons.push({ kind: 'summon', spec: s, owner: a, mesh, model: s.model, life: s.dur, max: s.dur, tickT: 0, ang });
        }
        audio.sfx('summon', at);
        break;
      case 'lifesteal': {
        const t = nearestHostile(a, s.range);
        const before = t.hp;
        damage(t, s.dmg, a, null);
        heal(a, Math.max(0, before - Math.max(0, t.hp)));
        const from = center(t, new THREE.Vector3()), to = center(a, new THREE.Vector3());
        for (let i = 0; i <= 8; i++) fx.burst(from.clone().lerp(to, i / 8), [a.spec.accent, 0xffe066], 2, { speed: 1, up: 1, life: 0.6, gravity: 0 });
        audio.sfx('steal', at);
        break;
      }
      case 'stun':
        hitArc(a, s.range, s.arc, s.dmg, 2, s.stun);
        fx.burst(muzzle(a), 0xffffff, 30, { speed: 12, up: 1, life: 0.3, gravity: 0, size: 1.5 });
        audio.sfx('stun', at);
        break;
      case 'bomb': {
        const from = muzzle(a);
        spawnProjectile(a, { model: s.model, pos: from, vel: ballistic(from, aim, s.speed, 18), dmg: s.dmg, gravity: 18, splash: s.radius, life: 3, r: 0.6, knock: 10, spin: 6 });
        audio.sfx('throw', at);
        break;
      }
    }
  }

  // ---------- movement ----------
  function stepActor(a, dt, c) {
    const s = a.spec;
    a.anim.t += dt;
    const wasCooling = a.cdS > 0;
    for (const k of ['cdP', 'cdS', 'stunT', 'invulnT', 'knockT', 'dashT', 'diveT', 'faceT', 'rageT']) a[k] = Math.max(0, a[k] - dt);
    if (a.isPlayer && wasCooling && a.cdS === 0 && a.alive) audio.sfx('uiMove', { vol: 0.5, pitch: 1.5 });
    a.anim.attack = Math.max(0, a.anim.attack - dt * 3);
    a.anim.hurt = Math.max(0, a.anim.hurt - dt * 4);
    a.anim.special = a.diveT > 0 || a.rageT > 0 ? 1 : Math.max(0, a.anim.special - dt * 2);
    a.anim.stun = a.stunT > 0;

    if (!a.alive) {
      a.respawnT -= dt;
      a.vel.x *= 0.9; a.vel.z *= 0.9;
      if (a.respawnT <= 0 && fighting() && !(a.isPlayer && g.phase === 'boss' && g.lives <= 0)) respawn(a);
      a.model.update(dt, a.anim);
      return;
    }
    const canAct = a.stunT <= 0 && fighting();
    const water = park.isWater(a.pos.x, a.pos.z);
    if (water && !a.inWater && a.pos.y < 0.5) {
      fx.burst(a.pos, [0x9fd8ff, 0xffffff], 10, { speed: 3, up: 5, life: 0.5 });
      audio.sfx('splash', { x: a.pos.x, z: a.pos.z, vol: a.isPlayer ? 0.7 : 0.25 });
    }
    a.inWater = water && a.pos.y < 0.3;
    let speed = s.speed * (rival(a) ? g.diff.speed : 1) * (a.inWater ? (s.swims ? (s.swimMult || 1.2) : 0.55) : 1);
    if (a.diveT > 0 || a.rageT > 0) speed *= s.special.boost;
    const wish = canAct ? c.wish : v1.set(0, 0, 0);
    const accel = a.knockT > 0 ? 2 : a.onGround || a.inWater ? 14 : 5;
    const k = Math.min(1, accel * dt);
    a.vel.x += (wish.x * speed - a.vel.x) * k;
    a.vel.z += (wish.z * speed - a.vel.z) * k;
    if (a.dashT > 0) {
      a.vel.x = a.dashV.x; a.vel.z = a.dashV.z;
      if (s.special.dmg) {
        for (const t of g.actors) {
          if (!t.alive || !hostile(a, t) || a.dashHit.has(t) || t.pos.distanceTo(a.pos) > t.radius + a.radius + 0.6) continue;
          a.dashHit.add(t);
          damage(t, s.special.dmg, a, v2.copy(a.dashV).normalize(), s.special.knock);
        }
      }
    }

    if (canAct && c.jump) {
      if (a.onGround || a.inWater) {
        a.vel.y = s.jump;
        if (near(a, 12)) audio.sfx('jump', { x: a.pos.x, z: a.pos.z, vol: a.isPlayer ? 0.5 : 0.2 });
      } else if (s.flies && a.pos.y < MAX_FLY) {
        a.vel.y = Math.max(a.vel.y, 6.5);
        if (near(a, 12)) audio.sfx('flap', { x: a.pos.x, z: a.pos.z, vol: a.isPlayer ? 0.5 : 0.2 });
      }
    }
    a.vel.y -= GRAVITY * dt;
    if (s.flies && c.hold && a.vel.y < -2.2) a.vel.y = -2.2;
    a.pos.addScaledVector(a.vel, dt);

    const ground = a.inWater || water ? (s.swims ? park.waterLevel : -0.45) : 0;
    a.onGround = a.pos.y <= ground + 0.01;
    if (a.pos.y < ground) { a.pos.y = ground; a.vel.y = Math.max(0, a.vel.y); }
    collide(a);
    const b = park.bounds;
    a.pos.x = THREE.MathUtils.clamp(a.pos.x, -b.halfX + 1, b.halfX - 1);
    a.pos.z = THREE.MathUtils.clamp(a.pos.z, -b.halfZ + 1, b.halfZ - 1);

    if (canAct && c.primary) primary(a, c.aim);
    if (canAct && c.special) special(a, c.aim, c.wish);

    const hs = Math.hypot(a.vel.x, a.vel.z);
    const targetYaw = a.faceT > 0 || (a.isPlayer && c.primary) ? a.aimYaw : hs > 0.5 ? Math.atan2(a.vel.x, a.vel.z) : a.yaw;
    a.yaw += angleDiff(targetYaw, a.yaw) * Math.min(1, dt * 14);
    a.anim.move = Math.min(1, hs / s.speed);
    a.anim.air = !a.onGround && !a.inWater;
    a.anim.swim = a.inWater && s.swims;
    a.model.update(dt, a.anim);
  }

  function collide(a) {
    for (const c of park.colliders) {
      if (a.pos.y > c.h) continue;
      if (c.r !== undefined) {
        const dx = a.pos.x - c.x, dz = a.pos.z - c.z, d = Math.hypot(dx, dz), m = c.r + a.radius;
        if (d < m && d > 1e-4) { a.pos.x = c.x + dx / d * m; a.pos.z = c.z + dz / d * m; }
      } else {
        const dx = a.pos.x - c.x, dz = a.pos.z - c.z;
        const ox = c.hx + a.radius - Math.abs(dx), oz = c.hz + a.radius - Math.abs(dz);
        if (ox > 0 && oz > 0) {
          if (ox < oz) a.pos.x += Math.sign(dx || 1) * ox; else a.pos.z += Math.sign(dz || 1) * oz;
        }
      }
    }
    for (const o of g.actors) {
      if (o === a || !o.alive || a.isBoss) continue;
      if (o.isBoss) {
        if (Math.abs(a.pos.y - o.pos.y - 1.5) > 3.5) continue;
        const dx = a.pos.x - o.pos.x, dz = a.pos.z - o.pos.z, d = Math.hypot(dx, dz), m = o.radius + a.radius - 0.6;
        if (d < m && d > 1e-4) { a.pos.x = o.pos.x + dx / d * m; a.pos.z = o.pos.z + dz / d * m; }
        continue;
      }
      const dx = a.pos.x - o.pos.x, dz = a.pos.z - o.pos.z, d = Math.hypot(dx, dz), m = a.radius + o.radius;
      if (d < m && d > 1e-4 && Math.abs(a.pos.y - o.pos.y) < 1) {
        const push = (m - d) * 0.5;
        a.pos.x += dx / d * push; a.pos.z += dz / d * push;
      }
    }
  }

  function respawn(a) {
    a.alive = true;
    a.anim.dead = false;
    a.hp = a.maxHp;
    a.invulnT = 1.6;
    a.stunT = a.dashT = a.diveT = a.rageT = 0;
    placeAtSpawn(a);
    fx.burst(a.pos, [TEAM_COLORS[a.team], 0xffffff], 16, { speed: 3, up: 6, life: 0.7 });
    if (a.isPlayer) ui.respawned();
  }

  // ---------- projectiles & summons ----------
  function stepProjectiles(dt) {
    for (let i = g.projectiles.length - 1; i >= 0; i--) {
      const p = g.projectiles[i];
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.life -= dt;
      if (p.spin) p.mesh.rotation.x += p.spin * dt;
      else p.mesh.lookAt(v1.copy(p.pos).add(p.vel));
      let hit = null;
      for (const t of g.actors) {
        if (!t.alive || !hostile(p.owner, t)) continue;
        if (center(t, v2).distanceTo(p.pos) < t.radius + p.r + (t.isBoss ? 0.6 : 0.15)) { hit = t; break; }
      }
      const ground = park.isWater(p.pos.x, p.pos.z) ? park.waterLevel : 0;
      const wall = park.blocked(p.pos.x, p.pos.z, p.pos.y);
      if (!hit && !wall && p.pos.y > ground && p.life > 0) continue;
      if (p.splash) {
        explode(p.owner, p.pos, p.splash, p.dmg, p.knock);
      } else if (hit) {
        damage(hit, p.dmg, p.owner, v2.set(p.vel.x, 0, p.vel.z).normalize(), p.knock);
        fx.burst(p.pos, [0xffffff, p.owner.spec.accent], 6, { speed: 3, up: 3, life: 0.35, size: 0.7 });
      } else {
        const wet = p.pos.y <= ground && park.isWater(p.pos.x, p.pos.z);
        fx.burst(p.pos, wet ? [0x9fd8ff, 0xffffff] : [0xc8b18a, 0x8fbf5a], 5, { speed: 2, up: 3, life: 0.35, size: 0.6 });
      }
      release(p.mesh, p.model);
      g.projectiles.splice(i, 1);
    }
  }

  function explode(owner, pos, radius, dmg, knock) {
    for (const t of g.actors) {
      if (!t.alive || !hostile(owner, t)) continue;
      const d = center(t, v2).distanceTo(pos);
      if (d < radius + t.radius) damage(t, dmg * (1 - 0.5 * d / (radius + t.radius)), owner, v2.subVectors(t.pos, pos).setY(0).normalize(), knock);
    }
    fx.ring({ x: pos.x, y: Math.max(0, pos.y - 0.3), z: pos.z }, radius, owner.spec.accent, 0.45);
    fx.burst(pos, [owner.spec.color, owner.spec.accent, 0xffffff], 18, { speed: 8, up: 6, life: 0.7 });
    audio.sfx('boom', { x: pos.x, z: pos.z, vol: owner.isPlayer ? 0.8 : 0.45 });
    if (owner.isPlayer || g.player.pos.distanceTo(pos) < radius * 2) g.shake = Math.max(g.shake, 0.2);
  }

  function stepSummons(dt) {
    for (let i = g.summons.length - 1; i >= 0; i--) {
      const s = g.summons[i];
      s.life -= dt;
      const m = s.mesh;
      if (s.kind === 'wave') {
        m.position.addScaledVector(s.vel, dt);
        m.scale.setScalar(0.6 + (1 - s.life / s.max) * 1.6);
      } else {
        const sp = s.spec, t = nearestHostile(s.owner, 60);
        if (t) {
          const c = center(t, v2);
          const dir = v1.set(c.x - m.position.x, sp.fly ? c.y + 0.6 - m.position.y : 0, c.z - m.position.z);
          const d = dir.length();
          if (sp.fly) dir.x += Math.sin(s.life * 9 + s.ang) * 3;
          m.position.addScaledVector(dir.normalize(), sp.speed * dt);
          m.rotation.y = Math.atan2(dir.x, dir.z);
          if (sp.fly) {
            m.position.y += Math.sin(s.life * 14) * 0.03;
            if (d < 1.2 && (s.tickT -= dt) <= 0) { s.tickT = sp.tick; damage(t, sp.dmg, s.owner, null); audio.sfx(s.owner.spec.voice, { x: m.position.x, z: m.position.z, vol: 0.25 }); }
          } else {
            m.position.y = Math.abs(Math.sin(s.life * 16)) * 0.15 + (park.isWater(m.position.x, m.position.z) ? park.waterLevel : 0);
            if (d < 1.1) s.life = 0;
          }
        }
        if (s.life <= 0 && sp.blast) explode(s.owner, m.position.clone().setY(0.5), sp.blast, sp.dmg, sp.knock);
        if (s.life <= 0 && sp.fly) fx.burst(m.position, [s.owner.spec.color, 0xffffff], 5, { speed: 2, up: 3, life: 0.5 });
      }
      if (s.life <= 0) { release(m, s.model); g.summons.splice(i, 1); }
    }
  }

  function stepPickups(dt) {
    for (const p of g.pickups) {
      if (p.respawnT > 0) {
        p.respawnT -= dt;
        p.mesh.visible = p.respawnT <= 0;
        continue;
      }
      p.mesh.rotation.y += dt * 2;
      p.mesh.position.y = 0.65 + Math.sin(g.time * 3 + p.x) * 0.12;
      for (const a of g.actors) {
        if (!a.alive || a.isBoss || a.hp >= a.maxHp || Math.hypot(a.pos.x - p.x, a.pos.z - p.z) > 1.5 || a.pos.y > 2) continue;
        heal(a, 45);
        p.respawnT = 14;
        p.mesh.visible = false;
        fx.burst(p.mesh.position, [0x9dff6a, 0xffe08a], 12, { speed: 3, up: 4, life: 0.6 });
        audio.sfx('pickup', { x: p.x, z: p.z, vol: a.isPlayer ? 1 : 0.3 });
        if (a.isPlayer) ui.toast(L.bread);
        break;
      }
    }
  }

  // ---------- bots ----------
  function think(a, dt) {
    const ai = a.ai, c = ai.ctl;
    c.jump = c.primary = c.special = false;
    if (!a.alive) return c;
    ai.thinkT -= dt;
    if (ai.thinkT <= 0) {
      ai.thinkT = rand(0.25, 0.5);
      let best = null, bs = Infinity;
      for (const t of g.actors) {
        if (!t.alive || !hostile(a, t)) continue;
        const d = a.pos.distanceTo(t.pos);
        const score = t.isBoss ? 0 : d * (0.6 + t.hp / t.maxHp) * (t === ai.target ? 0.7 : 1) * (t.isPlayer ? 0.9 : 1);
        if (score < bs) { bs = score; best = t; }
      }
      ai.target = best;
      ai.goal = null;
      if (a.hp < a.maxHp * 0.35 && !a.isBoss) {
        const p = g.pickups.filter(p => p.respawnT <= 0).sort((p, q) => Math.hypot(p.x - a.pos.x, p.z - a.pos.z) - Math.hypot(q.x - a.pos.x, q.z - a.pos.z))[0];
        if (p && Math.hypot(p.x - a.pos.x, p.z - a.pos.z) < 28) ai.goal = p;
      }
      const moved = a.pos.distanceTo(ai.lastPos);
      ai.lastPos.copy(a.pos);
      ai.stuckT = moved < 0.4 && a.anim.move > 0.1 ? ai.stuckT + 1 : 0;
      if (ai.stuckT >= 2) { ai.wander = new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize(); ai.wanderT = 1.2; ai.stuckT = 0; c.jump = true; }
    }
    if ((ai.strafeT -= dt) <= 0) { ai.strafeT = rand(0.8, 2); ai.strafe = Math.random() < 0.5 ? -1 : 1; }
    const t = ai.target;
    c.wish.set(0, 0, 0);
    if (ai.wanderT > 0) {
      ai.wanderT -= dt;
      c.wish.copy(ai.wander);
    } else if (ai.goal) {
      c.wish.set(ai.goal.x - a.pos.x, 0, ai.goal.z - a.pos.z).normalize();
    } else if (t) {
      const p = a.spec.primary, ranged = p.kind === 'shot' || p.kind === 'lob';
      const range = p.kind === 'melee' ? Math.max(0.6, p.range - 1.2) : p.kind === 'cone' ? 3.5 : 11;
      const to = v1.set(t.pos.x - a.pos.x, 0, t.pos.z - a.pos.z);
      const d = to.length() - t.radius;
      to.normalize();
      const side = v2.set(-to.z, 0, to.x).multiplyScalar(ai.strafe * (d < range + 4 ? 0.8 : 0.25));
      const toward = d > range + 1 ? 1 : d < range * 0.5 && range > 4 ? -0.3 : 0.1;
      c.wish.copy(to).multiplyScalar(toward).add(side);
      if (c.wish.lengthSq() > 1) c.wish.normalize();
      // aim with lead + error that shrinks when close
      const lead = Math.min(0.6, d / (p.speed || 30));
      const err = (0.4 + d * 0.06) * (rival(a) ? g.diff.aim : 1);
      center(t, c.aim);
      c.aim.x += t.vel.x * lead + rand(-err, err);
      c.aim.y += rand(-err, err) * 0.5;
      c.aim.z += t.vel.z * lead + rand(-err, err);
      ai.react -= dt;
      if (d < range * 1.25 + (ranged ? 8 : 0.8 + (p.lunge || 0)) && ai.react <= 0) {
        if (!t.isBoss || ranged || Math.abs(t.pos.y - a.pos.y) < 3.5) c.primary = true;
      }
      const s = a.spec.special;
      if (a.cdS <= 0 && Math.random() < dt * 2) {
        const ok = {
          dash: d > 3 && d < s.dist + 2 && (s.dmg > 0 || a.hp < a.maxHp * 0.6),
          aoe: d < s.radius,
          dive: a.hp < a.maxHp * 0.5 || d < 5,
          rage: d < 9,
          summon: d < 25,
          lifesteal: d < s.range,
          stun: d < s.range * 0.8,
          bomb: d > 5 && d < 22,
        }[s.kind];
        if (ok) c.special = true;
      }
      if (a.spec.flies && (t.isBoss ? t.pos.y > 4 : a.pos.y > 0.5 || Math.random() < dt * 0.4)) c.jump = Math.random() < dt * (t.isBoss ? 6 : a.pos.y > 0.5 ? 2.5 : 6);
      if (a.spec.flies) c.hold = true;
      if (!a.spec.flies && Math.random() < dt * 0.25) c.jump = true;
    }
    // steer around obstacles
    if (c.wish.lengthSq() > 0.01) {
      const look = 1.6 + a.radius;
      for (const turn of [0, 0.7, -0.7, 1.4, -1.4, 2.2, -2.2]) {
        const ang = Math.atan2(c.wish.x, c.wish.z) + turn * (ai.strafe || 1);
        const px = a.pos.x + Math.sin(ang) * look, pz = a.pos.z + Math.cos(ang) * look;
        const wet = !a.spec.swims && !a.spec.flies && park.isWater(px, pz) && !park.isWater(a.pos.x, a.pos.z);
        if (!wet && !park.blocked(px, pz, a.pos.y + 0.3, a.radius)) {
          const len = c.wish.length();
          c.wish.set(Math.sin(ang) * len, 0, Math.cos(ang) * len);
          break;
        }
      }
    }
    if (!t) c.aim.copy(a.pos).add(v1.set(Math.sin(a.yaw), 0.5, Math.cos(a.yaw)));
    return c;
  }

  // a little gold crown on every phase-1 winner, so the boss bonus is visible
  function crownTeam(team) {
    for (const a of g.actors) {
      if (a.team !== team || a.isBoss) continue;
      const c = buildProp('crown');
      c.position.y = a.model.height + 0.1;
      c.scale.setScalar(0.45 + a.spec.size * 0.35);
      a.model.root.add(c);
      a.crown = c;
    }
  }

  // phase 1 is decided: crown the winners and show the "won" beat (the boss spawns when it ends)
  function winPhase1(team, secs) {
    g.crown = team;
    crownTeam(team);
    setPhase('won', secs);
  }

  // ---------- boss ----------
  function spawnBoss() {
    const b = makeActor(BOSS, 9, text(BOSS).name);
    b.maxHp = b.hp = BOSS.hp;
    b.pos.set(0, 30, -90);
    b.model.root.scale.setScalar(BOSS_SCALE);
    b.model.height *= BOSS_SCALE;
    g.boss = b;
    g.bossAi = { mode: 'enter', t: 3.5, ang: -Math.PI / 2, shotT: 2, target: null, mark: null, divesLeft: 0, point: new THREE.Vector3() };
    for (const a of g.actors) a.stunT = 0;
  }

  function bossTarget() {
    const alive = g.actors.filter(a => a.alive && !a.isBoss);
    if (!alive.length) return null;
    return g.player.alive && Math.random() < 0.45 ? g.player : pick(alive);
  }

  function stepBoss(dt) {
    const b = g.boss, ai = g.bossAi;
    if (!b) return;
    b.anim.t += dt;
    b.anim.hurt = Math.max(0, b.anim.hurt - dt * 4);
    b.anim.attack = Math.max(0, b.anim.attack - dt * 1.5);
    b.anim.special = Math.max(0, b.anim.special - dt * 1.2);
    b.anim.dead = !b.alive;
    if (!b.alive) {
      b.pos.y = Math.max(0, b.pos.y - dt * 6);
      b.model.update(dt, b.anim);
      return;
    }
    const enraged = b.hp < b.maxHp * 0.5;
    const R = 16, H = 11;
    if (enraged && !ai.enraged) {
      ai.enraged = true;
      ui.banner(L.enrage, L.enrageSub, 2.4, 'boss');
      audio.sfx('screech', { x: b.pos.x, z: b.pos.z });
    }
    ui.bossStunned(ai.mode === 'stunned' && ai.divesLeft <= 0);
    ai.t -= dt;
    const goto = (x, y, z, sp) => {
      v1.set(x - b.pos.x, y - b.pos.y, z - b.pos.z);
      const d = v1.length();
      if (d > 0.01) {
        b.pos.addScaledVector(v1.normalize(), Math.min(d, sp * g.diff.boss * dt));
        if (Math.hypot(v1.x, v1.z) > 0.1) b.yaw += angleDiff(Math.atan2(v1.x, v1.z), b.yaw) * Math.min(1, dt * 6);
      }
      return d;
    };
    switch (ai.mode) {
      case 'enter':
        goto(Math.cos(ai.ang) * R, H, Math.sin(ai.ang) * R, 26);
        if (ai.t <= 0) { ai.mode = 'circle'; ai.t = rand(5, 7); }
        break;
      case 'circle':
        ai.ang += dt * (enraged ? 0.55 : 0.4);
        goto(Math.cos(ai.ang) * R, H + Math.sin(g.time * 1.3) * 1.5, Math.sin(ai.ang) * R, 18);
        if ((ai.shotT -= dt) <= 0) {
          ai.shotT = enraged ? 1.4 : 2.1;
          const n = enraged ? 5 : 3;
          b.anim.special = 0.6;
          audio.sfx('screech', { x: b.pos.x, z: b.pos.z, vol: 0.5, pitch: 1.3 });
          for (let i = 0; i < n; i++) {
            const t = bossTarget();
            if (!t) break;
            const from = center(b, new THREE.Vector3());
            const to = new THREE.Vector3(t.pos.x + rand(-2, 2) + t.vel.x * 0.8, t.pos.y, t.pos.z + rand(-2, 2) + t.vel.z * 0.8);
            spawnProjectile(b, { model: 'bossfish', pos: from, vel: ballistic(from, to, 18, 14), dmg: 24, gravity: 14, splash: 2.2, life: 4, r: 0.5, knock: 6 });
          }
        }
        if (ai.t <= 0) { ai.mode = 'telegraph'; ai.t = enraged ? 0.9 : 1.2; ai.divesLeft = enraged ? 2 : 0; beginTelegraph(); }
        break;
      case 'telegraph':
        goto(ai.point.x * 0.6, H + 3, ai.point.z * 0.6, 14);
        b.anim.special = 1;
        if (ai.t <= 0) { ai.mode = 'dive'; audio.sfx('bossDive', { x: b.pos.x, z: b.pos.z }); }
        break;
      case 'dive': {
        b.anim.attack = 1;
        const d = goto(ai.point.x, park.isWater(ai.point.x, ai.point.z) ? park.waterLevel : 0, ai.point.z, enraged ? 52 : 44);
        if (d < 0.8) {
          if (ai.mark) ai.mark.life = 0;
          explodeBoss(b.pos);
          ai.mode = 'stunned';
          ai.t = ai.divesLeft > 0 ? 0.7 : 2.6;
          if (ai.divesLeft <= 0) ui.toast(L.bossDazed);
        }
        break;
      }
      case 'stunned':
        b.anim.stun = ai.divesLeft <= 0;
        if (ai.t <= 0) {
          b.anim.stun = false;
          if (ai.divesLeft-- > 0) { ai.mode = 'telegraph'; ai.t = 0.75; beginTelegraph(); }
          else if (Math.random() < 0.4) { ai.mode = 'perch'; ai.t = 3.5; }
          else { ai.mode = 'circle'; ai.t = rand(5, 7); ai.ang = Math.atan2(b.pos.z, b.pos.x); }
        }
        break;
      case 'perch': {
        const d = goto(park.perch.x, park.perch.y, park.perch.z, 22);
        if (d < 0.5 && (ai.shotT -= dt) <= 0) {
          ai.shotT = 0.5;
          const t = bossTarget();
          if (t) {
            const from = center(b, new THREE.Vector3());
            spawnProjectile(b, { model: 'bossfish', pos: from, vel: ballistic(from, t.pos.clone().add(t.vel.clone().multiplyScalar(0.7)), 22, 14), dmg: 12, gravity: 14, splash: 2, life: 4, r: 0.5, knock: 5 });
            b.anim.attack = 0.5;
          }
        }
        if (ai.t <= 0) { ai.mode = 'circle'; ai.t = rand(5, 7); ai.ang = Math.atan2(b.pos.z, b.pos.x); }
        break;
      }
    }
    b.anim.air = ai.mode !== 'stunned' && !(ai.mode === 'perch' && b.pos.distanceTo(park.perch) < 0.6);
    b.anim.move = 1;
    b.ring.position.set(b.pos.x, (park.isWater(b.pos.x, b.pos.z) ? park.waterLevel : 0) + 0.05, b.pos.z);
    b.ring.material.opacity = 0.25;
    b.model.update(dt, b.anim);
  }

  function beginTelegraph() {
    const ai = g.bossAi;
    ai.target = bossTarget();
    if (!ai.target) return;
    ai.point.set(ai.target.pos.x, 0, ai.target.pos.z);
    ai.mark = fx.ring(ai.point, 4.5, 0xff2a2a, 10, { grow: false, follow: ai.point });
    audio.sfx('screech', { x: g.boss.pos.x, z: g.boss.pos.z, vol: 0.9 });
    if (ai.target.isPlayer) ui.toast(L.bossTargets);
  }

  function explodeBoss(pos) {
    for (const t of g.actors) {
      if (!t.alive || t.isBoss) continue;
      const d = Math.hypot(t.pos.x - pos.x, t.pos.z - pos.z);
      if (d < 4.5 + t.radius && t.pos.y < 8) damage(t, 70 * (1 - d / 9), g.boss, v2.set(t.pos.x - pos.x, 0, t.pos.z - pos.z).normalize(), 8, 0.4);
    }
    fx.ring({ x: pos.x, y: 0, z: pos.z }, 6, BOSS.color, 0.6);
    fx.burst(pos, [0x9fd8ff, 0xffffff, BOSS.color], 40, { speed: 12, up: 9, life: 1 });
    audio.sfx('boom', { x: pos.x, z: pos.z });
    audio.sfx('splash', { x: pos.x, z: pos.z });
    g.shake = Math.max(g.shake, 0.6 - Math.min(0.5, g.player.pos.distanceTo(pos) / 60));
  }

  // ---------- frame ----------
  function update(dt, playerCtl) {
    if (g.hitstop > 0) { g.hitstop -= dt; dt *= g.slow; } else g.slow = 0.15;
    g.time += dt;
    g.shake = Math.max(0, g.shake - dt * 1.5);
    if (g.phaseT > 0) g.phaseT -= dt;
    if (g.phase === 'countdown') {
      const n = Math.ceil(g.phaseT);
      if (n > 0 && n !== lastCount) { lastCount = n; ui.banner(String(n), L.ready, 1.2, 'count'); audio.sfx('countdown'); }
    }
    if (g.phase === 'countdown' && g.phaseT <= 0) { setPhase('match'); audio.sfx('go'); audio.music('match'); }
    if (g.phase === 'won') for (const a of g.actors) if (!a.alive) respawn(a); // nobody can die during 'won', so this runs once in effect
    if (g.phase === 'won' && g.phaseT <= 0) { setPhase('bossIntro', 4.5); spawnBoss(); audio.music(null); audio.sfx('bossIntro'); }
    if (g.phase === 'bossIntro' && g.phaseT <= 0) { setPhase('boss'); audio.music('boss'); for (const a of g.actors) if (!a.alive && !a.isBoss) respawn(a); }

    const frozen = g.phase === 'countdown' || g.phase === 'bossIntro';
    for (const a of g.actors) {
      if (a.isBoss) continue;
      const c = a.isPlayer && !g.autopilot ? playerCtl : think(a, dt);
      if (frozen) { c.wish.set(0, 0, 0); c.primary = c.special = c.jump = false; }
      stepActor(a, dt, c);
    }
    stepBoss(dt);
    stepProjectiles(dt);
    stepSummons(dt);
    stepPickups(dt);
    for (const a of g.actors) {
      if (a.isBoss) continue;
      a.model.root.position.copy(a.pos);
      a.model.root.rotation.y = a.yaw;
      a.model.root.visible = !(a.invulnT > 0 && a.alive && a.diveT <= 0 && Math.floor(g.time * 14) % 2 === 0);
      a.ring.visible = a.alive;
      if (a.crown) { a.crown.visible = a.alive; a.crown.position.y = a.model.height + 0.1 - (a.anim.swim ? 0.3 : 0); }
      a.ring.position.set(a.pos.x, (a.inWater ? park.waterLevel : 0) + 0.04, a.pos.z);
    }
    if (g.boss) { g.boss.model.root.position.copy(g.boss.pos); g.boss.model.root.rotation.y = g.boss.yaw; }
  }

  // test hooks: jump straight to the boss, or let the AI drive the player
  function skipToBoss() {
    if (g.phase !== 'match' && g.phase !== 'countdown') return;
    g.scores[0] = RULES.koToWin;
    winPhase1(0, 0.1);
  }

  return Object.assign(g, { start, update, clear, hostile, center, skipToBoss, autopilot: false, diff: DIFFICULTY[2] });
}
