// Fully synthesized WebAudio: no files. `audio` is the game singleton; createAudio(ctx) lets tools/tests inject an
// OfflineAudioContext. Listener yaw: forward = (sin yaw, cos yaw), same as creatures (yaw 0 faces +Z).

export const SFX_NAMES = [
  'honk', 'hiss', 'croak', 'squeak', 'coo', 'caw', 'chatter', 'quack', 'human', 'screech',
  'hit', 'hurt', 'ko', 'pickup', 'jump', 'flap', 'splash', 'throw', 'swing', 'boom', 'dash', 'stun',
  'summon', 'steal', 'ui', 'uiMove', 'countdown', 'go', 'win', 'lose', 'bossIntro', 'bossDive',
];
export const MUSIC_MODES = ['menu', 'match', 'boss'];

const MAX_VOICES = 24;
const MAX_DIST = 60;
const PRIORITY = new Set(['ko', 'win', 'lose', 'go', 'countdown', 'bossIntro', 'bossDive']);
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const note = (s) => {
  const m = /^([a-g])([#b]?)(\d)$/.exec(s);
  return hz(12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0));
};
const rnd = (a, b) => a + Math.random() * (b - a);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};

// Music tables. Each bar is 16 sixteenth steps; melody tokens are note names or '.' (hold/rest).
const bars = (s) => s.map((b) => b.split(' '));
const MUSIC = {
  menu: {
    bpm: 84, lead: 'whistle', leadG: 0.2, bassD: 0.5,
    roots: [48, 45, 41, 43], min: [0, 1, 0, 0],
    mel: bars([
      'e5 . . . g5 . . . a5 . g5 . e5 . . .',
      'c5 . . . e5 . . . a5 . . . g5 . . .',
      'a5 . . . c6 . a5 . g5 . f5 . . . . .',
      'b5 . a5 . g5 . . . d5 . . . . . . .',
    ]),
    bass: { 0: 0, 8: 7 }, comp: [[2, 0], [6, 1], [10, 2], [14, 1]], kick: [], snare: [], hat: [],
  },
  match: {
    bpm: 126, lead: 'marimba', leadG: 0.2, bassD: 0.18,
    roots: [48, 45, 41, 43, 48, 45, 41, 43], min: [0, 1, 0, 0, 0, 1, 0, 0],
    mel: bars([
      'e5 . g5 . e5 . c5 . d5 . e5 . g5 . . .',
      'a5 . e5 . c5 . e5 . a4 . c5 . e5 . . .',
      'f5 . a5 . f5 . c5 . d5 . f5 . a5 . g5 .',
      'g5 . b4 . d5 . g5 . f5 . d5 . b4 . . .',
      'c6 . . g5 . e5 . g5 c6 . . g5 . e5 . .',
      'a5 . . e5 . c5 . e5 a5 . g5 . e5 . . .',
      'f5 . a5 . c6 . a5 . f5 . g5 . a5 . . .',
      'g5 . f5 . d5 . b4 . d5 . g5 . . . . .',
    ]),
    bass: { 0: 0, 3: 12, 6: 7, 8: 0, 11: 12, 14: 7 }, comp: [[4, -1], [12, -1]],
    kick: [0, 8], snare: [], hat: [2, 6, 10, 14],
  },
  boss: {
    bpm: 156, lead: 'lead', leadG: 0.16, bassD: 0.18,
    roots: [50, 46, 48, 45], min: [1, 0, 0, 0],
    mel: bars([
      'd5 . d5 . f5 . d5 . a5 . . . g5 . f5 .',
      'd5 . d5 . f5 . d5 . bb5 . . . a5 . f5 .',
      'c5 . e5 . g5 . e5 . c6 . . . bb5 . g5 .',
      'e5 . e5 . g#5 . e5 . a5 . . . g#5 . e5 .',
    ]),
    bass: { 0: 0, 2: 0, 4: 0, 6: 12, 8: 0, 10: 0, 12: 0, 14: 12 }, comp: [[7, -1], [15, -1]],
    kick: [0, 8, 10], snare: [4, 12], hat: [2, 6, 10, 14],
  },
};

export function createAudio(injected = null) {
  let ctx = injected, master, musicBus, sfxBus, noiseBuf;
  let volume = Math.min(1, Math.max(0, store.get('pw.volume', 0.8)));
  let muted = !!store.get('pw.muted', false);
  let lx = 0, lz = 0, lyaw = 0;
  let ends = [];
  const lastPlay = {};
  let want = null, track = null, timer = 0;

  const applyMaster = () => master && master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.02);

  function init() {
    if (master) return;
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    musicBus = ctx.createGain();
    sfxBus = ctx.createGain();
    musicBus.gain.value = 0.16;
    musicBus.connect(master);
    sfxBus.connect(master);
    master.connect(comp);
    comp.connect(ctx.destination);
    master.gain.value = muted ? 0 : volume;
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  // curve spec: number | [a, b] (exp ramp over d) | [[frac, value], ...]
  function curve(param, spec, t, d, mul = 1) {
    if (typeof spec === 'number') { param.setValueAtTime(spec * mul, t); return; }
    const pts = typeof spec[0] === 'number' ? [[0, spec[0]], [1, spec[1]]] : spec;
    param.setValueAtTime(pts[0][1] * mul, t + pts[0][0] * d);
    for (let i = 1; i < pts.length; i++) param.exponentialRampToValueAtTime(pts[i][1] * mul, t + pts[i][0] * d);
  }

  function envelope(g, t, d, peak, a, hold) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (hold) g.gain.setValueAtTime(peak, t + hold * d);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  }

  // One oscillator or noise voice. p = { out, t (base time), r (pitch mul), st (shared end tracker) }.
  function voice(p, o, src) {
    const t = p.t + (o.t || 0), d = o.d, r = o.r ?? p.r;
    let node = src, last = src;
    if (o.ft) {
      const f = ctx.createBiquadFilter();
      f.type = o.ft;
      f.Q.value = o.fq ?? 1;
      curve(f.frequency, o.ff, t, d, r);
      last.connect(f);
      last = f;
    }
    const g = ctx.createGain();
    envelope(g, t, d, o.g ?? 0.3, o.a ?? 0.005, o.hold);
    last.connect(g).connect(p.out);
    if (o.vib) {
      const l = ctx.createOscillator(), lg = ctx.createGain();
      l.frequency.value = o.vib[0];
      lg.gain.value = o.vib[1] * r;
      l.connect(lg).connect(node.frequency);
      l.start(t);
      l.stop(t + d + 0.05);
    }
    node.start(t, o.noise ? Math.random() * 1.5 : 0);
    node.stop(t + d + 0.05);
    p.st.end = Math.max(p.st.end, t + d);
  }
  const tone = (p, o) => {
    const s = ctx.createOscillator();
    s.type = o.type || 'sine';
    s.detune.value = o.det || 0;
    curve(s.frequency, o.f, p.t + (o.t || 0), o.d, o.r ?? p.r);
    voice(p, o, s);
  };
  const noise = (p, o) => {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    voice(p, { ...o, noise: true }, s);
  };
  const sub = (p, dt) => ({ ...p, t: p.t + dt });

  const brass = (p, f, t, d, g, wah) => {
    for (const det of [-8, 8]) {
      tone(p, { type: 'sawtooth', f, t, d, g, a: 0.03, hold: 0.7, det, ft: 'lowpass', ff: wah || [[0, 700], [0.3, 2600], [1, 900]], fq: 1 });
    }
  };

  const V = {
    honk(p) {
      for (const det of [-20, 20]) {
        tone(p, { type: 'sawtooth', f: [[0, 300], [0.12, 520], [0.4, 440], [1, 330]], d: 0.34, g: 0.3, a: 0.01, hold: 0.7, det, ft: 'bandpass', ff: [[0, 700], [0.2, 1100], [1, 800]], fq: 2.5 });
      }
      tone(p, { type: 'square', f: [[0, 600], [0.12, 1040], [1, 660]], d: 0.3, g: 0.08, ft: 'bandpass', ff: 1800, fq: 3 });
      noise(p, { d: 0.12, g: 0.1, ft: 'bandpass', ff: 1500, fq: 1 });
    },
    quack(p) {
      tone(p, { type: 'sawtooth', f: [[0, 560], [0.3, 640], [1, 380]], d: 0.15, g: 1, a: 0.008, ft: 'bandpass', ff: [[0, 1500], [1, 900]], fq: 2.5 });
      tone(p, { type: 'square', f: [[0, 560], [1, 380]], d: 0.14, g: 0.3, ft: 'bandpass', ff: 1100, fq: 2 });
      tone(p, { type: 'sawtooth', f: [[0, 430], [1, 280]], t: 0.17, d: 0.1, g: 0.6, ft: 'bandpass', ff: [[0, 1100], [1, 800]], fq: 2.5 });
    },
    coo(p) {
      tone(p, { f: [[0, 300], [0.5, 430], [1, 340]], d: 0.2, g: 0.35, a: 0.04, ft: 'lowpass', ff: 900 });
      tone(p, { f: [[0, 340], [0.35, 460], [1, 290]], t: 0.26, d: 0.45, g: 0.35, a: 0.05, vib: [22, 18], ft: 'lowpass', ff: 900 });
      tone(p, { type: 'triangle', f: [[0, 600], [1, 580]], t: 0.26, d: 0.4, g: 0.05, a: 0.05, vib: [22, 25] });
    },
    caw(p) {
      for (const det of [-30, 30]) {
        tone(p, { type: 'sawtooth', f: [[0, 640], [0.15, 560], [1, 330]], d: 0.38, g: 0.28, a: 0.01, hold: 0.5, det, vib: [70, 40], ft: 'bandpass', ff: [[0, 1000], [1, 1500]], fq: 1.2 });
      }
      noise(p, { d: 0.35, g: 0.2, hold: 0.5, ft: 'bandpass', ff: 2200, fq: 0.8 });
    },
    chatter(p) {
      for (let i = 0; i < 9; i++) {
        const f = rnd(1700, 2600);
        tone(p, { type: 'square', f: [f, f * 0.8], t: i * 0.045, d: 0.03, g: 0.18, a: 0.002, ft: 'bandpass', ff: 2200, fq: 4 });
        noise(p, { t: i * 0.045, d: 0.02, g: 0.1, ft: 'highpass', ff: 3500 });
      }
    },
    squeak(p) {
      tone(p, { type: 'triangle', f: [1400, 2500], d: 0.09, g: 0.3, a: 0.004 });
      tone(p, { type: 'triangle', f: [1800, 3000], t: 0.1, d: 0.08, g: 0.25, a: 0.004 });
    },
    hiss(p) {
      noise(p, { d: 0.6, g: 0.4, a: 0.06, hold: 0.5, ft: 'highpass', ff: 3500, fq: 0.7 });
      noise(p, { d: 0.6, g: 0.25, a: 0.08, hold: 0.5, ft: 'bandpass', ff: [[0, 6500], [1, 8500]], fq: 1.5 });
      tone(p, { type: 'sawtooth', f: 90, d: 0.15, g: 0.12, ft: 'lowpass', ff: 300 });
    },
    croak(p) {
      for (let i = 0; i < 4; i++) {
        tone(p, { type: 'sawtooth', f: [[0, 130 - i * 8], [1, 85]], t: i * 0.07, d: 0.09, g: 0.35, a: 0.005, ft: 'bandpass', ff: 420, fq: 3 });
      }
      tone(p, { type: 'sawtooth', f: [[0, 90], [1, 60]], t: 0.28, d: 0.22, g: 0.3, a: 0.02, ft: 'lowpass', ff: 500 });
    },
    human(p) {
      if (Math.random() < 0.5) { // grumpy "hmpf"
        tone(p, { type: 'sawtooth', f: [[0, 115], [1, 95]], d: 0.2, g: 0.4, a: 0.03, ft: 'lowpass', ff: 450 });
        noise(p, { t: 0.2, d: 0.1, g: 0.28, a: 0.01, ft: 'bandpass', ff: 900, fq: 1.2 });
      } else { // "hey"
        for (const [ff, g] of [[[[0, 600], [1, 450]], 0.35], [[[0, 1900], [1, 2200]], 0.2]]) {
          tone(p, { type: 'sawtooth', f: [[0, 130], [0.3, 190], [1, 140]], d: 0.28, g, a: 0.02, hold: 0.6, ft: 'bandpass', ff, fq: 5 });
        }
      }
    },
    screech(p) {
      tone(p, { type: 'sawtooth', f: [[0, 2200], [0.25, 3600], [1, 2500]], d: 0.45, g: 0.22, a: 0.01, hold: 0.6, vib: [40, 220], ft: 'bandpass', ff: 3200, fq: 2 });
      tone(p, { type: 'square', f: [[0, 4400], [0.25, 7000], [1, 5000]], d: 0.4, g: 0.05, vib: [40, 400] });
      noise(p, { d: 0.3, g: 0.1, ft: 'highpass', ff: 5000 });
    },
    hit(p) {
      tone(p, { f: [200, 45], d: 0.14, g: 0.7, a: 0.002 });
      noise(p, { d: 0.07, g: 0.45, a: 0.001, ft: 'bandpass', ff: 1800, fq: 0.9 });
      tone(p, { type: 'square', f: [900, 300], d: 0.03, g: 0.15, a: 0.001 });
    },
    hurt(p) {
      tone(p, { type: 'sawtooth', f: [[0, 420], [1, 190]], d: 0.2, g: 0.9, a: 0.005, ft: 'bandpass', ff: [[0, 1000], [1, 600]], fq: 1.5 });
      noise(p, { d: 0.05, g: 0.2, ft: 'lowpass', ff: 2000 });
    },
    ko(p) {
      tone(p, { f: [160, 40], d: 0.12, g: 0.55, a: 0.002 });
      noise(p, { d: 0.45, g: 0.45, a: 0.005, ft: 'lowpass', ff: [3500, 250], fq: 0.7 });
      tone(p, { f: [[0, 500], [0.25, 1900], [1, 300]], t: 0.08, d: 0.7, g: 0.28, a: 0.02, vib: [9, 40] });
      tone(p, { type: 'triangle', f: [[0, 1000], [0.25, 3800], [1, 600]], t: 0.08, d: 0.7, g: 0.05, a: 0.02, vib: [9, 80] });
    },
    pickup(p) {
      [1319, 1568, 2093].forEach((f, i) => {
        tone(p, { f, t: i * 0.07, d: 0.3, g: 0.3, a: 0.004 });
        tone(p, { type: 'triangle', f: f * 2, t: i * 0.07, d: 0.15, g: 0.08, a: 0.004 });
      });
    },
    jump(p) {
      tone(p, { f: [[0, 220], [1, 640]], d: 0.14, g: 0.28, a: 0.005, ft: 'lowpass', ff: 2500 });
    },
    flap(p) {
      noise(p, { d: 0.07, g: 0.8, a: 0.01, ft: 'lowpass', ff: [500, 1200] });
      noise(p, { t: 0.09, d: 0.07, g: 0.6, a: 0.01, ft: 'lowpass', ff: [500, 1200] });
    },
    splash(p) {
      noise(p, { d: 0.5, g: 0.5, a: 0.02, ft: 'bandpass', ff: [[0, 900], [0.3, 2600], [1, 500]], fq: 0.6 });
      for (let i = 0; i < 5; i++) {
        const f = rnd(300, 700);
        tone(p, { f: [f, f * 1.8], t: 0.05 + i * rnd(0.04, 0.08), d: 0.07, g: 0.15, a: 0.003 });
      }
    },
    throw(p) {
      noise(p, { d: 0.16, g: 0.9, a: 0.03, ft: 'bandpass', ff: [500, 2000], fq: 0.8 });
      tone(p, { type: 'triangle', f: [350, 800], d: 0.1, g: 0.3, a: 0.005 });
    },
    swing(p) {
      noise(p, { d: 0.2, g: 0.35, a: 0.06, hold: 0.4, ft: 'bandpass', ff: [[0, 400], [0.5, 1600], [1, 700]], fq: 1.5 });
    },
    boom(p) {
      tone(p, { f: [[0, 110], [1, 28]], d: 0.9, g: 0.9, a: 0.003 });
      noise(p, { d: 0.8, g: 0.7, a: 0.002, ft: 'lowpass', ff: [900, 80], fq: 0.8 });
      noise(p, { d: 0.06, g: 0.4, ft: 'highpass', ff: 2000 });
      tone(p, { type: 'sawtooth', f: [70, 35], d: 0.6, g: 0.25, ft: 'lowpass', ff: 250 });
    },
    dash(p) {
      noise(p, { d: 0.4, g: 0.45, a: 0.1, hold: 0.3, ft: 'bandpass', ff: [[0, 300], [0.4, 3000], [1, 800]], fq: 1 });
      tone(p, { type: 'triangle', f: [200, 520], d: 0.3, g: 0.1, a: 0.05 });
    },
    stun(p) {
      tone(p, { type: 'triangle', f: [[0, 520], [1, 140]], d: 0.55, g: 0.4, a: 0.004, vib: [26, 90], ft: 'lowpass', ff: 2200 });
      for (let i = 0; i < 6; i++) {
        const f = rnd(2400, 3800);
        tone(p, { f: [f, f * 1.25], t: 0.18 + i * 0.07, d: 0.06, g: 0.12, a: 0.004 });
      }
    },
    summon(p) {
      [523, 659, 784, 1047].forEach((f, i) => {
        tone(p, { type: 'triangle', f, t: i * 0.07, d: i === 3 ? 0.6 : 0.2, g: 0.25, a: 0.01, vib: i === 3 ? [7, 10] : undefined });
      });
      tone(p, { f: [[0, 150], [0.3, 400], [1, 200]], d: 0.3, g: 0.3, a: 0.01 });
      noise(p, { t: 0.2, d: 0.35, g: 0.2, a: 0.02, ft: 'highpass', ff: [3000, 7000] });
    },
    steal(p) {
      for (let i = 0; i < 8; i++) {
        tone(p, { type: 'triangle', f: 1800 + i * 450 + rnd(0, 150), t: i * 0.045, d: 0.12, g: 0.16, a: 0.003 });
      }
      [1568, 1976, 2349].forEach((f) => tone(p, { f, t: 0.36, d: 0.45, g: 0.18, a: 0.003 }));
    },
    ui(p) {
      tone(p, { type: 'square', f: [1000, 700], d: 0.04, g: 0.3, a: 0.002, ft: 'lowpass', ff: 3000 });
      tone(p, { f: 1500, d: 0.05, g: 0.3, a: 0.002 });
    },
    uiMove(p) {
      tone(p, { type: 'triangle', f: [520, 600], d: 0.05, g: 0.35, a: 0.003 });
    },
    countdown(p) {
      tone(p, { type: 'square', f: 660, d: 0.2, g: 0.2, a: 0.005, hold: 0.6, ft: 'lowpass', ff: 2500 });
      tone(p, { f: 660, d: 0.2, g: 0.25, a: 0.005, hold: 0.6 });
    },
    go(p) {
      tone(p, { type: 'square', f: [[0, 880], [0.15, 1320], [1, 1320]], d: 0.5, g: 0.2, a: 0.005, hold: 0.6, ft: 'lowpass', ff: 3500 });
      tone(p, { f: [[0, 1760], [0.15, 2640], [1, 2640]], d: 0.5, g: 0.15, a: 0.005, hold: 0.6 });
      noise(p, { d: 0.1, g: 0.15, ft: 'highpass', ff: 5000 });
    },
    win(p) {
      [[392, 0, 0.13], [523, 0.15, 0.13], [659, 0.3, 0.13], [784, 0.45, 0.8]].forEach(([f, t, d]) => {
        brass(p, f, t, d, 0.14);
        tone(p, { type: 'triangle', f: f * 2, t, d: d * 0.7, g: 0.07, a: 0.01 });
      });
      brass(p, 659, 0.45, 0.8, 0.1);
      brass(p, 523, 0.45, 0.8, 0.09);
    },
    lose(p) {
      [[311, 0, 0.4], [294, 0.45, 0.4], [277, 0.9, 0.4]].forEach(([f, t, d]) => {
        brass(p, f, t, d, 0.16, [[0, 350], [0.35, 1300], [1, 450]]);
      });
      for (const det of [-8, 8]) {
        tone(p, { type: 'sawtooth', f: [[0, 262], [0.4, 262], [1, 190]], t: 1.35, d: 1.1, g: 0.17, a: 0.04, hold: 0.7, det, vib: [5.5, 6], ft: 'lowpass', ff: [[0, 400], [0.3, 1300], [1, 350]] });
      }
    },
    bossIntro(p) {
      [0, 0.28, 0.56].forEach((t, i) => {
        tone(p, { f: [[0, 100 - i * 8], [1, 45]], t, d: 0.4, g: 0.7, a: 0.003 });
        noise(p, { t, d: 0.3, g: 0.4, ft: 'lowpass', ff: 600 });
      });
      noise(p, { d: 1.1, g: 0.3, a: 0.9, ft: 'bandpass', ff: [200, 4000], fq: 1.5 });
      [[147, 0.85], [208, 0.85], [294, 0.85], [233, 0.85]].forEach(([f, t]) => brass(p, f, t, 1.1, 0.12));
      V.screech(sub({ ...p, r: p.r * 0.85 }, 1.3));
    },
    bossDive(p) {
      tone(p, { f: [[0, 3200], [1, 380]], d: 1, g: 0.2, a: 0.03, vib: [6, 40] });
      tone(p, { type: 'triangle', f: [[0, 6400], [1, 760]], d: 1, g: 0.04, a: 0.03 });
      noise(p, { d: 1, g: 0.3, a: 0.4, ft: 'bandpass', ff: [[0, 1800], [1, 500]], fq: 1 });
    },
  };

  function sfx(name, { x, z, vol = 1, pitch = 1 } = {}) {
    if (!master || !V[name]) return;
    const now = ctx.currentTime;
    ends = ends.filter((e) => e > now);
    const prio = PRIORITY.has(name);
    if (!prio && ends.length >= MAX_VOICES) return;
    if (!prio && now - (lastPlay[name] ?? -1) < 0.03) return;
    lastPlay[name] = now;
    let att = 1, pan = 0;
    if (x != null && z != null) {
      const dx = x - lx, dz = z - lz, dist = Math.hypot(dx, dz);
      if (dist >= MAX_DIST) return;
      att = dist <= 2 ? 1 : (1 - (dist - 2) / (MAX_DIST - 2)) ** 2;
      if (dist > 0.01) pan = Math.max(-1, Math.min(1, ((-dx * Math.cos(lyaw) + dz * Math.sin(lyaw)) / dist) * Math.min(1, dist / 3) * 0.9));
    }
    const out = ctx.createGain();
    out.gain.value = vol * att;
    let tail = out;
    if (pan && ctx.createStereoPanner) {
      const sp = ctx.createStereoPanner();
      sp.pan.value = pan;
      out.connect(sp);
      tail = sp;
    }
    tail.connect(sfxBus);
    const p = { out, t: now + 0.005, r: pitch * (1 + (Math.random() - 0.5) * 0.1), st: { end: now } };
    V[name](p);
    ends.push(p.st.end);
    setTimeoutSafe(() => tail.disconnect(), (p.st.end - now + 0.3) * 1000);
  }
  const setTimeoutSafe = (fn, ms) => { if (!injected) setTimeout(fn, ms); };

  // ---- music ----
  const inst = {
    marimba(o, f, g) {
      tone(o, { f, d: 0.4, g, a: 0.002 });
      tone(o, { f: f * 4, d: 0.08, g: g * 0.3, a: 0.001 });
    },
    whistle(o, f, g, d) {
      tone(o, { f: [[0, f * 0.97], [0.15, f], [1, f]], d, g, a: 0.05, vib: [5.5, f * 0.012], hold: 0.8 });
    },
    lead(o, f, g) {
      tone(o, { type: 'square', f, d: 0.16, g, a: 0.004, ft: 'lowpass', ff: [[0, 3000], [1, 700]] });
    },
    bass(o, f, g, d = 0.2) {
      tone(o, { type: 'triangle', f, d, g, a: 0.005, ft: 'lowpass', ff: [f * 6, f * 2] });
      tone(o, { type: 'sine', f, d, g: g * 0.6, a: 0.005 });
    },
  };

  function playStep(tr, s) {
    const M = tr.cfg, sp = 60 / M.bpm / 4, i = s % 16, bar = Math.floor(s / 16) % M.roots.length;
    const root = M.roots[bar], third = M.min[bar] ? 3 : 4;
    const o = { out: tr.gain, t: tr.t, r: 1, st: { end: 0 } };
    const bt = M.mel[bar % M.mel.length][i];
    if (bt && bt !== '.') {
      const f = note(bt);
      let len = 1;
      while (i + len < 16 && M.mel[bar % M.mel.length][i + len] === '.') len++;
      inst[M.lead](o, f, M.leadG, Math.min(len * sp, 1.4)); // only the whistle sustains; the rest ignore the length
    }
    if (i in M.bass) inst.bass(o, hz(root + M.bass[i]), 0.35, M.bassD);
    for (const [ci, k] of M.comp) {
      if (ci !== i) continue;
      const ch = [0, third, 7];
      for (const c of k < 0 ? ch : [ch[k]]) inst.marimba(o, hz(root + 12 + c + (k < 0 ? 0 : 12)), k < 0 ? 0.08 : 0.1);
    }
    if (M.kick.includes(i)) tone(o, { f: [140, 45], d: 0.18, g: 0.45, a: 0.002 });
    if (M.snare.includes(i)) noise(o, { d: 0.1, g: 0.18, ft: 'bandpass', ff: 1800, fq: 0.8 });
    if (M.hat.includes(i)) noise(o, { d: 0.04, g: 0.07, ft: 'highpass', ff: 7000 });
  }

  function pump(horizon = 0.3) {
    if (!track) return;
    const sp = 60 / track.cfg.bpm / 4;
    if (track.t < ctx.currentTime - 0.1) track.t = ctx.currentTime;
    while (track.t < ctx.currentTime + horizon) {
      playStep(track, track.step++);
      track.t += sp;
    }
  }

  function startMusic(mode) {
    if (track) {
      const old = track;
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      setTimeoutSafe(() => old.gain.disconnect(), 3000);
      track = null;
    }
    if (!mode) { clearInterval(timer); return; }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.setTargetAtTime(1, ctx.currentTime, 0.4);
    gain.connect(musicBus);
    track = { mode, cfg: MUSIC[mode], gain, t: ctx.currentTime + 0.05, step: 0 };
    if (!injected) { clearInterval(timer); timer = setInterval(pump, 50); }
    pump();
  }

  if (injected) init();

  return {
    unlock() {
      try {
        init();
        if (ctx.resume) ctx.resume();
        if (want && !track) startMusic(want);
      } catch { /* no WebAudio: stay silent */ }
    },
    sfx(name, opts) { try { sfx(name, opts); } catch (e) { if (injected) throw e; } },
    setListener(x, z, yaw) { lx = x; lz = z; lyaw = yaw || 0; },
    setVolume(v) { volume = Math.min(1, Math.max(0, +v || 0)); store.set('pw.volume', volume); applyMaster(); },
    getVolume: () => volume,
    toggleMute() { muted = !muted; store.set('pw.muted', muted); applyMaster(); return muted; },
    isMuted: () => muted,
    music(mode) {
      if (mode && !MUSIC[mode]) mode = null;
      want = mode || null;
      if (!master || (track && track.mode === mode)) return;
      if (!track && !mode) return;
      startMusic(mode);
    },
    // test hooks
    pump,
    tap() { init(); const a = ctx.createAnalyser(); a.fftSize = 2048; master.connect(a); return a; },
    get context() { return ctx; },
  };
}

export const audio = createAudio();
