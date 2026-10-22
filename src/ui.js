import * as THREE from 'three';
import { SPECIES, RULES, TEAM_COLORS, DIFFICULTY, gendered } from './species.js';
import { L, LANGS, lang, text, label } from './i18n.js';
import { createChat, hex, esc } from './chat.js';

const $ = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const RANGE = { shot: 0.9, lob: 0.75, cone: 0.4, melee: 0.22 };
const v = new THREE.Vector3();
const MAX_HP = Math.max(...SPECIES.map(s => s.hp));
const MAX_SPEED = Math.max(...SPECIES.map(s => s.speed));
const MAX_DPS = Math.max(...SPECIES.map(s => s.primary.dmg / s.primary.rate));

export function createUI(root) {
  const portraits = {};
  let game = null; // set once by bind()
  const plates = new Map();
  const nums = [];
  const lastNum = new WeakMap();

  root.innerHTML = `
    <div class="screen menu" id="menu" hidden>
      <header class="logo"><h1>ZOO PARK<span>WARFARE</span></h1><p data-t="subtitle"></p>
        <fieldset class="seg lang" id="lang"><legend data-t="language"></legend>${Object.keys(LANGS).map(id => `
          <label><input type="radio" name="lang" value="${id}" /><span>${id.toUpperCase()}</span></label>`).join('')}
        </fieldset>
      </header>
      <section class="picker" data-ta="pickAria">
        <h2 data-t="pick"></h2>
        <div class="grid" role="listbox" data-ta="animals" id="grid"></div>
      </section>
      <section class="detail" id="detail" aria-live="polite"></section>
      <footer class="menu-foot">
        <div class="keys" data-ta="controls" data-t="keysMenu"></div>
        <fieldset class="seg diff" id="diff"><legend data-t="difficulty"></legend>${DIFFICULTY.map(d => `
          <label><input type="radio" name="diff" value="${d.id}" /><span></span></label>`).join('')}
        </fieldset>
        <button class="go" id="go" data-t="go"></button>
      </footer>
      <p class="drag-hint" data-t="drag"></p>
    </div>

    <div class="hud" id="hud" hidden>
      <div class="scores" id="scores"></div>
      <div class="bossbar" id="bossbar" hidden>
        <div class="bossname" id="bossname"></div>
        <div class="bar"><i id="bosshp"></i></div>
        <div class="lives" id="lives" data-tt="livesTitle" data-ta="livesAria"></div>
      </div>
      <div class="feed" id="feed" aria-live="polite"></div>
      <div class="chat" id="chat"><div class="rows" aria-live="polite"></div><div class="typing" hidden></div></div>
      <div class="crosshair" id="cross"><i></i><i></i><i></i><i></i></div>
      <div class="hurtdir" id="hurtdir"></div>
      <div class="plates" id="plates"></div>
      <div class="bossarrow" id="bossarrow" hidden aria-hidden="true">▲<span data-t="bossShort"></span></div>
      <div class="me">
        <img id="meimg" alt="" />
        <div class="mebox">
          <div class="mename" id="mename"></div>
          <div class="crownchip" id="crownchip" hidden data-t="crownChip"></div>
          <div class="hp"><i id="mehp"></i><span id="mehptext"></span></div>
        </div>
      </div>
      <div class="abilities">
        <div class="ab" id="abP"><b data-t="click"></b><span></span><i class="cd"></i></div>
        <div class="ab" id="abS"><b data-t="rightClickE"></b><span></span><i class="cd"></i></div>
      </div>
      <div class="toast" id="toast" role="status"></div>
      <div class="banner" id="banner"><h2></h2><p></p></div>
      <div class="dead" id="dead" hidden><h2>K.O.!</h2><p></p><div class="count"></div></div>
      <div class="flash" id="flash"></div>
    </div>

    <div class="screen overlay" id="pause" hidden role="dialog" aria-modal="true" aria-labelledby="pausetitle">
      <div class="card">
        <h2 id="pausetitle" data-t="pause"></h2>
        <p id="pausenote" class="note"></p>
        <button class="go" id="resume" data-t="resume"></button>
        <label><span data-t="volume"></span> <input type="range" id="vol" min="0" max="1" step="0.05" /></label>
        <label><span data-t="sens"></span> <input type="range" id="sens" min="0.3" max="2.5" step="0.05" /></label>
        <label class="check"><input type="checkbox" id="chaton" /> <span data-t="chatToggle"></span></label>
        <div class="keys small" data-t="keysPause"></div>
        <button class="ghost" id="quit" data-t="quit"></button>
      </div>
    </div>

    <div class="screen overlay" id="result" hidden role="dialog" aria-modal="true" aria-labelledby="restitle">
      <div class="card">
        <h2 id="restitle"></h2>
        <p id="resreason"></p>
        <p class="caption" data-t="standings"></p>
        <div class="standings" id="resstandings"></div>
        <div class="stats" id="resstats"></div>
        <button class="go" id="again" data-t="again"></button>
        <button class="ghost" id="change" data-t="change"></button>
      </div>
    </div>
    <button class="mute" id="mute"></button>
  `;
  const el = id => root.querySelector('#' + id);
  // static labels; rerun on language change
  let muted = false;
  function relabel() {
    for (const e of root.querySelectorAll('[data-t]')) e.innerHTML = L[e.dataset.t];
    for (const e of root.querySelectorAll('[data-ta]')) e.setAttribute('aria-label', L[e.dataset.ta]);
    for (const e of root.querySelectorAll('[data-tt]')) e.title = L[e.dataset.tt];
    for (const e of el('diff').querySelectorAll('label')) {
      const [name, desc] = L.diff[e.querySelector('input').value];
      e.title = name; e.querySelector('input').setAttribute('aria-label', `${name}: ${desc}`); e.querySelector('span').textContent = desc;
    }
    el('lang').querySelector(`[value="${lang}"]`).checked = true;
    el('bossname').textContent = L.species.eisvogel.name;
    el('bossname').dataset.stunned = L.stunned;
    document.title = `${L.title} – ${L.subtitle}`;
    setMuted(muted);
  }
  // keep Tab inside whichever dialog is open
  addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const dlg = [el('pause'), el('result')].find(d => !d.hidden);
    if (!dlg) return;
    const f = [...dlg.querySelectorAll('button, input')];
    const i = f.indexOf(document.activeElement);
    e.preventDefault();
    f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
  });
  const hud = el('hud');
  const chat = createChat(el('chat'), () => game);
  el('chaton').checked = chat.on;
  el('chaton').onchange = e => chat.setOn(e.target.checked);

  // ---------- menu ----------
  let menuCb = null, selected = null, gender = 'm';
  function buildGrid() {
    el('grid').innerHTML = SPECIES.map((s, i) => `
      <button class="card-sp" role="option" data-id="${s.id}" style="--c:${hex(s.color)};--a:${hex(s.accent)}" aria-label="${esc(text(s).name)}">
        <img src="${portraits[s.id] || ''}" alt="" /><span>${esc(text(s).name)}</span>
      </button>`).join('');
    el('grid').onclick = e => {
      const b = e.target.closest('[data-id]');
      if (b) { if (b.dataset.id === selected) menuCb.start(); else menuCb.select(b.dataset.id); }
    };
  }
  function renderDetail(s) {
    const dps = s.primary.dmg / s.primary.rate, tx = text(s);
    const bars = [s.hp / MAX_HP, s.speed / MAX_SPEED, dps / MAX_DPS, RANGE[s.primary.kind]];
    el('detail').innerHTML = `
      <p class="faction">${esc(tx.team)}</p>
      <h2>${esc(label(s, gender))}</h2>${gendered(s) ? `
      <div class="gender" role="radiogroup">${['m', 'f'].map(g => `<button data-g="${g}" role="radio" aria-checked="${g === gender}" aria-label="${L.gender[g]}">${g === 'm' ? '♂' : '♀'}</button>`).join('')}</div>` : ''}
      <p class="tag">${esc(tx.tagline)}</p>
      <div class="bars">${bars.map((x, i) => `<div><span>${L.bars[i]}</span><i><b style="width:${Math.round(x * 100)}%"></b></i></div>`).join('')}</div>
      <div class="abil"><kbd>${L.click}</kbd><div><b>${esc(tx.primary)}</b><small>${L.kind[s.primary.kind]} · ${L.dmg(s.primary.dmg)}</small></div></div>
      <div class="abil"><kbd>${L.rightClick}</kbd><div><b>${esc(tx.special)}</b><small>${esc(tx.desc)} ${L.cooldown(s.special.cd)}</small></div></div>
      <div class="traits">${s.flies ? `<span>${L.flies}</span>` : ''}<span>${s.swims ? L.swims : L.wades}</span></div>`;
  }
  function showMenu(id, cb) {
    menuCb = cb;
    el('menu').hidden = false;
    hud.hidden = true;
    el('result').hidden = el('pause').hidden = true;
    setSelected(id);
    requestAnimationFrame(() => root.querySelector(`[data-id="${id}"]`)?.focus({ preventScroll: true }));
  }
  function setSelected(id) {
    selected = id;
    root.querySelectorAll('.card-sp').forEach(b => { b.setAttribute('aria-selected', b.dataset.id === id); b.tabIndex = b.dataset.id === id ? 0 : -1; });
    renderDetail(SPECIES.find(s => s.id === id));
  }
  el('detail').onclick = e => { const b = e.target.closest('[data-g]'); if (b && b.dataset.g !== gender) menuCb.gender(b.dataset.g); };
  function setGender(g) {
    gender = g;
    const img = root.querySelector('[data-id="mensch"] img');
    if (img) img.src = portraits.mensch;
    if (selected) { setSelected(selected); el('detail').querySelector(`[data-g="${g}"]`)?.focus(); }
  }
  el('go').onclick = () => menuCb?.start();
  // the menu is the only screen where the language can change, so it is the only one rebuilt live
  function setLanguage() { relabel(); buildGrid(); if (selected) setSelected(selected); }

  // ---------- match ----------
  function bind(g) { game = g; }
  function matchStart() {
    el('menu').hidden = el('result').hidden = el('pause').hidden = true;
    hud.hidden = false;
    el('bossbar').hidden = true;
    el('scores').hidden = false;
    el('dead').hidden = true;
    el('feed').innerHTML = '';
    el('plates').innerHTML = '';
    for (const n of nums) { n.life = 0; n.el.style.opacity = 0; el('plates').append(n.el); }
    plates.clear();
    const s = game.player.spec;
    el('meimg').src = portraits[s.id] || '';
    el('mename').textContent = `${label(s, game.player.gender)} · ${text(s).team}`;
    el('abP').querySelector('span').textContent = text(s).primary;
    el('abS').querySelector('span').textContent = text(s).special;
    for (const a of game.actors) {
      if (a.isPlayer) continue;
      const root = $(`<div class="plate ${a.team === 0 ? 'ally' : ''}" style="--t:${hex(TEAM_COLORS[a.team])}"><em>${esc(text(a.spec).special)}!</em><span>${esc(a.name)}</span><i><b></b></i></div>`);
      el('plates').append(root);
      plates.set(a, { root, bar: root.querySelector('b'), castT: 0 });
    }
    scores();
  }

  function scores() {
    const lead = Math.max(...game.scores);
    const unique = game.scores.filter(x => x === lead).length === 1;
    el('scores').innerHTML = `<div class="goal">${L.goal(RULES.koToWin)}</div>` + game.teams.map((s, i) => `
      <div class="sc ${i === 0 ? 'mine' : ''} ${unique && game.scores[i] === lead && lead > 0 ? 'lead' : ''}" style="--t:${hex(TEAM_COLORS[i])}" title="${esc(text(s).team)}">
        <img src="${portraits[s.id] || ''}" alt="${esc(text(s).name)}" /><b>${game.scores[i]}</b><i style="width:${game.scores[i] / RULES.koToWin * 100}%"></i>
      </div>`).join('');
  }

  let bannerT = 0, toastT = 0;
  function banner(title, sub = '', dur = 2.5, cls = '') {
    const b = el('banner');
    b.className = 'banner show ' + cls;
    b.querySelector('h2').textContent = title;
    b.querySelector('p').textContent = sub;
    b.style.setProperty('--len', title.length);
    bannerT = dur;
  }
  function toast(msg) {
    const t = el('toast');
    t.textContent = msg;
    t.classList.add('show');
    toastT = 2.2;
  }

  function phase(p) {
    if (p === 'match') banner(L.goBanner, L.goSub(RULES.koToWin), 1.4, 'count');
    const mine = game.crown === game.player?.team;
    const champ = game.teams[game.crown] && text(game.teams[game.crown]);
    if (p === 'won') mine ? banner(L.conquered, L.conqueredSub, 3, 'gold') : banner(L.teamWins(champ.name.toUpperCase()), L.teamWinsSub(champ.team), 3, 'gold');
    if (p === 'bossIntro') { banner(L.bossBanner, mine ? L.truceCrown : L.truce, 4.2, 'boss'); el('scores').hidden = true; }
    if (p === 'boss') { el('bossbar').hidden = false; lives(game.lives); el('crownchip').hidden = !mine; }
    if (p === 'over') {
      el('dead').hidden = true;
      game.result.won ? banner(L.bossDown, L.bossDownSub, 3.4, 'boss') : banner(L.gameOver, game.result.reason, 2.4, 'lose');
    }
    hud.classList.toggle('cinematic', p === 'bossIntro' || p === 'over');
  }

  // a rival's special: name it above its head so you know what just hit you
  function cast(a) { const pe = plates.get(a); if (pe) pe.castT = 1.3; }

  function bossStunned(on) { el('bossbar').classList.toggle('stunned', on); }

  function lives(n) {
    el('lives').innerHTML = Array.from({ length: game.diff.lives }, (_, i) => `<span class="${i < n ? '' : 'lost'}">♥</span>`).join('');
  }

  function killfeed(src, t) {
    const verb = text(src.spec).verb;
    const mine = a => a.isPlayer || a.isBoss || (game.phase !== 'boss' && a.team === game.player.team);
    if (!mine(src) && !mine(t)) return;
    const who = (a, obj) => `<b style="color:${a.isBoss ? '#4fc3ff' : hex(TEAM_COLORS[a.team])}">${esc(a.isPlayer ? (obj ? L.youObj : L.you) : a.isBoss ? (obj ? L.bossObj : L.boss) : a.name)}</b>`;
    const line = src === t ? (t.isPlayer ? L.selfKo : L.selfKoOther(who(t))) :
      src.isBoss ? L.bossKill(who(src), who(t, true)) :
      `${who(src)} ${verb[src.isPlayer ? 1 : 0]} ${who(t, true)} ${verb[2]}`;
    const row = $(`<div class="kill ${src.isPlayer || t.isPlayer ? 'mine' : ''}">${line}</div>`);
    el('feed').prepend(row);
    setTimeout(() => row.classList.add('out'), 4000);
    setTimeout(() => row.remove(), 4600);
    while (el('feed').children.length > 5) el('feed').lastChild.remove();
  }

  function hitmarker(t, amount, isKo) {
    const c = el('cross');
    c.classList.remove('hit', 'ko');
    void c.offsetWidth;
    c.classList.add(isKo ? 'ko' : 'hit');
    let n = lastNum.get(t);
    if (n && n.life > 0.5 && !isKo) { n.sum += amount; n.el.textContent = n.sum; n.life = 0.9; return; }
    n = nums.find(n => n.life <= 0);
    if (!n) { n = { el: $('<div class="num"></div>'), life: 0 }; el('plates').append(n.el); nums.push(n); }
    lastNum.set(t, n);
    n.sum = amount;
    n.el.textContent = amount;
    n.el.className = 'num' + (isKo ? ' big' : '') + (t.isBoss ? ' boss' : '');
    n.pos = new THREE.Vector3(t.pos.x + (Math.random() - 0.5), t.pos.y + t.model.height + 0.3, t.pos.z);
    n.life = 0.9;
  }

  let hurtT = 0, hurtAng = 0, hurtSrc = null;
  function hurt(src, blind) {
    hurtT = 0.9;
    hurtSrc = src;
    const f = el('flash');
    f.className = blind ? 'flash white' : 'flash red';
    void f.offsetWidth;
    f.className += ' go';
  }

  let deadT = 0;
  function died(src, t) {
    deadT = t;
    const d = el('dead');
    d.hidden = false;
    const by = !src || src === game.player ? '' : src.isBoss ? L.caughtBoss : L.caughtBy(esc(src.name), esc(label(src.spec, src.gender)));
    const left = game.phase === 'boss' ? `<br>${L.livesLeft(game.lives)}` : '';
    d.querySelector('p').innerHTML = by + left;
  }
  function respawned() { el('dead').hidden = true; }

  function showResult(cb) {
    el('result').hidden = false;
    const r = game.result, s = game.player.spec;
    el('restitle').textContent = r.won ? L.win : L.lose;
    el('restitle').className = r.won ? 'win' : 'lose';
    el('resreason').textContent = !r.won ? r.reason : r.crown ? L.winCrown(text(s).team) : L.winNoCrown;
    el('resstats').innerHTML = [r.stats.ko, r.stats.deaths, r.stats.dmg]
      .map((n, i) => `<div><b>${n}</b><span>${L.stats[i]}</span></div>`).join('');
    el('resstandings').innerHTML = game.teams.map((s, i) => [s, i]).sort((a, b) => game.scores[b[1]] - game.scores[a[1]]).map(([s, i]) => `
      <div class="sc ${i === 0 ? 'mine' : ''}" style="--t:${hex(TEAM_COLORS[i])}" title="${esc(text(s).team)}"><img src="${portraits[s.id] || ''}" alt="${esc(text(s).name)}" /><b>${game.scores[i]}</b></div>`).join('');
    el('again').onclick = cb.again;
    el('change').onclick = cb.change;
    el('again').disabled = el('change').disabled = true;
    setTimeout(() => { el('again').disabled = el('change').disabled = false; el('again').focus(); }, 600);
  }

  function showPause(on, cb, note = '') {
    el('pause').hidden = !on;
    el('pausenote').textContent = note;
    if (on) {
      el('resume').onclick = cb.resume;
      el('pause').onclick = e => { if (e.target === el('pause')) cb.resume(); };
      el('quit').onclick = cb.quit;
      el('resume').focus();
    }
  }

  // ---------- per frame ----------
  function update(dt, camera) {
    if (bannerT > 0 && (bannerT -= dt) <= 0) el('banner').classList.remove('show');
    if (toastT > 0 && (toastT -= dt) <= 0) el('toast').classList.remove('show');
    const p = game.player;
    if (!p || hud.hidden) return;
    el('cross').hidden = game.phase === 'bossIntro' || game.phase === 'over' || !p.alive;
    el('mehp').style.width = (p.hp / p.maxHp * 100) + '%';
    el('mehp').classList.toggle('low', p.hp < p.maxHp * 0.3);
    el('mehptext').textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    cd(el('abP'), p.cdP / p.spec.primary.rate);
    cd(el('abS'), p.cdS / p.spec.special.cd, Math.ceil(p.cdS));
    if (deadT > 0) { deadT -= dt; el('dead').querySelector('.count').textContent = deadT > 0 ? L.backIn(Math.ceil(deadT)) : ''; }
    if (game.boss) el('bosshp').style.width = (game.boss.hp / game.boss.maxHp * 100) + '%';
    bossArrow(camera);

    if (hurtT > 0) {
      hurtT -= dt;
      const yaw = Math.atan2(hurtSrc.pos.x - p.pos.x, hurtSrc.pos.z - p.pos.z);
      const camYaw = Math.atan2(-camera.matrixWorld.elements[8], -camera.matrixWorld.elements[10]);
      hurtAng = camYaw - yaw;
      const h = el('hurtdir');
      h.style.opacity = Math.min(1, hurtT * 2);
      h.style.transform = `translate(-50%,-50%) rotate(${hurtAng}rad)`;
    } else el('hurtdir').style.opacity = 0;

    const W = innerWidth, H = innerHeight;
    for (const [a, pe] of plates) {
      const { root: pl, bar } = pe;
      pe.castT -= dt;
      const d = a.pos.distanceTo(p.pos);
      const far = game.phase === 'boss' ? d > 15 && a.hp > a.maxHp * 0.5 : d > (a.team === p.team ? 42 : 26);
      if (!a.alive || far) { pl.style.display = 'none'; continue; }
      v.set(a.pos.x, a.pos.y + a.model.height + 0.45, a.pos.z).project(camera);
      if (v.z > 1 || v.y > 0.8) { pl.style.display = 'none'; continue; } // behind camera or under the top HUD
      pl.style.display = '';
      pl.style.transform = `translate3d(${(v.x * 0.5 + 0.5) * W}px,${(-v.y * 0.5 + 0.5) * H}px,0) translate(-50%,-100%)`;
      bar.style.width = (a.hp / a.maxHp * 100) + '%';
      pl.classList.toggle('stun', a.stunT > 0);
      pl.classList.toggle('cast', pe.castT > 0);
    }
    for (const n of nums) {
      if (n.life <= 0) continue;
      n.life -= dt;
      n.pos.y += dt * 1.6;
      v.copy(n.pos).project(camera);
      n.el.style.opacity = Math.min(1, n.life * 3);
      n.el.style.transform = `translate3d(${(v.x * 0.5 + 0.5) * W}px,${(-v.y * 0.5 + 0.5) * H}px,0) translate(-50%,-50%) scale(${1 + Math.max(0, n.life - 0.7) * 2})`;
      if (n.life <= 0) n.el.style.opacity = 0;
    }
  }
  // Edge arrow toward the boss whenever it is off screen.
  function bossArrow(camera) {
    const arrow = el('bossarrow'), b = game.boss;
    if (!b || !b.alive || game.phase !== 'boss') { arrow.hidden = true; return; }
    v.set(b.pos.x, b.pos.y + b.model.height * 0.5, b.pos.z).project(camera);
    const behind = v.z > 1;
    let x = behind ? -v.x : v.x, y = behind ? -v.y : v.y;
    if (!behind && Math.abs(x) < 0.92 && Math.abs(y) < 0.88) { arrow.hidden = true; return; }
    arrow.hidden = false;
    const m = Math.max(Math.abs(x) / 0.9, Math.abs(y) / 0.82, 1e-3);
    x /= m; y /= m;
    y = Math.min(y, 0.62);
    const ang = Math.atan2(x * innerWidth, y * innerHeight);
    arrow.style.transform = `translate3d(${(x * 0.5 + 0.5) * innerWidth}px,${(-y * 0.5 + 0.5) * innerHeight}px,0) translate(-50%,-50%) rotate(${ang}rad)`;
    arrow.lastElementChild.style.transform = `rotate(${-ang}rad)`;
  }
  function cd(box, k, secs) {
    box.querySelector('.cd').style.setProperty('--k', Math.max(0, k));
    box.classList.toggle('ready', k <= 0);
    box.dataset.secs = secs > 0 ? secs : '';
  }

  function setMuted(m, announce = false) {
    muted = m;
    if (announce && !hud.hidden) toast(m ? L.mutedToast : L.unmutedToast);
    el('mute').textContent = m ? '🔇' : '🔊';
    el('mute').setAttribute('aria-label', m ? L.unmute : L.mute);
  }

  relabel();
  return {
    el, portraits, setGender, bind, bossStunned, cast, buildGrid, setLanguage, showMenu, setSelected, matchStart, scores, phase, lives, killfeed, hitmarker, hurt, died, respawned,
    toast, banner, showResult, showPause, update, setMuted, chat,
    hideHud() { hud.hidden = true; },
  };
}
