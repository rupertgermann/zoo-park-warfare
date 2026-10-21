import { audio, createAudio, SFX_NAMES, MUSIC_MODES } from '../src/audio.js';

const $ = (id) => document.getElementById(id);
const btn = (parent, label, fn, attr) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.dataset[attr] = label;
  b.onclick = () => { audio.unlock(); fn(); };
  $(parent).append(b);
};

SFX_NAMES.forEach((n) => btn('sfx', n, () => audio.sfx(n), 'sfx'));
btn('sfx', 'pan-left', () => { audio.setListener(0, 0, 0); audio.sfx('honk', { x: 10, z: 0 }); }, 'sfx2');
btn('sfx', 'pan-right', () => { audio.setListener(0, 0, 0); audio.sfx('honk', { x: -10, z: 0 }); }, 'sfx2');
btn('sfx', 'far(70m)', () => audio.sfx('boom', { x: 70, z: 0 }), 'sfx2');
[...MUSIC_MODES, null].forEach((m) => btn('music', String(m), () => audio.music(m), 'music'));

$('vol').value = audio.getVolume();
$('vol').oninput = (e) => audio.setVolume(+e.target.value);
$('mute').onclick = () => { audio.unlock(); $('mute').textContent = audio.toggleMute() ? 'Unmute' : 'Mute'; };

let analyser = null;
function level() {
  analyser = analyser || audio.tap();
  const buf = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(buf);
  return Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
}
setInterval(() => { if (audio.context) $('lvl').textContent = 'rms ' + level().toFixed(4); }, 100);

// Test hooks used by tools/audio-test.js.
window.__audio = audio;
window.__names = SFX_NAMES;
window.__liveLevel = (ms) => new Promise((res) => {
  let peak = 0;
  const end = performance.now() + ms;
  const tick = () => {
    peak = Math.max(peak, level());
    performance.now() < end ? setTimeout(tick, 10) : res(peak);
  };
  tick();
});
window.__render = async (kind, name, opts) => {
  const secs = kind === 'music' ? 6 : 3.5, rate = 44100;
  const off = new OfflineAudioContext(2, secs * rate, rate);
  const a = createAudio(off);
  if (kind === 'music') { a.music(name); a.pump(secs); } else a.sfx(name, opts);
  const out = await off.startRendering();
  let bad = 0, peak = 0;
  const rms = [0, 1].map((c) => {
    let sum = 0;
    for (const v of out.getChannelData(c)) {
      if (!Number.isFinite(v)) bad++;
      sum += v * v; peak = Math.max(peak, Math.abs(v));
    }
    return Math.sqrt(sum / out.length);
  });
  return { rmsL: rms[0], rmsR: rms[1], rms: Math.max(...rms), peak, bad };
};
window.__preUnlock = () => {
  const a = createAudio();
  a.sfx('hit'); a.sfx('nope'); a.music('menu'); a.music(null); a.setListener(1, 2, 3);
  return a.getVolume();
};
window.__ready = true;
