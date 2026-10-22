// Fake in-game chat: the bots gloat, sulk and panic in text. game.js reports KOs and phase changes,
// this module decides who says what and when. Lines live in i18n.js under L.chat.
import { TEAM_COLORS, RULES } from './species.js';
import { L, text, label } from './i18n.js';

const pick = arr => arr[(Math.random() * arr.length) | 0];
const rand = (a, b) => a + Math.random() * (b - a);
const chance = p => Math.random() < p;
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const hex = n => '#' + n.toString(16).padStart(6, '0');
const MAX_ROWS = 6, GAP = 1.1, STALE = 7, GHOST = 0.07, RECENT = 12;

export function createChat(box, getGame) {
  const rows = box.querySelector('.rows'), typing = box.querySelector('.typing');
  let on = localStorage.getItem('pw.chat') !== 'off';
  let queue = [], gap = 0, idleT = 0, clock = 0, leadSaid = new Set(), recent = [];
  let memo = new Map(); // actor -> { streak, by: last actor that KO'd it, byPlayer }
  const st = a => memo.get(a) ?? memo.set(a, { streak: 0, by: null, byPlayer: 0 }).get(a);

  const nameOf = a => a.isPlayer ? L.chat.tag(label(a.spec, a.gender)) : a.name;
  const bots = (f = () => true) => getGame().actors.filter(a => !a.isPlayer && !a.isBoss && f(a));
  // a species' own lines win most of the time, the shared pool fills in
  const pool = (a, kind) => { const own = L.chat.voice[a.spec.id]?.[kind]; return own && chance(0.7) ? own : L.chat[kind]; };

  // queue a line; delay counts from when the line before it was posted, so replies follow gloats
  function say(who, lines, vars = {}, delay = rand(0.3, 1.2), cap = 2) {
    if (!on || who === undefined || queue.length >= cap) return;
    const fresh = lines.filter(s => !recent.includes(s));
    const line = pick(fresh.length ? fresh : lines);
    recent = [line, ...recent].slice(0, RECENT);
    queue.push({ who, text: fill(line, vars), t: delay, born: clock, ghost: who && chance(GHOST) });
  }

  function post(m) {
    const row = document.createElement('div');
    row.className = m.who ? 'msg' : 'msg sys';
    const color = m.who?.isBoss ? '#4fc3ff' : m.who && hex(TEAM_COLORS[m.who.team]);
    const tag = !m.who ? L.chat.sys : m.who.isBoss ? nameOf(m.who) : `[${label(m.who.spec, m.who.gender)}] ${nameOf(m.who)}`;
    row.innerHTML = `<b style="${color ? `color:${color}` : ''}">${esc(tag)}:</b> ${esc(m.text)}`;
    rows.append(row);
    setTimeout(() => row.classList.add('out'), 10000);
    setTimeout(() => row.remove(), 10600);
    while (rows.children.length > MAX_ROWS) rows.firstChild.remove();
  }

  function update(dt) {
    clock += dt;
    gap -= dt;
    const m = queue[0];
    if (m) {
      m.t -= dt;
      if (m.t <= 0 && gap <= 0) {
        queue.shift();
        if (!m.ghost && clock - m.born < STALE) { post(m); gap = GAP; }
      }
    }
    const who = m?.who && m.t < 1.6 ? m.who : null;
    typing.hidden = !who;
    if (who) typing.textContent = L.chat.typing(nameOf(who));

    const g = getGame();
    if (g.phase !== 'match' && g.phase !== 'boss') return;
    if ((idleT -= dt) > 0) return;
    idleT = rand(16, 30);
    if (g.phase === 'boss' && g.boss && chance(0.5)) say(g.boss, L.chat.bossTaunt);
    else { const b = pick(bots(a => a.alive)); b && say(b, g.phase === 'boss' ? L.chat.bossPanic : L.chat.idle); }
  }

  function ko(src, t) {
    const g = getGame();
    const vars = { k: nameOf(src), v: nameOf(t) };
    const cap = src.isPlayer || t.isPlayer ? 4 : 2;
    const s = st(src), v = st(t);
    v.streak = 0;
    if (src === t) {
      const b = pick(bots(a => a !== t && a.alive));
      if (b && chance(0.6)) say(b, L.chat.selfKo, vars, undefined, cap);
      return;
    }
    if (src.isBoss) {
      if (chance(0.5)) say(src, L.chat.bossKill, vars, undefined, cap);
      if (!t.isPlayer && chance(0.35)) say(t, pool(t, 'salty'), vars, rand(1.2, 2.6), cap);
      return;
    }
    const revenge = s.by === t;
    s.streak++;
    v.by = src;
    if (src.isPlayer) v.byPlayer++;

    if (!src.isPlayer) {
      if (chance(0.1)) say(null, L.chat.mod, { ...vars, n: (rand(10, 99)) | 0 }, undefined, cap);
      else if (revenge && chance(0.8)) say(src, L.chat.revenge, vars, undefined, cap);
      else if (s.streak >= 3 && chance(0.7)) say(src, L.chat.streak, { ...vars, n: s.streak }, undefined, cap);
      else if (chance(t.isPlayer ? 0.85 : 0.35)) say(src, pool(src, 'gloat'), vars, undefined, cap);
    }
    if (!t.isPlayer) {
      if (src.isPlayer && v.byPlayer >= 2 && chance(0.7)) say(t, L.chat.hacks, vars, rand(1, 2.4), cap);
      else if (chance(src.isPlayer ? 0.55 : 0.3)) say(t, pool(t, 'salty'), vars, rand(1.2, 2.6), cap);
    }

    const left = RULES.koToWin - g.scores[src.team];
    if (g.phase === 'match' && left === 3 && !leadSaid.has(src.team)) {
      leadSaid.add(src.team);
      const b = pick(bots(a => a.team === src.team));
      b && say(b, L.chat.lead, { n: left, team: text(src.spec).team }, rand(0.5, 1), 4);
    }
  }

  function phase(p) {
    const g = getGame();
    if (p === 'countdown') {
      queue = []; memo = new Map(); leadSaid = new Set(); idleT = rand(14, 24);
      rows.replaceChildren();
      say(null, L.chat.welcome, {}, 0.6);
      say(pick(bots()), L.chat.glhf, {}, 1.4);
    }
    if (p === 'won') {
      const winner = pick(bots(a => a.team === g.crown)), loser = pick(bots(a => a.team !== g.crown));
      winner && say(winner, L.chat.crown, {}, 0.6, 4);
      loser && say(loser, L.chat.crownLose, {}, rand(1, 2), 4);
    }
    if (p === 'bossIntro') {
      queue = [];
      say(null, L.chat.bossJoin, {}, 0.8, 4);
      say(pick(bots()), L.chat.bossPanic, {}, 1.5, 4);
    }
    if (p === 'boss' && g.boss) say(g.boss, L.chat.bossTaunt, {}, 0.8, 4);
    if (p === 'over') {
      queue = [];
      say(pick(bots()), g.result.won ? L.chat.bossWin : L.chat.bossLose, {}, 0.8, 4);
    }
  }

  function setOn(v) {
    on = v;
    localStorage.setItem('pw.chat', v ? 'on' : 'off');
    box.hidden = !v;
    if (!v) queue = [];
  }
  box.hidden = !on;

  return { ko, phase, update, setOn, get on() { return on; } };
}
